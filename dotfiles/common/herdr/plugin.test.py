"""Exercise guards with disposable Git checkouts; never install or execute a plugin."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import plugin


class PluginTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="herdr-plugin-test-")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.enterContext(
            patch.dict(
                os.environ,
                {
                    "HOME": str(self.home),
                    "XDG_CONFIG_HOME": str(self.home / "config"),
                    "MISE_ENV": "personal-macos",
                    "PATH": os.environ["PATH"],
                    "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_AUTHOR_NAME": "Test",
                    "GIT_AUTHOR_EMAIL": "test@example.invalid",
                    "GIT_COMMITTER_NAME": "Test",
                    "GIT_COMMITTER_EMAIL": "test@example.invalid",
                },
                clear=True,
            )
        )
        self.enterContext(
            patch.object(plugin.platform, "system", return_value="Darwin")
        )
        self.config_dir = self.home / "config/herdr"
        self.config_dir.mkdir(parents=True)
        self.registry = self.config_dir / "plugins.json"
        self.checkout = self.config_dir / "plugins/github" / plugin.CHECKOUT
        self.upstream = self.home / "upstream"
        plugin.git("init", "--quiet", self.upstream)
        (self.upstream / ".gitignore").write_text("/target/\n")
        (self.upstream / "herdr-plugin.toml").write_text(f'id = "{plugin.PLUGIN}"\n')
        plugin.git("-C", self.upstream, "add", ".")
        plugin.git("-C", self.upstream, "commit", "--quiet", "-m", "initial")
        self.old = plugin.git("-C", self.upstream, "rev-parse", "HEAD")
        (self.upstream / "source").write_text("next revision\n")
        plugin.git("-C", self.upstream, "add", ".")
        plugin.git("-C", self.upstream, "commit", "--quiet", "-m", "next")
        self.new = plugin.git("-C", self.upstream, "rev-parse", "HEAD")
        self.installer = self.enterContext(
            patch.object(plugin, "install", side_effect=self.seed_install)
        )

    def seed_install(self, pin):
        if self.checkout.exists():
            shutil.rmtree(
                self.checkout
            )  # Disposable fixture only, not production behavior.
        plugin.git("clone", "--quiet", self.upstream, self.checkout)
        plugin.git("-C", self.checkout, "checkout", "--quiet", "--detach", pin)
        binary = self.checkout / "target/release" / plugin.PLUGIN
        binary.parent.mkdir(parents=True)
        binary.write_text("fixture only: must never execute\n")
        binary.chmod(0o755)
        self.entry = {
            "plugin_id": plugin.PLUGIN,
            "enabled": True,
            "plugin_root": str(self.checkout),
            "manifest_path": str(self.checkout / "herdr-plugin.toml"),
            "source": {
                "kind": "github",
                "owner": "yankewei",
                "repo": plugin.PLUGIN,
                "requested_ref": pin,
                "resolved_commit": pin,
                "managed_path": str(self.checkout),
            },
        }
        self.save_registry()

    def save_registry(self):
        self.registry.write_text(json.dumps([self.entry]))

    def test_bootstrap_installs_once_and_update_applies_only_changed_pin(self):
        for profile in ("personal-macos", "work-macos"):
            with self.subTest(profile=profile):
                os.environ["MISE_ENV"] = profile
                plugin.reconcile("bootstrap", self.old)
        self.installer.assert_called_once_with(self.old)
        before = self.registry.read_bytes()
        with self.assertRaisesRegex(ValueError, "update:herdr-plugins"):
            plugin.reconcile("bootstrap", self.new)
        self.assertEqual(self.registry.read_bytes(), before)
        plugin.reconcile("update", self.new)
        plugin.reconcile("update", self.new)
        self.assertEqual(self.installer.call_count, 2)
        self.assertEqual(plugin.installed_pin(self.config_dir), self.new)

    def test_linux_and_missing_profile_never_install(self):
        os.environ.pop("MISE_ENV")
        with patch.object(plugin.platform, "system", return_value="Linux"):
            for action in ("bootstrap", "update"):
                plugin.reconcile(action, self.new)
        with self.assertRaisesRegex(ValueError, "choose --env"):
            plugin.reconcile("bootstrap", self.new)
        self.installer.assert_not_called()
        self.assertFalse(self.registry.exists())

    def test_unsafe_state_is_not_replaced_even_on_explicit_update(self):
        for state in (
            "disabled",
            "local",
            "foreign",
            "unpinned",
            "inconsistent",
            "wrong-path",
            "dirty",
            "untracked",
            "head",
            "binary",
            "malformed",
            "duplicate",
            "orphan",
        ):
            with self.subTest(state=state):
                self.seed_install(self.old)
                if state == "disabled":
                    self.entry["enabled"] = False
                elif state in ("local", "foreign"):
                    self.entry["source"]["kind" if state == "local" else "owner"] = (
                        "not-managed"
                    )
                elif state == "unpinned":
                    self.entry["source"]["requested_ref"] = "main"
                elif state == "inconsistent":
                    self.entry["source"]["resolved_commit"] = self.new
                elif state == "wrong-path":
                    self.entry["plugin_root"] = str(self.upstream)
                elif state == "dirty":
                    (self.checkout / "herdr-plugin.toml").write_text("local edits\n")
                elif state == "untracked":
                    (self.checkout / "notes").write_text("keep me\n")
                elif state == "head":
                    plugin.git(
                        "-C", self.checkout, "checkout", "--quiet", "--detach", self.new
                    )
                elif state == "binary":
                    (self.checkout / "target/release" / plugin.PLUGIN).unlink()
                self.save_registry()
                if state == "malformed":
                    self.registry.write_text("invalid JSON")
                elif state == "duplicate":
                    self.registry.write_text(json.dumps([self.entry, self.entry]))
                elif state == "orphan":
                    self.registry.write_text("[]")
                before = self.registry.read_bytes()
                for action in ("bootstrap", "update"):
                    with self.assertRaises(ValueError):
                        plugin.reconcile(action, self.new)
                self.assertEqual(self.registry.read_bytes(), before)
        self.installer.assert_not_called()

    def test_installer_failure_or_missing_postcondition_is_not_success(self):
        self.installer.side_effect = subprocess.CalledProcessError(1, "herdr")
        with self.assertRaises(subprocess.CalledProcessError):
            plugin.reconcile("bootstrap", self.new)
        self.installer.side_effect = None
        with self.assertRaisesRegex(ValueError, "installer did not produce"):
            plugin.reconcile("bootstrap", self.new)

    def test_pin_refresh_changes_only_pin_and_is_idempotent(self):
        config = self.home / "mise.toml"
        original = f'# preserve formatting\n[vars]\n{plugin.PIN_KEY} = "{self.old}" # pin\nother = "keep"\n'
        config.write_text(original)
        with patch.object(
            plugin, "git", return_value=f"{self.new}\t{plugin.BRANCH}"
        ) as remote:
            plugin.refresh_pin(config)
            self.assertEqual(config.read_text(), original.replace(self.old, self.new))
            stamp = config.stat().st_mtime_ns
            plugin.refresh_pin(config)
            self.assertEqual(config.stat().st_mtime_ns, stamp)
            remote.assert_called_with(
                "ls-remote", "--exit-code", plugin.URL, plugin.BRANCH
            )
        self.installer.assert_not_called()

    def test_bad_remote_response_or_failure_leaves_pin_untouched(self):
        config = self.home / "mise.toml"
        original = f'[vars]\n{plugin.PIN_KEY} = "{self.old}"\n'
        config.write_text(original)
        for output in (
            "",
            "bad refs/heads/main",
            f"{self.new} refs/heads/wrong",
            f"{self.new} {plugin.BRANCH}\n{self.old} {plugin.BRANCH}",
        ):
            with (
                self.subTest(output=output),
                patch.object(plugin, "git", return_value=output),
            ):
                with self.assertRaises(ValueError):
                    plugin.refresh_pin(config)
                self.assertEqual(config.read_text(), original)
        with patch.object(
            plugin, "git", side_effect=subprocess.CalledProcessError(1, "git")
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                plugin.refresh_pin(config)
        self.assertEqual(config.read_text(), original)
        self.installer.assert_not_called()


class InstallerTests(unittest.TestCase):
    def test_install_delegates_to_herdr_with_explicit_pin(self):
        pin = "a" * 40
        with (
            patch.object(plugin.shutil, "which", return_value="/fixture/bin"),
            patch.object(plugin.subprocess, "run") as run,
        ):
            plugin.install(pin)
            run.assert_called_once_with(
                ["herdr", "plugin", "install", plugin.REPO, "--ref", pin, "--yes"],
                check=True,
            )
        with (
            patch.object(plugin.shutil, "which", return_value=None),
            patch.object(plugin.subprocess, "run") as run,
        ):
            with self.assertRaisesRegex(ValueError, "missing herdr"):
                plugin.install(pin)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
