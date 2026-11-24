import contextlib
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cleanup
import cleanup_macos as macos


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()

    def test_mise_running_version_blocks_before_any_mutation(self):
        preview = "mise npm:pi@1.0.0 is kept: still running as pid 123 (node)"
        with (
            patch.object(cleanup.sys, "platform", "linux"),
            patch.object(cleanup, "run", side_effect=[preview, "{}"]) as run,
            contextlib.redirect_stderr(io.StringIO()) as err,
        ):
            self.assertEqual(cleanup.cleanup(apply=True), 1)
        self.assertEqual(run.call_count, 2)  # An apply would have called run again.
        self.assertIn("pid 123", err.getvalue())

    def test_kept_virtualenv_blocks_interpreter_removal_but_not_if_removing_both(self):
        old_python = self.root / "python/3.14.8"
        executable = old_python / "bin/python"
        executable.parent.mkdir(parents=True)
        executable.touch()
        alias = self.root / "python/3.14"
        alias.symlink_to(old_python, target_is_directory=True)
        install = self.root / "pipx-yamllint/1.38.0"
        venv = install / "yamllint"
        (venv / "bin").mkdir(parents=True)
        (venv / "bin/python").symlink_to(alias / "bin/python")
        (venv / "pyvenv.cfg").write_text("version_info = 3.14.8\n")
        (install.parent / "latest").symlink_to(install, target_is_directory=True)

        self.assertTrue(cleanup.pipx_blockers([old_python]))
        self.assertEqual(cleanup.pipx_blockers([old_python, install]), [])
        (venv / "bin/python").unlink()
        (venv / "bin/python").touch()
        (venv / "pyvenv.cfg").write_text(f"home = {old_python / 'bin'}\n")
        self.assertTrue(cleanup.pipx_blockers([old_python]))

    def test_macos_cleanup_blocks_all_removals_for_an_open_brew_target(self):
        bundle = self.root / "My Old App.app"
        cask = self.root / "Caskroom/old-app/2.0"
        cask.mkdir(parents=True)
        (cask / ".mise-cask.toml").write_text(f'[[targets]]\npath = "{bundle}"\n')
        formula = self.root / "Cellar/demo@2/2.1"
        formula.mkdir(parents=True)
        old_ruby = self.root / "vendor/portable ruby/3.0"
        packages = ("mise", "bootstrap", "packages", "prune", "--manager")
        previews = {
            ("mise", "prune", "--dry-run"): "mise pruned configuration links [dryrun]",
            ("mise", "ls", "--prunable", "--json"): "{}",
            ("brew", "cleanup", "--dry-run"): f"Would remove: {old_ruby} (40MB)",
            (*packages, "brew-cask", "--dry-run"): "remove brew-cask:old-app@2.0",
            (*packages, "brew", "--dry-run"): "remove brew:demo@2@2.1",
        }
        mutations = {
            ("mise", "prune", "--yes"),
            ("mise", "cache", "prune"),
            ("brew", "cleanup"),
            (*packages, "brew-cask", "--yes"),
            (*packages, "brew", "--yes"),
        }
        process_scan = (macos.LSOF, "-nP", "-F0pcn")
        for open_path in (
            bundle / "Contents/MacOS/Helper",
            formula / "bin/demo",
            old_ruby / "bin/ruby",
            None,
        ):
            with self.subTest(open_path=open_path):
                commands = dict(previews)
                commands[process_scan] = (
                    f"p42\0cRunner\0\nftxt\0n{open_path or '/usr/bin/sh'}\0\n"
                )
                if open_path is None:
                    commands.update(dict.fromkeys(mutations, ""))
                with (
                    patch.object(cleanup, "BREW_PREFIX", self.root),
                    patch.object(cleanup.shutil, "which", return_value="/fake/brew"),
                    patch.object(
                        cleanup,
                        "run",
                        side_effect=lambda *args, commands=commands, **_: commands[
                            args
                        ],
                    ) as run,
                    contextlib.redirect_stderr(io.StringIO()) as err,
                ):
                    plan = cleanup.preflight(show=False, darwin=True)
                    self.assertEqual(cleanup.prune(plan), int(open_path is not None))
                calls = [call.args for call in run.call_args_list]
                self.assertFalse(
                    mutations.intersection(calls[: calls.index(process_scan)])
                )
                self.assertEqual(
                    mutations.intersection(calls),
                    mutations if open_path is None else set(),
                )
                if open_path:
                    self.assertIn("PID 42", err.getvalue())

    def test_fish_or_herdr_invocation_only_opens_the_maintenance_window(self):
        with (
            patch.object(cleanup.sys, "platform", "darwin"),
            patch.dict(os.environ, MISE_ENV="work-macos"),
            patch.object(macos, "require_local_terminal"),
            patch.object(macos, "needs_handoff", return_value=True),
            patch.object(macos, "open_handoff") as handoff,
            patch.object(cleanup, "preflight") as preflight,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(cleanup.cleanup(apply=True), 0)
        handoff.assert_called_once_with("work-macos", cleanup.BREW_PREFIX)
        preflight.assert_not_called()

    def test_declining_confirmation_does_not_stop_services_or_prune(self):
        job = Mock(spec=macos.Job, target="gui/501/dev.mise.sketchybar", programs=())
        plan = cleanup.Plan([], [], [], [])
        with (
            patch.object(
                cleanup,
                "maintenance_plan",
                return_value=(
                    [macos.Change(job, {42}, True, "blocking keg")],
                    [],
                    [],
                    {},
                    [],
                ),
            ),
            patch("builtins.input", return_value=""),
            patch.object(cleanup, "run") as run,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(cleanup.macos_cleanup(plan, "work-macos"), 1)
        job.stop.assert_not_called()
        job.restore.assert_not_called()
        run.assert_not_called()

    def test_cleanup_rechecks_while_stopped_and_restores_after_refusal_or_failure(self):
        for blocker in (cleanup.Blocker("unmanaged process"), None):
            with self.subTest(blocker=blocker):
                events = []

                def job(name, events=events):
                    return Mock(
                        spec=macos.Job,
                        target=name,
                        label=name,
                        programs=(),
                        privileged=False,
                        stop=Mock(side_effect=lambda: events.append(f"stop {name}")),
                        restore=Mock(
                            side_effect=lambda: events.append(f"restore {name}")
                        ),
                    )

                def recheck(events=events, blocker=blocker, **_):
                    events.append("recheck")
                    return cleanup.Plan([], [], [], [blocker] if blocker else [])

                def failed_prune(*args, events=events, **_):
                    events.append("prune")
                    raise subprocess.CalledProcessError(1, args)

                with (
                    patch.object(
                        cleanup,
                        "maintenance_plan",
                        return_value=(
                            [
                                macos.Change(job("aerospace"), {42}, True, "blocking"),
                                macos.Change(job("sketchybar"), {43}, True, "blocking"),
                            ],
                            [],
                            [],
                            {},
                            [],
                        ),
                    ),
                    patch("builtins.input", return_value="yes"),
                    patch.object(cleanup, "preflight", side_effect=recheck),
                    patch.object(cleanup, "run", side_effect=failed_prune),
                    contextlib.redirect_stdout(io.StringIO()),
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    plan = cleanup.Plan([], [], [], [])
                    if blocker:
                        self.assertEqual(cleanup.macos_cleanup(plan, "work-macos"), 1)
                    else:
                        with self.assertRaises(subprocess.CalledProcessError):
                            cleanup.macos_cleanup(plan, "work-macos")
                self.assertEqual(
                    events,
                    [
                        "stop sketchybar",
                        "stop aerospace",
                        "recheck",
                        *([] if blocker else ["prune"]),
                        "restore aerospace",
                        "restore sketchybar",
                    ],
                )

    def test_only_blockers_are_paused_refresh_happens_after_verified_prune(self):
        events = []
        job = Mock(spec=macos.Job, target="blocking job", programs=(), privileged=False)
        stale = Mock(spec=macos.Job, target="stale job", programs=(), privileged=False)
        target = self.root / "old-keg"
        plan = cleanup.Plan([], [target], [], [])

        @contextlib.contextmanager
        def paused(jobs, *_):
            for item in jobs:
                events.append(f"stop {item.target}")
            yield
            for item in jobs:
                events.append(f"restore {item.target}")

        def prune(_):
            events.append("prune")
            return 0

        choices = [
            macos.Change(job, {42}, True, "blocking"),
            macos.Change(stale, {43}, False, "outdated"),
        ]
        with (
            patch.object(
                cleanup, "maintenance_plan", return_value=(choices, [], [], {}, [])
            ),
            patch("builtins.input", return_value="yes"),
            patch.object(
                cleanup, "preflight", side_effect=[plan, cleanup.Plan([], [], [], [])]
            ),
            patch.object(cleanup, "prune", side_effect=prune),
            patch.object(macos, "paused", side_effect=paused),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(cleanup.macos_cleanup(plan, "work-macos"), 0)
        self.assertEqual(
            events,
            [
                "stop blocking job",
                "prune",
                "restore blocking job",
                "stop stale job",
                "restore stale job",
            ],
        )

    def test_manager_success_with_leftover_targets_is_incomplete(self):
        plan = cleanup.Plan([], [self.root / "old-keg"], [], [])
        with (
            patch.object(
                cleanup, "maintenance_plan", return_value=([], [], [], {}, [])
            ),
            patch.object(cleanup, "preflight", return_value=plan),
            patch.object(cleanup, "run"),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()) as err,
        ):
            self.assertEqual(cleanup.macos_cleanup(plan, "work-macos"), 1)
        self.assertIn("old-keg", err.getvalue())
        self.assertIn("incomplete", err.getvalue())

    def test_handoff_holds_both_warnings_and_startup_failures_until_enter(self):
        fake = self.root / ".local/bin/mise"
        fake.parent.mkdir(parents=True)
        with (
            patch.dict(os.environ, HOME=str(self.root)),
            patch.object(macos.subprocess, "run") as launch,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            macos.open_handoff("work-macos", self.root)
        command = launch.call_args.args[0][-1].removeprefix("--initial-command=shell:")
        for exit_code, result in (
            (0, "Cleanup finished"),
            (42, "Cleanup incomplete (exit 42)"),
        ):
            with self.subTest(exit_code=exit_code):
                fake.write_text(
                    f"#!/bin/sh\nprintf 'Diagnostic from mise\\n' >&2\nexit {exit_code}\n"
                )
                fake.chmod(0o755)
                with subprocess.Popen(
                    ("/bin/sh", "-c", command),
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                ) as process:
                    try:
                        with self.assertRaises(subprocess.TimeoutExpired):
                            process.wait(timeout=0.2)
                        output, _ = process.communicate("\n", timeout=3)
                    finally:
                        if process.poll() is None:
                            process.kill()
                    self.assertEqual(process.returncode, exit_code)
                    self.assertIn("Diagnostic from mise", output)
                    self.assertIn(result, output)
                    self.assertIn("Press Enter", output)

    def test_current_binary_is_not_selected_but_its_blocking_child_is(self):
        installed = self.root / "now" / "runner"
        installed.parent.mkdir()
        installed.touch()
        job = Mock(
            spec=macos.Job,
            details=Mock(return_value="\tpid = 42\n"),
            privileged=False,
            label="runner",
            programs=(installed,),
        )
        # The mapped inode is the independently observable identity of the live binary.
        result = subprocess.CompletedProcess(
            [],
            0,
            stdout=f"p42\0\nftxt\0i{installed.stat().st_ino}\0n{installed}\0",
            stderr="",
        )
        tree = {42: (1, "runner"), 43: (42, "helper")}
        with (
            patch.object(macos, "jobs", return_value=[job]),
            patch.object(macos, "probe", return_value=result),
        ):
            self.assertEqual(
                macos.service_changes("work-macos", self.root, set(), tree), []
            )
            [change] = macos.service_changes("work-macos", self.root, {43}, tree)
            self.assertTrue(change.blocking)
            result.stdout = "p42\0\nftxt\0n/old/runner\0"
            [change] = macos.service_changes("work-macos", self.root, set(), tree)
            self.assertFalse(change.blocking)

    def test_failure_to_restore_one_job_does_not_skip_other_jobs(self):
        failed = Mock(spec=macos.Job, label="first")
        failed.restore.side_effect = ValueError("failed to start")
        remaining = Mock(spec=macos.Job, label="second")
        with (
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(ValueError, "first: failed to start"),
            macos.paused([failed, remaining], [], {}, self.root),
        ):
            pass
        remaining.restore.assert_called_once_with()

    def test_fish_pid_reuse_does_not_signal_the_replacement(self):
        with (
            patch.object(macos, "fish_identity", return_value="different start time"),
            patch.object(macos.os, "kill") as kill,
        ):
            macos.close_fish({42: "confirmed start time"})
        kill.assert_not_called()

    def test_replacement_symlink_pointing_into_a_pruned_keg_is_rejected(self):
        keg = self.root / "Cellar" / "gost" / "1"
        executable = keg / "bin/gost"
        executable.parent.mkdir(parents=True)
        executable.touch(mode=0o755)
        link = self.root / "gost"
        link.symlink_to(executable)
        with self.assertRaisesRegex(ValueError, "no retained replacement"):
            macos.check_replacements([link], [keg])
        macos.check_replacements([link], [keg.parent / "2"])


if __name__ == "__main__":
    unittest.main()
