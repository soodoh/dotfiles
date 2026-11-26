import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import cleanup
import cleanup_macos as macos


class FakeCleanupHost:
    """In-memory + tempdir Host adapter for testing cleanup through its public interface."""

    def __init__(
        self,
        root: Path,
        *,
        confirm: bool = True,
        herdr_env: bool = False,
        commands: dict[tuple[str, ...], str | list[str] | Exception] | None = None,
        probes: dict[tuple[str, ...], subprocess.CompletedProcess[str] | list] | None = None,
        uid: int = 501,
    ):
        self.root = root
        self.home = root / "home"
        self.home.mkdir(exist_ok=True)
        self.confirm_answer = confirm
        self.confirm_calls: list[str] = []
        self.commands = dict(commands or {})
        self.probes = dict(probes or {})
        self.uid = uid
        self.herdr_env = herdr_env
        self.calls: list[tuple[str, ...]] = []
        self.launchctl_calls: list[tuple[str, ...]] = []
        self.handoff_launches: list[tuple[str, ...]] = []
        self.kills: list[tuple[int, int]] = []
        self.jobs_loaded: dict[str, dict] = {}
        self.events: list[str] = []

    def add_loaded_job(
        self,
        name: str,
        *,
        pid: int,
        executable: Path | None = None,
        open_txt: str | None = None,
    ) -> Path:
        label = f"dev.mise.{name}"
        plist = self.home / f"Library/LaunchAgents/{label}.plist"
        plist.parent.mkdir(parents=True, exist_ok=True)
        plist.write_text(f"<plist>{label}</plist>\n")
        self.jobs_loaded[f"gui/{self.uid}/{label}"] = {
            "label": label,
            "plist": plist,
            "pid": pid,
            "running": True,
            "open_txt": open_txt or (str(executable) if executable else ""),
        }
        return plist

    def _next(self, table: dict, key: tuple[str, ...]):
        value = table[key]
        if isinstance(value, list):
            return value.pop(0) if len(value) > 1 else value[0]
        return value

    def run(self, args, **kwargs) -> subprocess.CompletedProcess[str]:
        cmd = tuple(args)
        self.calls.append(cmd)
        if cmd[:1] == ("/usr/bin/open",):
            self.handoff_launches.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd[:1] == ("/bin/launchctl",):
            self.launchctl_calls.append(cmd)
            action = cmd[1]
            target = cmd[-1]
            if action == "bootout":
                self.events.append(f"stop {target.rsplit('/', 1)[-1]}")
                if target in self.jobs_loaded:
                    self.jobs_loaded[target]["running"] = False
            elif action in {"bootstrap", "kickstart"}:
                if action == "bootstrap":
                    plist = Path(cmd[3])
                    label = plist.stem
                    target = f"{cmd[2]}/{label}"
                self.events.append(f"restore {target.rsplit('/', 1)[-1]}")
                if target in self.jobs_loaded:
                    self.jobs_loaded[target]["running"] = True
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd in self.commands:
            response = self._next(self.commands, cmd)
            if isinstance(response, Exception):
                raise response
            return subprocess.CompletedProcess(cmd, 0, stdout=response, stderr="")
        if cmd == ("mise", "prune", "--yes"):
            self.events.append("prune")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd == ("mise", "cache", "prune") or cmd == ("mise", "cache", "prune", "--dry-run"):
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd == ("mise", "prune", "--dry-run"):
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd == ("mise", "ls", "--prunable", "--json"):
            return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
        if cmd == ("brew", "cleanup", "--dry-run"):
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        if cmd[:5] == ("mise", "bootstrap", "packages", "prune", "--manager") and cmd[-1] == "--dry-run":
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{cmd[5]}: nothing to prune\n", stderr="")
        if cmd == (macos.LSOF, "-nP", "-F0pcn"):
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        raise AssertionError(f"Unexpected command: {cmd}")

    def probe(self, *args) -> subprocess.CompletedProcess[str]:
        cmd = tuple(args)
        if cmd in self.probes:
            return self._next(self.probes, cmd)
        if cmd[:2] == ("/bin/launchctl", "print"):
            target = cmd[2]
            info = self.jobs_loaded.get(target)
            if info and info["running"]:
                return subprocess.CompletedProcess(
                    cmd,
                    0,
                    stdout=f"path = {info['plist']}\npid = {info['pid']}\n",
                    stderr="",
                )
            return subprocess.CompletedProcess(
                cmd, 113, stdout="", stderr="Could not find service"
            )
        if cmd == ("/bin/ps", "-axo", "pid=,ppid=,comm="):
            lines = [
                f"{info['pid']} 1 {info['label']}"
                for info in self.jobs_loaded.values()
                if info["running"]
            ]
            return subprocess.CompletedProcess(
                cmd, 0, stdout="\n".join(lines) + ("\n" if lines else ""), stderr=""
            )
        if cmd == ("/bin/ps", "-p", "1", "-o", "ppid=,comm="):
            return subprocess.CompletedProcess(cmd, 0, stdout="0 /sbin/launchd\n", stderr="")
        if cmd[:3] == ("/bin/ps", "-p", ) or (len(cmd) == 5 and cmd[:2] == ("/bin/ps", "-p") and cmd[3] == "-o" and cmd[4] == "uid=,tty=,lstart=,comm="):
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="")
        if cmd == ("mise", "which", "herdr"):
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{self.root}/bin/herdr\n", stderr="")
        if len(cmd) == 4 and cmd[1:] == ("session", "list", "--json"):
            return subprocess.CompletedProcess(
                cmd, 0, stdout=json.dumps({"sessions": []}), stderr=""
            )
        if cmd[:5] == (macos.LSOF, "-nP", "-a", "-d", "txt"):
            pids = {int(part) for part in cmd[6].split(",")}
            entries = []
            for info in self.jobs_loaded.values():
                if info["pid"] in pids and info["open_txt"]:
                    entries.append(f"p{info['pid']}\0\nftxt\0n{info['open_txt']}\0")
            return subprocess.CompletedProcess(cmd, 0, stdout="".join(entries), stderr="")
        raise AssertionError(f"Unexpected probe: {cmd}")

    def confirm(self, prompt: str) -> bool:
        self.confirm_calls.append(prompt)
        return self.confirm_answer

    def kill(self, pid: int, sig: int) -> None:
        self.kills.append((pid, sig))

    @contextlib.contextmanager
    def maintenance_lock(self):
        yield

    @property
    def host(self) -> macos.Host:
        return macos.Host(
            brew_prefix=self.root,
            probe=self.probe,
            run=self.run,
            which=lambda name: f"{self.root}/bin/{name}" if name == "brew" else None,
            kill=self.kill,
            require_local_terminal=lambda: None,
            maintenance_lock=self.maintenance_lock,
            wait_for=lambda done, desc, **_: None if done() else (_ for _ in ()).throw(ValueError(f"timed out: {desc}")),
            confirm=self.confirm,
            ppid=lambda: 1,
            uid=lambda: self.uid,
            home=lambda: self.home,
            environ={"HERDR_ENV": "1"} if self.herdr_env else {},
        )


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()

    def test_mise_running_version_blocks_before_any_mutation(self):
        preview = "mise npm:pi@1.0.0 is kept: still running as pid 123 (node)"
        fake = FakeCleanupHost(
            self.root,
            commands={
                ("mise", "prune", "--dry-run"): preview,
                ("mise", "ls", "--prunable", "--json"): "{}",
            },
        )
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(
                cleanup.cleanup(apply=True, darwin=False, runner=fake.run), 1
            )
        self.assertEqual(len(fake.calls), 2)  # An apply would have called run again.
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
                fake = FakeCleanupHost(self.root, commands=commands)
                with contextlib.redirect_stderr(io.StringIO()) as err:
                    plan = cleanup.preflight(
                        show=False,
                        darwin=True,
                        runner=fake.run,
                        macos_host=fake.host,
                    )
                    self.assertEqual(
                        cleanup.prune(plan, runner=fake.run),
                        int(open_path is not None),
                    )
                self.assertFalse(
                    mutations.intersection(fake.calls[: fake.calls.index(process_scan)])
                )
                self.assertEqual(
                    mutations.intersection(fake.calls),
                    mutations if open_path is None else set(),
                )
                if open_path:
                    self.assertIn("PID 42", err.getvalue())

    def test_fish_or_herdr_invocation_only_opens_the_maintenance_window(self):
        fake = FakeCleanupHost(self.root, herdr_env=True)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(
                cleanup.cleanup(
                    apply=True,
                    darwin=True,
                    profile="work-macos",
                    runner=fake.run,
                    macos_host=fake.host,
                ),
                0,
            )
        self.assertEqual(len(fake.handoff_launches), 1)
        self.assertEqual(fake.calls, fake.handoff_launches)

    def test_declining_confirmation_does_not_stop_services_or_prune(self):
        keg = self.root / "Cellar/sketchybar/1.0"
        keg.mkdir(parents=True)
        replacement = self.root / "Cellar/sketchybar/2.0/bin/sketchybar"
        replacement.parent.mkdir(parents=True)
        replacement.touch(mode=0o755)
        link = self.root / "bin/sketchybar"
        link.parent.mkdir(parents=True)
        link.symlink_to(replacement)

        fake = FakeCleanupHost(
            self.root,
            confirm=False,
            commands={
                ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--dry-run"): "remove brew:sketchybar@1.0",
                (macos.LSOF, "-nP", "-F0pcn"): f"p42\0csketchybar\0\nftxt\0n{keg}/bin/sketchybar\0\n",
            },
        )
        fake.add_loaded_job("sketchybar", pid=42, executable=keg / "bin/sketchybar")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(
                cleanup.cleanup(
                    apply=True,
                    darwin=True,
                    profile="work-macos",
                    runner=fake.run,
                    macos_host=fake.host,
                ),
                1,
            )
        self.assertEqual(len(fake.confirm_calls), 1)
        self.assertEqual(fake.launchctl_calls, [])
        self.assertNotIn(("mise", "prune", "--yes"), fake.calls)

    def test_preview_reports_the_replacement_blocker_that_prevents_apply(self):
        keg = self.root / "Cellar/borders/1.9.0"
        binary = keg / "bin/borders"
        binary.parent.mkdir(parents=True)
        binary.touch(mode=0o755)
        link = self.root / "bin/borders"
        link.parent.mkdir(parents=True)
        link.symlink_to(binary)

        for missing in (False, True):
            with self.subTest(missing=missing):
                if missing:
                    binary.unlink()
                fake = FakeCleanupHost(
                    self.root,
                    commands={
                        ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--dry-run"): "remove brew:borders@1.9.0",
                        (macos.LSOF, "-nP", "-F0pcn"): f"p42\0cborders\0\nftxt\0n{keg}/bin/borders\0\n",
                    },
                )
                fake.add_loaded_job("borders", pid=42, executable=binary)
                with (
                    contextlib.redirect_stdout(io.StringIO()),
                    contextlib.redirect_stderr(io.StringIO()) as err,
                ):
                    self.assertEqual(
                        cleanup.cleanup(
                            apply=False,
                            darwin=True,
                            profile="personal-macos",
                            runner=fake.run,
                            macos_host=fake.host,
                        ),
                        0,
                    )
                    with self.assertRaisesRegex(
                        ValueError, "no retained replacement"
                    ) as refusal:
                        cleanup.cleanup(
                            apply=True,
                            darwin=True,
                            profile="personal-macos",
                            runner=fake.run,
                            macos_host=fake.host,
                        )
                self.assertIn(str(refusal.exception), err.getvalue())
                self.assertIn(str(link), str(refusal.exception))
                if missing:
                    self.assertIn("no executable file", str(refusal.exception))
                else:
                    self.assertIn(f"planned removal: {keg}", str(refusal.exception))
                self.assertEqual(fake.confirm_calls, [])
                self.assertEqual(fake.launchctl_calls, [])

    def test_cleanup_rechecks_while_stopped_and_restores_after_refusal_or_failure(self):
        keg = self.root / "Cellar/sketchybar/1.0"
        keg.mkdir(parents=True)
        replacement_sb = self.root / "Cellar/sketchybar/2.0/bin/sketchybar"
        replacement_sb.parent.mkdir(parents=True)
        replacement_sb.touch(mode=0o755)
        (self.root / "bin").mkdir(exist_ok=True)
        (self.root / "bin/sketchybar").symlink_to(replacement_sb)

        for blocker_on_recheck in (True, False):
            with self.subTest(blocker=blocker_on_recheck):
                fake = FakeCleanupHost(
                    self.root,
                    confirm=True,
                    commands={
                        ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--dry-run"): "remove brew:sketchybar@1.0",
                        (macos.LSOF, "-nP", "-F0pcn"): [
                            f"p42\0cAeroSpace\0\nftxt\0n{keg}/a\0\np43\0csketchybar\0\nftxt\0n{keg}/b\0\n",
                            f"p99\0cother\0\nftxt\0n{keg}/c\0\n"
                            if blocker_on_recheck
                            else "",
                        ],
                        ("mise", "prune", "--yes"): subprocess.CalledProcessError(
                            1, ("mise", "prune", "--yes")
                        ),
                    },
                )
                aerospace = fake.home / "Applications/AeroSpace.app/Contents/MacOS/AeroSpace"
                aerospace.parent.mkdir(parents=True, exist_ok=True)
                aerospace.touch(mode=0o755)
                fake.add_loaded_job("aerospace", pid=42, executable=aerospace)
                fake.add_loaded_job("sketchybar", pid=43, executable=replacement_sb)
                with (
                    contextlib.redirect_stdout(io.StringIO()),
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    if blocker_on_recheck:
                        self.assertEqual(
                            cleanup.cleanup(
                                apply=True,
                                darwin=True,
                                profile="work-macos",
                                runner=fake.run,
                                macos_host=fake.host,
                            ),
                            1,
                        )
                    else:
                        with self.assertRaises(subprocess.CalledProcessError):
                            cleanup.cleanup(
                                apply=True,
                                darwin=True,
                                profile="work-macos",
                                runner=fake.run,
                                macos_host=fake.host,
                            )
                self.assertEqual(
                    fake.events,
                    [
                        "stop dev.mise.sketchybar",
                        "stop dev.mise.aerospace",
                        "restore dev.mise.aerospace",
                        "restore dev.mise.sketchybar",
                    ],
                )
                if blocker_on_recheck:
                    self.assertNotIn(("mise", "prune", "--yes"), fake.calls)
                else:
                    self.assertIn(("mise", "prune", "--yes"), fake.calls)

    def test_only_blockers_are_paused_refresh_happens_after_verified_prune(self):
        old_sb = self.root / "Cellar/sketchybar/1.0"
        old_sb.mkdir(parents=True)
        new_sb = self.root / "Cellar/sketchybar/2.0/bin/sketchybar"
        new_sb.parent.mkdir(parents=True)
        new_sb.touch(mode=0o755)
        new_borders = self.root / "Cellar/borders/2.0/bin/borders"
        new_borders.parent.mkdir(parents=True)
        new_borders.touch(mode=0o755)
        (self.root / "bin").mkdir(exist_ok=True)
        (self.root / "bin/sketchybar").symlink_to(new_sb)
        (self.root / "bin/borders").symlink_to(new_borders)

        fake = FakeCleanupHost(
            self.root,
            confirm=True,
            commands={
                ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--dry-run"): [
                    "remove brew:sketchybar@1.0",
                    "remove brew:sketchybar@1.0",
                    "brew: nothing to prune\n",
                ],
                ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--yes"): "",
                (macos.LSOF, "-nP", "-F0pcn"): [
                    f"p42\0csketchybar\0\nftxt\0n{old_sb}/bin/sketchybar\0\n",
                    "",
                ],
            },
        )
        fake.add_loaded_job("sketchybar", pid=42, open_txt=str(old_sb / "bin/sketchybar"))
        fake.add_loaded_job("borders", pid=43, open_txt="/old/borders")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(
                cleanup.cleanup(
                    apply=True,
                    darwin=True,
                    profile="work-macos",
                    runner=fake.run,
                    macos_host=fake.host,
                ),
                0,
            )
        self.assertEqual(
            fake.events,
            [
                "stop dev.mise.sketchybar",
                "prune",
                "restore dev.mise.sketchybar",
                "stop dev.mise.borders",
                "restore dev.mise.borders",
            ],
        )

    def test_manager_success_with_leftover_targets_is_incomplete(self):
        keg = self.root / "Cellar/demo/1.0"
        keg.mkdir(parents=True)
        fake = FakeCleanupHost(
            self.root,
            commands={
                ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--dry-run"): "remove brew:demo@1.0",
                ("mise", "bootstrap", "packages", "prune", "--manager", "brew", "--yes"): "",
            },
        )
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()) as err,
        ):
            self.assertEqual(
                cleanup.cleanup(
                    apply=True,
                    darwin=True,
                    profile="work-macos",
                    runner=fake.run,
                    macos_host=fake.host,
                ),
                1,
            )
        self.assertIn(str(keg), err.getvalue())
        self.assertIn("incomplete", err.getvalue())

    def test_handoff_holds_both_warnings_and_startup_failures_until_enter(self):
        fake_host = FakeCleanupHost(self.root)
        fake_mise = fake_host.home / ".local/bin/mise"
        fake_mise.parent.mkdir(parents=True)
        with contextlib.redirect_stdout(io.StringIO()):
            macos.open_handoff(
                "work-macos", cleanup.worker_command(), env=fake_host.host
            )
        command = fake_host.handoff_launches[0][-1].removeprefix(
            "--initial-command=shell:"
        )
        for exit_code, result in (
            (0, "Cleanup finished"),
            (42, "Cleanup incomplete (exit 42)"),
        ):
            with self.subTest(exit_code=exit_code):
                fake_mise.write_text(
                    f"#!/bin/sh\nprintf 'Diagnostic from mise\\n' >&2\nexit {exit_code}\n"
                )
                fake_mise.chmod(0o755)
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
        installed = self.root / "Cellar/sketchybar/2.0/bin/sketchybar"
        installed.parent.mkdir(parents=True)
        installed.touch()
        (self.root / "bin").mkdir(exist_ok=True)
        (self.root / "bin/sketchybar").symlink_to(installed)

        lsof_result = subprocess.CompletedProcess(
            [],
            0,
            stdout=f"p42\0\nftxt\0i{installed.stat().st_ino}\0n{installed}\0",
            stderr="",
        )
        fake = FakeCleanupHost(
            self.root,
            probes={
                (macos.LSOF, "-nP", "-a", "-d", "txt", "-p", "42,43", "-F0pfin"): lsof_result,
            },
        )
        fake.add_loaded_job("sketchybar", pid=42, executable=installed)
        tree = {42: (1, "sketchybar"), 43: (42, "helper")}
        self.assertEqual(
            macos.service_changes("work-macos", set(), tree, env=fake.host), []
        )
        [change] = macos.service_changes("work-macos", {43}, tree, env=fake.host)
        self.assertTrue(change.blocking)
        lsof_result.stdout = "p42\0\nftxt\0n/old/sketchybar\0"
        [change] = macos.service_changes("work-macos", set(), tree, env=fake.host)
        self.assertFalse(change.blocking)

    def test_failure_to_restore_one_job_does_not_skip_other_jobs(self):
        failed = Mock(spec=macos.UserAgentJob, label="first")
        failed.restore.side_effect = ValueError("failed to start")
        remaining = Mock(spec=macos.UserAgentJob, label="second")
        env = FakeCleanupHost(self.root).host
        with (
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(ValueError, "first: failed to start"),
            macos.paused([failed, remaining], [], {}, env=env),
        ):
            pass
        remaining.restore.assert_called_once_with(env=env)

    def test_user_agent_job_refuses_system_domain(self):
        with self.assertRaisesRegex(ValueError, "user LaunchAgents"):
            macos.UserAgentJob(
                "system",
                "dev.dotfiles.tailscaled",
                self.root / "tailscaled.plist",
                (),
            )

    def test_fish_pid_reuse_does_not_signal_the_replacement(self):
        fake = FakeCleanupHost(
            self.root,
            probes={
                ("/bin/ps", "-p", "42", "-o", "uid=,tty=,lstart=,comm="): subprocess.CompletedProcess(
                    [],
                    0,
                    stdout="501 ttys001 Mon Nov 26 00:00:00 2026 -fish\n",
                    stderr="",
                ),
            },
        )
        macos.close_fish({42: "confirmed start time"}, env=fake.host)
        self.assertEqual(fake.kills, [])

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
