import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import tailscale_macos as ts
import tailscale_migrate_macos as migration


class TailscaleMigrationTests(unittest.TestCase):
    def test_failed_switch_restarts_previous_daemon_and_leaves_its_files(self):
        job = ts.macos.Job(
            "system",
            migration.LEGACY,
            Path("/Library/LaunchDaemons") / f"{migration.LEGACY}.plist",
            (),
        )
        system = migration.LegacyService(
            job, installed=True, loaded=True, disabled=False
        )
        user = Mock()
        repair = Mock()
        plan = Mock()
        plan.job.details.return_value = (
            ""  # The core switch rolled back the new service.
        )
        plan.commands.return_value = []
        plan.switch.side_effect = ValueError("new daemon failed")
        loaded, enabled = True, True

        def root(command):
            nonlocal loaded, enabled
            action = command[1]
            if action == "disable":
                enabled = False
            elif action == "bootout":
                loaded = False
            elif action == "enable":
                enabled = True
            elif action == "bootstrap":
                self.assertTrue(enabled)
                loaded = True
            else:
                self.fail(f"unexpected mutation: {command}")

        with (
            patch.object(ts, "authorize") as auth,
            patch.object(ts, "root", side_effect=root),
            patch.object(
                ts.macos.Job, "details", side_effect=lambda: "running" if loaded else ""
            ),
            self.assertRaisesRegex(ValueError, "new daemon failed"),
        ):
            migration.apply(Mock(), plan, system, user, [repair], deploy=True)
        self.assertTrue(loaded and enabled)
        self.assertIn(ts.launch(*job.bootstrap_args), auth.call_args.args[0])
        user.retire.assert_not_called()
        self.assertEqual(repair.run.call_args_list[0].args, (ts.check_authorized,))
        self.assertEqual(repair.run.call_count, 1)

    def test_retiring_leftovers_does_not_cycle_the_current_daemon(self):
        system, user, repair, plan = Mock(), Mock(), Mock(), Mock()
        system.commands.return_value = [
            ts.remove(Path("/Library/LaunchDaemons") / f"{migration.LEGACY}.plist")
        ]
        with (
            patch.object(ts, "authorize"),
            patch.object(ts, "live_version", return_value="current"),
        ):
            migration.apply(Mock(), plan, system, user, [repair], deploy=False)
        plan.stage.assert_not_called()
        plan.switch.assert_not_called()
        system.retire.assert_called_once_with()
        user.retire.assert_called_once_with()
        self.assertEqual(repair.run.call_args_list[-1].args, (ts.root,))

    def test_ownership_repair_never_follows_a_symlink_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory).resolve()
            actual = prefix / "real-directory"
            actual.mkdir()
            (actual / "bin").mkdir()
            (prefix / "alias").symlink_to(actual, target_is_directory=True)
            path = prefix / "alias/bin"
            repair = migration.Repair(path, path.lstat())
            operation = Mock()
            with self.assertRaises(OSError):
                repair.run(operation)
            operation.assert_not_called()

    def test_ownership_repair_is_relative_to_verified_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory).resolve()
            path = parent / "bin"
            path.mkdir()
            repair = migration.Repair(path, path.lstat())
            cwd = Path.cwd()
            seen = []
            repair.run(lambda command: seen.append((Path.cwd(), command)))
            self.assertEqual(
                seen, [(parent, (migration.CHOWN, "-h", str(os.getuid()), "./bin"))]
            )
            self.assertEqual(Path.cwd(), cwd)


if __name__ == "__main__":
    unittest.main()
