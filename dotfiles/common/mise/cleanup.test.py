import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cleanup


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
        process_scan = ("lsof", "-nP", "-F0pcn")
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
                    patch.object(cleanup.sys, "platform", "darwin"),
                    patch.dict(os.environ, MISE_ENV="work-macos"),
                    patch.dict(cleanup.ENV, MISE_SYSTEM_BREW_PREFIX=str(self.root)),
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
                    self.assertEqual(
                        cleanup.cleanup(apply=True), int(open_path is not None)
                    )
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


if __name__ == "__main__":
    unittest.main()
