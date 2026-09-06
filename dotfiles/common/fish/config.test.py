"""Exercise the real config with no user config, secrets, or real multiplexer."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

CONFIG = Path(__file__).with_name("config.fish").resolve()
FISH = shutil.which("fish")


class AutostartTests(unittest.TestCase):
    def startup(self, *, interactive=True, available=True, markers=None, exit_code=0):
        self.assertIsNotNone(FISH, "fish must be installed")
        with tempfile.TemporaryDirectory(prefix="fish-herdr-test-") as directory:
            home = Path(directory)
            bin_dir = home / ".local/bin"
            bin_dir.mkdir(parents=True)
            log = home / "calls"
            # PATH contains only fakes. Even system/package-manager installs cannot leak in.
            for name in ("mise", "fnm", "starship", "zoxide", "atuin", "fzf", "tty"):
                executable = bin_dir / name
                executable.write_text(
                    f'#!/bin/sh\nprintf "%s\\n" "{name} $*" >> "$CALLS"\n'
                )
                executable.chmod(0o755)
            if available:
                executable = bin_dir / "herdr"
                executable.write_text(
                    '#!/bin/sh\nprintf "herdr argc=%s\\n" "$#" >> "$CALLS"\n'
                    f"exit {exit_code}\n"
                )
                executable.chmod(0o755)
            secrets = home / ".config/fish/conf.d/00-secrets.fish"
            secrets.parent.mkdir(parents=True)
            secrets.write_text("echo SECRET_WAS_SOURCED; exit 99\n")
            env = {
                "HOME": str(home),
                "XDG_CONFIG_HOME": str(home / ".config"),
                "XDG_DATA_HOME": str(home / ".local/share"),
                "XDG_CACHE_HOME": str(home / ".cache"),
                "PATH": str(bin_dir),
                "TERM": "xterm-256color",
                "CALLS": str(log),
                "CONFIG_UNDER_TEST": str(CONFIG),
                **(markers or {}),
            }
            result = subprocess.run(
                [
                    FISH,
                    "--no-config",
                    *(["--interactive"] if interactive else []),
                    "--command",
                    'source "$CONFIG_UNDER_TEST"; echo OUTER_SHELL_USABLE',
                ],
                env=env,
                cwd=home,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "OUTER_SHELL_USABLE")
            return log.read_text().splitlines() if log.exists() else []

    def test_eligible_once_and_detach_returns(self):
        calls = self.startup(markers={"TERM_PROGRAM": "ghostty"})
        self.assertEqual([c for c in calls if c.startswith("herdr")], ["herdr argc=0"])

    def test_unset_term_program(self):
        self.assertEqual(self.startup().count("herdr argc=0"), 1)

    def test_failed_launch_does_not_loop_or_replace_shell(self):
        self.assertEqual(self.startup(exit_code=1).count("herdr argc=0"), 1)

    def test_noninteractive(self):
        self.assertFalse(any(c.startswith("herdr") for c in self.startup(interactive=False)))

    def test_missing_executable(self):
        self.assertFalse(
            any(c.startswith("herdr") for c in self.startup(available=False))
        )

    def test_nested_and_editor_exclusions(self):
        for markers in (
            {"HERDR_ENV": "1", "HERDR_PANE_ID": "pane-1"},
            {"HERDR_ENV": "1"},  # Popup shells deliberately have no pane ID.
            {"HERDR_PANE_ID": "pane-1"},
            {"HERDR_ENV": ""},
            {"TMUX": "/tmp/existing,123,0"},
            {"VSCODE_RESOLVING_ENVIRONMENT": "1"},
            {"TERM_PROGRAM": "vscode"},
            {"TERM_PROGRAM": "zed"},
        ):
            with self.subTest(markers=markers):
                self.assertFalse(
                    any(c.startswith("herdr") for c in self.startup(markers=markers))
                )


if __name__ == "__main__":
    unittest.main()
