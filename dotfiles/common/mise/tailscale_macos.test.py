import contextlib
import io
import json
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import tailscale_macos as ts


def make_plist(daemon_path: Path) -> bytes:
    return plistlib.dumps(
        {
            "Label": ts.LABEL,
            "ProgramArguments": [str(daemon_path)],
            "RunAtLoad": True,
            "KeepAlive": True,
        }
    )


class FakeTailscaleHost:
    """In-memory + tempdir adapter exercising deploy(), inspect(), stage(), and switch()."""

    def __init__(
        self,
        root: Path,
        *,
        candidate_version: str = "1.2.0-commit",
        candidate_binary: bytes = b"new-binary",
        installed_binary: bytes | None = b"old-binary",
        plist_installed: bool = True,
        loaded: bool = True,
        disabled: bool = False,
        live_version: str | None = "1.1.0-commit",
        corrupt_staged_binary: bool = False,
        verify_version: str | None = None,
        confirm_error: Exception | None = None,
    ):
        self.root = root
        self.brew = root / "brew"
        self.keg = self.brew / "Cellar/tailscale/1.2.0/bin/tailscaled"
        self.keg.parent.mkdir(parents=True)
        self.keg.write_bytes(candidate_binary)
        self.keg.chmod(0o755)
        opt_bin = self.brew / "opt/tailscale/bin"
        opt_bin.mkdir(parents=True)
        (opt_bin / "tailscaled").symlink_to(self.keg)
        (self.brew / "bin").mkdir(parents=True)
        self.cli = self.brew / "bin/tailscale"
        self.cli.write_text("#!/bin/sh\n")
        self.cli.chmod(0o755)

        support = root / "support"
        support.mkdir(mode=0o755)
        daemon_dir = support / "dotfiles-tailscale"
        daemons = root / "daemons"
        daemons.mkdir(mode=0o755)
        plist = daemons / f"{ts.LABEL}.plist"
        source_plist = root / f"source-{ts.LABEL}.plist"

        self.paths = ts.Paths(
            daemon_dir=daemon_dir,
            plist=plist,
            source_plist=source_plist,
            protected_parents=(root, support),
        )
        source_plist.write_bytes(make_plist(self.paths.daemon))

        if installed_binary is not None:
            daemon_dir.mkdir(mode=0o755, exist_ok=True)
            self.paths.daemon.write_bytes(installed_binary)
            self.paths.daemon.chmod(0o755)
        if plist_installed:
            plist.write_bytes(make_plist(self.paths.daemon))
            plist.chmod(0o644)

        self.candidate_version = candidate_version
        self.loaded = loaded
        self.disabled = disabled
        self.live_version = live_version
        self.corrupt_staged_binary = corrupt_staged_binary
        self.verify_version = verify_version
        self.confirm_error = confirm_error
        self.authorized_commands: list[tuple[str, ...]] = []
        self.executed_root: list[tuple[str, ...]] = []
        self.confirm = Mock(side_effect=self._confirm)
        self.authorize = Mock(side_effect=self._authorize)

    def _confirm(self, _message: str) -> None:
        if self.confirm_error is not None:
            raise self.confirm_error

    def _authorize(self, commands: list[tuple[str, ...]]) -> None:
        self.authorized_commands = list(commands)

    def probe(self, *args: str) -> subprocess.CompletedProcess[str]:
        if args == ("brew", "--prefix"):
            return subprocess.CompletedProcess(args, 0, f"{self.brew}\n", "")
        if args == (str(self.keg), "--version"):
            return subprocess.CompletedProcess(
                args, 0, f"long version: {self.candidate_version}\n", ""
            )
        if args == (str(self.cli), "version", "--json"):
            return subprocess.CompletedProcess(
                args, 0, json.dumps({"long": self.candidate_version}), ""
            )
        if args == (str(self.cli), "version", "--json", "--daemon"):
            if self.live_version is None:
                return subprocess.CompletedProcess(args, 1, "", "not running")
            return subprocess.CompletedProcess(
                args, 0, json.dumps({"daemonLong": self.live_version}), ""
            )
        if args[:2] == (ts.host.LAUNCHCTL, "print"):
            if not self.loaded:
                return subprocess.CompletedProcess(
                    args, 113, "", "Could not find service"
                )
            return subprocess.CompletedProcess(
                args,
                0,
                f"\tpath = {self.paths.plist}\n\tpid = 4242\n",
                "",
            )
        if args[:2] == (ts.host.LAUNCHCTL, "print-disabled"):
            state = "disabled" if self.disabled else "enabled"
            return subprocess.CompletedProcess(
                args, 0, f'\t"{ts.LABEL}" => {state}\n', ""
            )
        raise AssertionError(f"unexpected probe command: {args!r}")

    def root_exec(self, command: tuple[str, ...], data: bytes | None = None) -> None:
        self.executed_root.append(command)
        if command[0] == ts.INSTALL and "-d" in command:
            target = Path(command[-1])
            target.mkdir(parents=True, exist_ok=True)
            target.chmod(0o755)
        elif command[0] == ts.TEE:
            target = Path(command[1])
            payload = (
                b"corrupt"
                if self.corrupt_staged_binary and target == self.paths.next
                else (data or b"")
            )
            target.write_bytes(payload)
        elif command[0] == "/bin/chmod":
            Path(command[2]).chmod(int(command[1], 8))
        elif command[0] == ts.INSTALL:
            src, dst = Path(command[-2]), Path(command[-1])
            shutil.copy2(src, dst)
            dst.chmod(int(command[command.index("-m") + 1], 8))
        elif command[0] == "/bin/mv":
            shutil.move(command[-2], command[-1])
        elif command[0] == "/bin/rm":
            Path(command[-1]).unlink(missing_ok=True)
        elif command[0] == ts.host.LAUNCHCTL:
            action = command[1]
            if action == "bootout":
                self.loaded = False
                self.live_version = None
            elif action == "bootstrap":
                self.loaded = True
                if self.verify_version is not None:
                    self.live_version = self.verify_version
                else:
                    self.live_version = self.candidate_version
            elif action == "enable":
                self.disabled = False
            elif action == "disable":
                self.disabled = True
            else:
                raise AssertionError(f"unexpected launchctl action: {command!r}")
        else:
            raise AssertionError(f"unexpected root command: {command!r}")

    def wait_for(self, done, description, *, timeout=10):
        if not done():
            raise ValueError(f"timed out waiting for {description}")

    def env(self) -> ts.Host:
        return ts.Host(
            paths=self.paths,
            probe=self.probe,
            authorize=self.authorize,
            root=self.root_exec,
            require_local_terminal=lambda: None,
            confirm=self.confirm,
            wait_for=self.wait_for,
            owner_uid=os.getuid(),
            check_writable=False,
        )


class TailscaleDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.root.chmod(0o755)

    def test_system_plist_executes_the_protected_daemon(self):
        config = ts.validate_plist(ts.SOURCE_PLIST.read_bytes())
        config["ProgramArguments"] = ["/Users/someone/bin/tailscaled"]
        with self.assertRaisesRegex(ValueError, "protected daemon"):
            ts.validate_plist(plistlib.dumps(config))

    def test_every_executed_root_command_was_preauthorized(self):
        fake = FakeTailscaleHost(
            self.root,
            installed_binary=None,
            plist_installed=False,
            loaded=False,
            disabled=True,
            live_version=None,
        )
        with contextlib.redirect_stdout(io.StringIO()):
            ts.deploy(refresh=False, env=fake.env())
        self.assertTrue(fake.loaded)
        self.assertFalse(fake.disabled)
        self.assertEqual(fake.paths.daemon.read_bytes(), b"new-binary")
        self.assertTrue(fake.paths.plist.is_file())
        self.assertTrue(set(fake.executed_root).issubset(set(fake.authorized_commands)))

    def test_version_check_failure_restores_the_installed_binary_and_job(self):
        fake = FakeTailscaleHost(self.root, verify_version="1.1.0-wrong")
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaisesRegex(ValueError, "timed out waiting for"),
        ):
            ts.deploy(refresh=True, env=fake.env())
        self.assertTrue(fake.loaded)
        self.assertEqual(fake.paths.daemon.read_bytes(), b"old-binary")
        self.assertTrue(set(fake.executed_root).issubset(set(fake.authorized_commands)))

    def test_corrupt_staging_is_rejected_before_any_restart(self):
        fake = FakeTailscaleHost(self.root, corrupt_staged_binary=True)
        with (
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(ValueError, "staged daemon differs"),
        ):
            ts.deploy(refresh=True, env=fake.env())
        self.assertFalse(
            any(cmd[0] == ts.host.LAUNCHCTL for cmd in fake.executed_root)
        )
        self.assertEqual(fake.paths.daemon.read_bytes(), b"old-binary")

    def test_protected_rejects_symlinks_and_group_writable_paths(self):
        fake = FakeTailscaleHost(self.root)
        fake.paths.daemon.chmod(0o775)
        with self.assertRaisesRegex(ValueError, "not a protected root-owned file"):
            ts.deploy(refresh=True, env=fake.env())

        fake.paths.daemon.unlink()
        fake.paths.daemon.symlink_to(fake.keg)
        with self.assertRaisesRegex(ValueError, "not a protected root-owned file"):
            ts.deploy(refresh=True, env=fake.env())

    def test_upgrade_leaves_current_or_unloaded_daemons_alone(self):
        for loaded, binary, live in (
            (True, b"new-binary", "1.2.0-commit"),
            (False, b"old-binary", None),
        ):
            with self.subTest(loaded=loaded):
                sub_root = self.root / f"case-{loaded}"
                sub_root.mkdir(mode=0o755)
                fake = FakeTailscaleHost(
                    sub_root,
                    installed_binary=binary,
                    loaded=loaded,
                    live_version=live,
                )
                with contextlib.redirect_stdout(io.StringIO()):
                    ts.deploy(refresh=True, env=fake.env())
                fake.authorize.assert_not_called()
                fake.confirm.assert_not_called()
                self.assertEqual(fake.executed_root, [])

    def test_upgrade_refreshes_a_running_daemon_only_after_confirmation(self):
        fake = FakeTailscaleHost(self.root, confirm_error=ValueError("cancelled"))
        with (
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(ValueError, "cancelled"),
        ):
            ts.deploy(refresh=True, env=fake.env())
        fake.authorize.assert_not_called()
        self.assertEqual(fake.executed_root, [])


if __name__ == "__main__":
    unittest.main()
