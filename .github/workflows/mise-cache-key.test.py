import importlib.util
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
HELPER = Path(__file__).with_name("mise-cache-key.py")


def load_helper() -> ModuleType:
    spec = importlib.util.spec_from_file_location("mise_cache_key", HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load mise-cache-key.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_fixture(root: Path) -> None:
    (root / "mise.toml").write_text(
        """min_version = "2026.8.6"
[settings]
experimental = true
lockfile = true
age.strict = false
[tool_config]
locked = true
[env]
EDITOR = "nvim"
[tools]
node = "24.0.0"
rust = { version = "1.90.0", components = ["rustfmt"] }
[tasks.validate]
description = "First wording"
run = "true"
"""
    )
    (root / "mise.lock").write_text(
        """[[tools.node]]
version = "24.0.0"
backend = "core:node"
"platforms.linux-x64" = { url = "https://example.test/node-linux" }
"platforms.macos-arm64" = { url = "https://example.test/node-macos" }
[[tools.rust]]
version = "1.90.0"
backend = "core:rust"
"platforms.linux-x64" = { url = "https://example.test/rust-linux" }
"platforms.macos-arm64" = { url = "https://example.test/rust-macos" }
"""
    )


class MiseCacheKeyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.helper = load_helper()
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        write_fixture(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def keys(
        self,
        *,
        os_name: str = "Linux",
        architecture: str = "X64",
        image: str = "ubuntu24",
        mise_version: str = "2026.9.1",
    ) -> dict[str, str]:
        return self.helper.build_keys(
            self.root, os_name, architecture, image, mise_version
        )

    def test_configured_mise_version_comes_from_min_version(self) -> None:
        self.assertEqual(self.helper.configured_mise_version(self.root), "2026.8.6")
        path = self.root / "mise.toml"
        path.write_text(
            path.read_text().replace(
                'min_version = "2026.8.6"', 'min_version = "latest"'
            )
        )
        with self.assertRaisesRegex(ValueError, "min_version"):
            self.helper.configured_mise_version(self.root)

    def test_unchanged_inputs_are_stable(self) -> None:
        self.assertEqual(self.keys(), self.keys())

    def test_environment_and_task_description_do_not_change_keys(self) -> None:
        before = self.keys()
        config = (self.root / "mise.toml").read_text()
        config = config.replace('EDITOR = "nvim"', 'EDITOR = "vim"')
        config = config.replace("First wording", "Different wording")
        (self.root / "mise.toml").write_text(config)
        self.assertEqual(self.keys(), before)

    def test_version_and_lock_change_primary_but_keep_compatible_fallback(self) -> None:
        before = self.keys()
        config = (self.root / "mise.toml").read_text().replace(
            'node = "24.0.0"', 'node = "24.1.0"'
        )
        lock = (self.root / "mise.lock").read_text().replace(
            'version = "24.0.0"', 'version = "24.1.0"', 1
        )
        (self.root / "mise.toml").write_text(config)
        (self.root / "mise.lock").write_text(lock)
        after = self.keys()
        self.assertNotEqual(after["primary-key"], before["primary-key"])
        self.assertEqual(after["restore-key"], before["restore-key"])

    def test_install_option_change_invalidates_fallback(self) -> None:
        before = self.keys()
        config = (self.root / "mise.toml").read_text().replace(
            'components = ["rustfmt"]', 'components = ["rustfmt", "clippy"]'
        )
        (self.root / "mise.toml").write_text(config)
        after = self.keys()
        self.assertNotEqual(after["primary-key"], before["primary-key"])
        self.assertNotEqual(after["restore-key"], before["restore-key"])

    def test_platform_and_runner_boundaries_do_not_share_fallbacks(self) -> None:
        baseline = self.keys()["restore-key"]
        alternatives = (
            self.keys(os_name="macOS", architecture="ARM64", image="macos26"),
            self.keys(architecture="ARM64"),
            self.keys(image="ubuntu26"),
            self.keys(mise_version="2026.10.0"),
        )
        for keys in alternatives:
            with self.subTest(key=keys["restore-key"]):
                self.assertNotEqual(keys["restore-key"], baseline)

    def test_only_the_current_platform_lock_data_affects_identity(self) -> None:
        linux_before = self.keys()
        macos_before = self.keys(
            os_name="macOS", architecture="ARM64", image="macos26"
        )
        lock = (self.root / "mise.lock").read_text().replace(
            "node-macos", "node-macos-changed"
        )
        (self.root / "mise.lock").write_text(lock)
        self.assertEqual(self.keys(), linux_before)
        self.assertNotEqual(
            self.keys(os_name="macOS", architecture="ARM64", image="macos26")[
                "primary-key"
            ],
            macos_before["primary-key"],
        )

    def test_new_settings_and_dependencies_invalidate_fallback(self) -> None:
        before = self.keys()
        for old, new in (
            ('lockfile = true', 'lockfile = true\nnew_install_setting = true'),
            ('components = ["rustfmt"]', 'components = ["rustfmt"], depends = ["node"]'),
        ):
            with self.subTest(new=new):
                write_fixture(self.root)
                path = self.root / "mise.toml"
                path.write_text(path.read_text().replace(old, new))
                self.assertNotEqual(self.keys()["restore-key"], before["restore-key"])

    def test_templates_fail_closed(self) -> None:
        path = self.root / "mise.toml"
        path.write_text(path.read_text().replace('node = "24.0.0"', 'node = "{{ env.VERSION }}"'))
        with self.assertRaisesRegex(ValueError, "policy review"):
            self.keys()

    def test_task_tools_are_part_of_the_identity_and_policy(self) -> None:
        path = self.root / "mise.toml"
        path.write_text(path.read_text() + '\n[tasks.validate.tools]\nnode = "24.0.0"\n')
        before = self.keys()
        path.write_text(path.read_text().replace('[tasks.validate.tools]\nnode = "24.0.0"', '[tasks.validate.tools]\nnode = "24.1.0"'))
        self.assertNotEqual(self.keys()["primary-key"], before["primary-key"])
        self.assertEqual(self.keys()["restore-key"], before["restore-key"])

    def test_reconcile_reuses_unchanged_tools_and_replaces_changed_artifacts(self) -> None:
        old = self.helper.snapshot(self.root, "Linux", "X64")
        self.assertEqual(self.helper.reinstall_tools(old, old), [])
        path = self.root / "mise.lock"
        path.write_text(path.read_text().replace("node-linux", "node-linux-replaced"))
        new = self.helper.snapshot(self.root, "Linux", "X64")
        self.assertEqual(self.helper.reinstall_tools(old, new), ["node@24.0.0"])
        self.assertEqual(self.helper.reinstall_tools({}, new), ["node@24.0.0", "rust@1.90.0"])
        old["policy"] = "incompatible"
        self.assertEqual(self.helper.reinstall_tools(old, new), ["node@24.0.0", "rust@1.90.0"])

    def test_installer_environment_invalidates_fallback(self) -> None:
        before = self.keys()
        path = self.root / "mise.toml"
        path.write_text(path.read_text().replace('[env]', '[env]\nCFLAGS = "-march=native"'))
        self.assertNotEqual(self.keys()["restore-key"], before["restore-key"])

    def test_reconcile_and_record_only_use_isolated_data(self) -> None:
        data = self.root / "cache-data"
        args = Namespace(root=self.root, os="Linux", arch="X64", data_dir=data, mode="reconcile")
        with patch.object(self.helper.subprocess, "run") as run:
            self.helper.reconcile_or_record(args)
            run.assert_not_called()
            args.mode = "record"
            self.helper.reconcile_or_record(args)
            (data / "installs").mkdir()
            args.mode = "reconcile"
            self.helper.reconcile_or_record(args)
            run.assert_not_called()
            lock = self.root / "mise.lock"
            lock.write_text(lock.read_text().replace("node-linux", "replacement"))
            self.helper.reconcile_or_record(args)
            run.assert_called_once_with(["mise", "install", "--locked", "--force", "node@24.0.0"], check=True)
            run.reset_mock()
            args.mode = "record"
            self.helper.reconcile_or_record(args)
            args.mode = "reconcile"
            self.helper.reconcile_or_record(args)
            run.assert_not_called()

class NeovimCacheKeyTests(unittest.TestCase):
    def test_actual_namespace_inputs_and_print_mode_isolation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nvim = root / "dotfiles/common/nvim"
            (nvim / "tests").mkdir(parents=True)
            (nvim / "lua").mkdir()
            shutil.copy2(ROOT / "dotfiles/common/nvim/tests/validate.sh", nvim / "tests/validate.sh")
            plugin_lock = nvim / "lazy-lock.json"
            parsers = nvim / "lua/treesitter-parsers.lua"
            plugin_lock.write_text('{}')
            parsers.write_text('return {"lua"}')
            binaries = root / "bin"
            binaries.mkdir()
            fake = binaries / "nvim"
            fake.write_text('#!/bin/sh\n[ "$1" = --version ] || exit 99\nprintf "%s\\n" "$TEST_VERSION"\n')
            fake.chmod(0o755)
            uname = binaries / "uname"
            uname.write_text('#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_ARCH";; *) exit 99;; esac\n')
            uname.chmod(0o755)
            environment = {
                **os.environ,
                "HOME": str(root / "home"),
                "PATH": f"{binaries}:{os.defpath}",
                "TEST_VERSION": "NVIM v0.12.5",
                "TEST_OS": "Linux",
                "TEST_ARCH": "x86_64",
                "NVIM_VALIDATE_CACHE_DIR": str(root / "cache"),
            }

            def namespace() -> str:
                return subprocess.check_output(
                    ["bash", str(nvim / "tests/validate.sh"), "--print-cache-namespace"],
                    env=environment, text=True,
                ).strip()

            baseline = namespace()
            self.assertRegex(baseline, r"^[a-f0-9]{64}$")
            self.assertEqual(namespace(), baseline)
            (root / "mise.toml").write_text('[env]\nEDITOR = "vim"\n[tools]\nnode = "99.0.0"\n')
            self.assertEqual(namespace(), baseline)
            for name, value in (("TEST_VERSION", "NVIM v0.12.6"), ("TEST_OS", "Darwin"), ("TEST_ARCH", "arm64")):
                old = environment[name]
                environment[name] = value
                self.assertNotEqual(namespace(), baseline)
                environment[name] = old
            plugin_lock.write_text('{"changed": true}')
            self.assertNotEqual(namespace(), baseline)
            plugin_lock.write_text('{}')
            parsers.write_text('return {"lua", "python"}')
            self.assertNotEqual(namespace(), baseline)
            self.assertFalse((root / "home").exists())
            self.assertFalse((root / "cache").exists())


class WorkflowCachePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.workflow = (ROOT / ".github/workflows/mise.yml").read_text()
        cls.update_workflow = (
            ROOT / ".github/workflows/repository-updates.yml"
        ).read_text()

    def test_workflows_install_the_configured_minimum_mise_version(self) -> None:
        self.assertNotIn("MISE_VERSION", self.workflow)
        self.assertEqual(
            self.workflow.count(
                "version: ${{ steps.mise-cache-key.outputs.mise-version }}"
            ),
            2,
        )
        self.assertIn(
            "python3 .github/workflows/mise-cache-key.py --mode version",
            self.update_workflow,
        )
        self.assertIn(
            "version: ${{ steps.mise-version.outputs.mise-version }}",
            self.update_workflow,
        )

    def test_required_jobs_and_unconditional_work_remain(self) -> None:
        self.assertRegex(self.workflow, r"(?m)^  ubuntu:$")
        self.assertRegex(self.workflow, r"(?m)^  macos:$")
        self.assertEqual(self.workflow.count("          mise install --locked\n"), 2)
        self.assertEqual(
            self.workflow.count("run: mise run validate\n"),
            2,
        )

    def test_mise_action_does_not_own_the_tool_cache(self) -> None:
        self.assertEqual(self.workflow.count("install: false"), 2)
        self.assertEqual(self.workflow.count("cache: false"), 2)
        self.assertEqual(self.workflow.count("actions/cache/restore@"), 4)
        self.assertEqual(self.workflow.count("actions/cache/save@"), 4)

    def test_tool_cache_saves_only_after_validation_and_non_exact_restore(self) -> None:
        save_condition = (
            "if: success() && steps.mise-cache.outputs.cache-hit != 'true'"
        )
        self.assertEqual(self.workflow.count(save_condition), 2)
        for job in self.workflow.split("      - uses: actions/checkout@")[1:]:
            self.assertLess(
                job.index("Validate configuration and colocated tests"),
                job.index("Save mise tool cache"),
            )

    def test_neovim_key_excludes_global_mise_files(self) -> None:
        key_lines = [
            line for line in self.workflow.splitlines() if "nvim-validation-v2" in line
        ]
        self.assertEqual(len(key_lines), 2)
        self.assertTrue(all("mise.toml" not in line for line in key_lines))
        self.assertTrue(all("mise.lock" not in line for line in key_lines))

    def test_install_and_validation_have_no_hit_conditions(self) -> None:
        steps = re.split(r"(?m)^      - ", self.workflow)
        for step in steps:
            if step.startswith(("name: Install mise-managed tools", "name: Validate configuration and colocated tests")):
                self.assertNotIn("if:", step)
                self.assertNotIn("continue-on-error", step)
        ubuntu = self.workflow.split("  macos:")[0]
        self.assertLess(ubuntu.index("Verify mise lockfile reproducibility"), ubuntu.index("Install mise-managed tools"))
        self.assertIn('MISE_LOCKED_VERIFY_PROVENANCE: "1"', self.workflow)
        self.assertNotIn("pull_request_target", self.workflow)
        config = load_helper().load_toml(ROOT / "mise.toml")
        agent_steps = str(config["tasks"]["validate:agents"])
        self.assertIn("bun ci --cwd pi-extensions", agent_steps)
        self.assertIn("expected work HTTP security test to fail", agent_steps)
        self.assertIn('"validate:neovim"', (ROOT / "mise.toml").read_text())

    def test_empty_and_fallback_outputs_save_but_exact_hits_do_not(self) -> None:
        for hit in ("", "false", "true"):
            for success in (False, True):
                with self.subTest(hit=hit, success=success):
                    self.assertEqual(success and hit != "true", success and hit in ("", "false"))
        self.assertEqual(self.workflow.count("if: success() && steps.nvim-cache.outputs.cache-hit != 'true'"), 2)
        # No Neovim fallback: only the one active internal namespace is archived.
        self.assertEqual(self.workflow.count("restore-keys:"), 2)
        self.assertNotIn("~/.config/mise", self.workflow)
        self.assertEqual(self.workflow.count("~/.cache/dotfiles-ci-cargo/bin"), 4)
        self.assertEqual(self.workflow.count("$HOME/.local/share/mise/ci-rustup"), 2)
        self.assertNotIn("~/.cargo", self.workflow)
        self.assertNotIn("~/.rustup", self.workflow)
        self.assertEqual(self.workflow.count("--mode reconcile"), 2)
        self.assertEqual(self.workflow.count("--mode record"), 2)


if __name__ == "__main__":
    unittest.main()
