import glob
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
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

    def test_cli_keys_follow_the_installed_version_not_the_compatibility_floor(
        self,
    ) -> None:
        binaries = self.root / "bin"
        binaries.mkdir()
        mise = binaries / "mise"
        mise.write_text(
            '#!/bin/sh\n[ "$*" = --version ] || exit 99\n'
            'printf "%s\\n" "$TEST_MISE_VERSION"\n'
        )
        mise.chmod(0o755)

        def keys(version: str) -> dict[str, str]:
            output = subprocess.check_output(
                [
                    sys.executable, str(HELPER), "--root", str(self.root),
                    "--os", "Linux", "--arch", "X64", "--image", "ubuntu24",
                ],
                env={
                    "PATH": f"{binaries}:{os.defpath}",
                    "TEST_MISE_VERSION": version,
                },
                text=True,
            )
            return dict(line.split("=", 1) for line in output.splitlines())

        before = keys("2026.9.1 linux-x64 (2026-09-01)")
        self.assertEqual(before, self.keys(mise_version="2026.9.1"))
        path = self.root / "mise.toml"
        path.write_text(path.read_text().replace("2026.8.6", "2026.8.7"))
        self.assertEqual(keys("2026.9.1"), before)
        after = keys("2026.9.2 linux-x64 (2026-09-02)")
        self.assertNotEqual(after["restore-key"], before["restore-key"])

    def test_invalid_or_failed_cli_version_cannot_produce_a_cache_key(self) -> None:
        for output in ("", "unknown", "2026.9.1-beta linux-x64"):
            with self.subTest(output=output), patch.object(
                self.helper.subprocess, "check_output", return_value=output
            ):
                with self.assertRaisesRegex(ValueError, "invalid version"):
                    self.helper.installed_mise_version()
        with patch.object(
            self.helper.subprocess, "check_output",
            side_effect=subprocess.CalledProcessError(1, ["mise", "--version"]),
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                self.helper.installed_mise_version()

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
        config = (
            (self.root / "mise.toml")
            .read_text()
            .replace('node = "24.0.0"', 'node = "24.1.0"')
        )
        lock = (
            (self.root / "mise.lock")
            .read_text()
            .replace('version = "24.0.0"', 'version = "24.1.0"', 1)
        )
        (self.root / "mise.toml").write_text(config)
        (self.root / "mise.lock").write_text(lock)
        after = self.keys()
        self.assertNotEqual(after["primary-key"], before["primary-key"])
        self.assertEqual(after["restore-key"], before["restore-key"])

    def test_install_option_change_invalidates_fallback(self) -> None:
        before = self.keys()
        config = (
            (self.root / "mise.toml")
            .read_text()
            .replace('components = ["rustfmt"]', 'components = ["rustfmt", "clippy"]')
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
        macos_before = self.keys(os_name="macOS", architecture="ARM64", image="macos26")
        lock = (
            (self.root / "mise.lock")
            .read_text()
            .replace("node-macos", "node-macos-changed")
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
            ("lockfile = true", "lockfile = true\nnew_install_setting = true"),
            (
                'components = ["rustfmt"]',
                'components = ["rustfmt"], depends = ["node"]',
            ),
        ):
            with self.subTest(new=new):
                write_fixture(self.root)
                path = self.root / "mise.toml"
                path.write_text(path.read_text().replace(old, new))
                self.assertNotEqual(self.keys()["restore-key"], before["restore-key"])

    def test_templates_fail_closed(self) -> None:
        path = self.root / "mise.toml"
        path.write_text(
            path.read_text().replace('node = "24.0.0"', 'node = "{{ env.VERSION }}"')
        )
        with self.assertRaisesRegex(ValueError, "policy review"):
            self.keys()

    def test_task_tools_are_part_of_the_identity_and_policy(self) -> None:
        path = self.root / "mise.toml"
        path.write_text(
            path.read_text() + '\n[tasks.validate.tools]\nnode = "24.0.0"\n'
        )
        before = self.keys()
        path.write_text(
            path.read_text().replace(
                '[tasks.validate.tools]\nnode = "24.0.0"',
                '[tasks.validate.tools]\nnode = "24.1.0"',
            )
        )
        self.assertNotEqual(self.keys()["primary-key"], before["primary-key"])
        self.assertEqual(self.keys()["restore-key"], before["restore-key"])

    def test_reconcile_reuses_unchanged_tools_and_replaces_changed_artifacts(
        self,
    ) -> None:
        old = self.helper.snapshot(self.root, "Linux", "X64")
        self.assertEqual(self.helper.reinstall_tools(old, old), [])
        path = self.root / "mise.lock"
        path.write_text(path.read_text().replace("node-linux", "node-linux-replaced"))
        new = self.helper.snapshot(self.root, "Linux", "X64")
        self.assertEqual(self.helper.reinstall_tools(old, new), ["node@24.0.0"])
        self.assertEqual(
            self.helper.reinstall_tools({}, new), ["node@24.0.0", "rust@1.90.0"]
        )
        old["policy"] = "incompatible"
        self.assertEqual(
            self.helper.reinstall_tools(old, new), ["node@24.0.0", "rust@1.90.0"]
        )

    def test_installer_environment_invalidates_fallback(self) -> None:
        before = self.keys()
        path = self.root / "mise.toml"
        path.write_text(
            path.read_text().replace("[env]", '[env]\nCFLAGS = "-march=native"')
        )
        self.assertNotEqual(self.keys()["restore-key"], before["restore-key"])

    def test_reconcile_and_record_only_use_isolated_data(self) -> None:
        data = self.root / "cache-data"
        args = Namespace(
            root=self.root, os="Linux", arch="X64", data_dir=data, mode="reconcile"
        )
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
            run.assert_called_once_with(
                ["mise", "install", "--locked", "--force", "node@24.0.0"], check=True
            )
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
            shutil.copy2(
                ROOT / "dotfiles/common/nvim/tests/validate.sh",
                nvim / "tests/validate.sh",
            )
            plugin_lock = nvim / "lazy-lock.json"
            parsers = nvim / "lua/treesitter-parsers.lua"
            plugin_lock.write_text("{}")
            parsers.write_text('return {"lua"}')
            binaries = root / "bin"
            binaries.mkdir()
            fake = binaries / "nvim"
            fake.write_text(
                '#!/bin/sh\n[ "$1" = --version ] || exit 99\nprintf "%s\\n" "$TEST_VERSION"\n'
            )
            fake.chmod(0o755)
            uname = binaries / "uname"
            uname.write_text(
                '#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_ARCH";; *) exit 99;; esac\n'
            )
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
                    [
                        "bash",
                        str(nvim / "tests/validate.sh"),
                        "--print-cache-namespace",
                    ],
                    env=environment,
                    text=True,
                ).strip()

            baseline = namespace()
            self.assertRegex(baseline, r"^[a-f0-9]{64}$")
            self.assertEqual(namespace(), baseline)
            (root / "mise.toml").write_text(
                '[env]\nEDITOR = "vim"\n[tools]\nnode = "99.0.0"\n'
            )
            self.assertEqual(namespace(), baseline)
            for name, value in (
                ("TEST_VERSION", "NVIM v0.12.6"),
                ("TEST_OS", "Darwin"),
                ("TEST_ARCH", "arm64"),
            ):
                old = environment[name]
                environment[name] = value
                self.assertNotEqual(namespace(), baseline)
                environment[name] = old
            plugin_lock.write_text('{"changed": true}')
            self.assertNotEqual(namespace(), baseline)
            plugin_lock.write_text("{}")
            parsers.write_text('return {"lua", "python"}')
            self.assertNotEqual(namespace(), baseline)
            self.assertFalse((root / "home").exists())
            self.assertFalse((root / "cache").exists())


class WorkflowSecurityPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Bun's built-in YAML parser preserves GitHub's `on` key without adding
        # a Python dependency or falling back to YAML 1.1 boolean coercion.
        cls.workflows = {}
        for name in ("mise.yml", "repository-updates.yml"):
            result = subprocess.run(
                [
                    "bun",
                    "-e",
                    "console.log(JSON.stringify(Bun.YAML.parse(await Bun.stdin.text())))",
                ],
                input=(ROOT / ".github/workflows" / name).read_text(),
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            cls.workflows[name] = json.loads(result.stdout)
        cls.workflow = cls.workflows["mise.yml"]
        cls.update_workflow = cls.workflows["repository-updates.yml"]

    def test_ci_workflows_allow_missing_age_keys_at_every_step(self) -> None:
        for name, workflow in self.workflows.items():
            for job_name, job in workflow["jobs"].items():
                for step in job["steps"]:
                    environment = (
                        workflow.get("env", {})
                        | job.get("env", {})
                        | step.get("env", {})
                    )
                    with self.subTest(
                        workflow=name, job=job_name, step=step.get("name")
                    ):
                        self.assertEqual(environment.get("MISE_AGE_STRICT"), "false")

    def test_untrusted_pull_requests_cannot_receive_privileged_credentials(
        self,
    ) -> None:
        for workflow in self.workflows.values():
            self.assertNotIn("pull_request_target", workflow["on"])
        for job in self.workflow["jobs"].values():
            permissions = job.get("permissions", self.workflow["permissions"])
            if permissions != "read-all":
                self.assertIsInstance(permissions, dict)
                self.assertLessEqual(set(permissions.values()), {"read", "none"})
            self.assertNotRegex(json.dumps(job), r"\$\{\{[^}]*\bsecrets(?:\.|\[)")

        self.assertLessEqual(
            set(self.update_workflow["on"]), {"schedule", "workflow_dispatch"}
        )
        publishing_steps = [
            (job, step)
            for job in self.update_workflow["jobs"].values()
            for step in job["steps"]
            if re.search(
                r"\b(?:git\s+push|gh\s+pr\s+(?:create|merge))\b", step.get("run", "")
            )
        ]
        self.assertTrue(publishing_steps)
        for job, step in publishing_steps:
            environment = (
                self.update_workflow.get("env", {})
                | job.get("env", {})
                | step.get("env", {})
            )
            self.assertRegex(
                environment.get("GH_TOKEN", ""),
                r"^\$\{\{\s*secrets\.[A-Za-z_][A-Za-z_0-9]*\s*\}\}$",
                "a trusted user token must publish updates so PR validation can run",
            )

    def test_tool_cache_round_trip_preserves_the_selected_cli(self) -> None:
        # Cache's glob resolver selects paths without implicit descendants, then
        # tar recursively archives each match. Excluding bin is insufficient if
        # the parent data directory is still one of those matches.
        for job_name, job in self.workflow["jobs"].items():
            steps = job["steps"]
            setup_index = next(
                i for i, step in enumerate(steps)
                if step.get("uses", "").startswith("jdx/mise-action@")
            )
            key_index = next(
                i for i, step in enumerate(steps) if step.get("id") == "mise-cache-key"
            )
            restore_index = next(
                i for i, step in enumerate(steps) if step.get("id") == "mise-cache"
            )
            save = next(
                step for step in steps if step.get("name") == "Save mise tool cache"
            )
            self.assertLess(setup_index, key_index)
            self.assertLess(key_index, restore_index)
            patterns = save["with"]["path"]
            self.assertEqual(patterns, steps[restore_index]["with"]["path"])

            with self.subTest(job=job_name), tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                data = home / ".local/share/mise"
                binary = data / "bin/mise"
                tool = data / "installs/node/24.0.0/bin/node"
                manifest = data / ".dotfiles-ci-cache-inputs.json"
                rust = data / "ci-rustup/toolchains/fixture/bin/rustc"
                proxy = home / ".cache/dotfiles-ci-cargo/bin/rustc"
                for path in (binary, tool, manifest, rust, proxy):
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("cached")

                paths: set[str] = set()
                for pattern in patterns.splitlines():
                    exclude = pattern.startswith("!")
                    expanded = pattern.lstrip("!").replace("~/", f"{home}/", 1)
                    matches = set(glob.glob(expanded, include_hidden=True))
                    if exclude:
                        paths.difference_update(matches)
                    else:
                        paths.update(matches)
                archive = io.BytesIO()
                with tarfile.open(fileobj=archive, mode="w") as tar:
                    for path in sorted(paths):
                        tar.add(path, arcname=str(Path(path).relative_to(home)))
                binary.write_text("selected CLI")
                for path in (tool, manifest, rust, proxy):
                    path.unlink()
                archive.seek(0)
                with tarfile.open(fileobj=archive) as tar:
                    tar.extractall(home, filter="data")
                self.assertEqual(binary.read_text(), "selected CLI")
                for path in (tool, manifest, rust, proxy):
                    self.assertEqual(path.read_text(), "cached")

    def test_cache_publication_happens_after_successful_validation(self) -> None:
        for job_name, job in self.workflow["jobs"].items():
            validation_indices = [
                index
                for index, step in enumerate(job["steps"])
                if re.search(r"(?m)^\s*mise\s+run\s+validate\s*$", step.get("run", ""))
            ]
            for index, step in enumerate(job["steps"]):
                if step.get("uses", "").startswith("actions/cache/save@"):
                    with self.subTest(job=job_name, cache=step.get("id", index)):
                        predecessors = [
                            validation
                            for validation in validation_indices
                            if validation < index
                        ]
                        self.assertTrue(predecessors)
                        for validation in predecessors:
                            validation_step = job["steps"][validation]
                            self.assertIn(
                                validation_step.get("if"),
                                (None, "success()", "${{ success() }}"),
                            )
                            self.assertFalse(
                                validation_step.get("continue-on-error", False)
                            )
                        self.assertIn("success()", step.get("if", "success()"))
                        self.assertNotRegex(
                            step.get("if", ""), r"\b(?:always|failure|cancelled)\s*\("
                        )

    def test_update_pull_requests_guard_auto_merge_with_the_head_commit(self) -> None:
        merge_scripts = [
            step["run"]
            for job in self.update_workflow["jobs"].values()
            for step in job["steps"]
            if re.search(r"\bgh\s+pr\s+merge\b", step.get("run", ""))
        ]
        self.assertTrue(merge_scripts)
        for script in merge_scripts:
            with tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                binaries = home / "bin"
                binaries.mkdir()
                gh = binaries / "gh"
                gh.write_text(
                    f"#!{sys.executable}\n"
                    "import json, os, sys\n"
                    "with open(os.environ['GH_CALLS'], 'a') as log:\n"
                    "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                    "if sys.argv[1:3] == ['pr', 'list']: print('42')\n"
                    "elif sys.argv[1:3] != ['pr', 'merge']: sys.exit(99)\n"
                )
                git = binaries / "git"
                git.write_text(
                    '#!/bin/sh\n[ "$*" = "rev-parse HEAD" ] || exit 99\n'
                    'printf "%s\\n" "$FIXTURE_HEAD"\n'
                )
                for binary in (gh, git):
                    binary.chmod(0o755)
                calls_path = home / "gh-calls.jsonl"
                head = "a" * 40
                result = subprocess.run(
                    ["bash", "-euo", "pipefail", "-c", script],
                    cwd=home,
                    env={
                        "HOME": str(home),
                        "PATH": str(binaries) + os.pathsep + os.defpath,
                        "GH_CALLS": str(calls_path),
                        "GH_TOKEN": "fixture-only",
                        "FIXTURE_HEAD": head,
                        "UPDATE_BRANCH": "fixture-updates",
                        "BASE_BRANCH": "main",
                    },
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = [
                    json.loads(line) for line in calls_path.read_text().splitlines()
                ]
                merges = [call for call in calls if call[:2] == ["pr", "merge"]]
                self.assertEqual(len(merges), 1)
                self.assertEqual(merges[0][2], "fixture-updates")
                self.assertIn("--auto", merges[0])
                self.assertIn("--match-head-commit", merges[0])
                self.assertEqual(
                    merges[0][merges[0].index("--match-head-commit") + 1], head
                )


if __name__ == "__main__":
    unittest.main()
