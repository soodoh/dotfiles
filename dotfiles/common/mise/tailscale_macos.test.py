import contextlib
import hashlib
import io
import plistlib
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import tailscale_macos as ts


def candidate():
    return ts.Candidate(
        Path("/brew"), Path("/brew/tailscaled"), b"new", b"plist", "1.2.0-commit"
    )


class TailscaleDeploymentTests(unittest.TestCase):
    def test_system_plist_executes_the_protected_daemon(self):
        config = ts.validate_plist(ts.SOURCE_PLIST.read_bytes())
        config["ProgramArguments"] = ["/Users/someone/bin/tailscaled"]
        with self.assertRaisesRegex(ValueError, "protected daemon"):
            ts.validate_plist(plistlib.dumps(config))

    def test_version_check_failure_restores_the_installed_binary_and_job(self):
        files = {ts.DAEMON: b"old", ts.NEXT: b"new"}
        running = True

        def root(command, _data=None):
            nonlocal running
            if command[0] == ts.INSTALL:
                files[Path(command[-1])] = files[Path(command[-2])]
            elif command[0] == "/bin/mv":
                files[Path(command[-1])] = files.pop(Path(command[-2]))
            elif command[1] == "bootout":
                self.assertTrue(running)
                running = False
            elif command[1] == "bootstrap":
                self.assertFalse(running)
                running = True
            else:
                self.fail(command)

        job = ts.macos.Job("system", ts.LABEL, ts.PLIST, (ts.DAEMON,))
        plan = ts.Deployment(job, True, True, True, True, False)
        # The previous copy is created before either process is touched.
        files[ts.PREVIOUS] = files[ts.DAEMON]
        with (
            patch.object(ts, "root", side_effect=root),
            patch.object(
                ts.macos.Job,
                "details",
                side_effect=lambda: "running" if running else "",
            ),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaisesRegex(ValueError, "wrong version"),
        ):
            plan.switch(Mock(side_effect=ValueError("wrong version")))
        self.assertTrue(running)
        self.assertEqual(files[ts.DAEMON], b"old")

    def test_corrupt_staging_is_rejected_before_any_restart(self):
        job = ts.macos.Job("system", ts.LABEL, ts.PLIST, (ts.DAEMON,))
        plan = ts.Deployment(job, True, True, True, True, False)
        with (
            patch.object(ts, "root") as root,
            patch.object(ts, "protected", return_value=True),
            patch.object(
                ts, "digest", return_value=hashlib.sha256(b"corrupt").digest()
            ),
            self.assertRaisesRegex(ValueError, "staged daemon differs"),
        ):
            plan.stage(candidate())
        for call in root.call_args_list:
            self.assertNotEqual(call.args[0][0], ts.macos.LAUNCHCTL)
            if call.args[0][0] == ts.INSTALL and "-d" not in call.args[0]:
                self.assertEqual(call.args[0][-2], str(ts.DAEMON))

    def test_upgrade_leaves_current_or_unloaded_daemons_alone(self):
        for loaded, changed, live in (
            (True, False, "1.2.0-commit"),
            (False, True, None),
        ):
            with (
                self.subTest(loaded=loaded),
                patch.object(ts.Path, "exists", return_value=True),
                patch.object(ts, "load_candidate", return_value=candidate()),
                patch.object(
                    ts,
                    "inspect",
                    return_value=Mock(loaded=loaded, binary_changed=changed),
                ),
                patch.object(ts, "live_version", return_value=live),
                patch.object(ts, "authorize") as authorize,
                patch.object(ts, "confirm") as confirm,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                ts.deploy(refresh=True)
                authorize.assert_not_called()
                confirm.assert_not_called()

    def test_upgrade_refreshes_a_running_daemon_only_after_confirmation(self):
        plan = Mock(loaded=True, binary_changed=True)
        with (
            patch.object(ts.Path, "exists", return_value=True),
            patch.object(ts, "load_candidate", return_value=candidate()),
            patch.object(ts, "inspect", return_value=plan),
            patch.object(ts, "live_version", return_value="1.1.0-commit"),
            patch.object(ts.macos, "require_local_terminal"),
            patch.object(ts, "confirm", side_effect=ValueError("cancelled")),
            patch.object(ts, "authorize") as authorize,
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(ValueError, "cancelled"),
        ):
            ts.deploy(refresh=True)
        authorize.assert_not_called()
        plan.switch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
