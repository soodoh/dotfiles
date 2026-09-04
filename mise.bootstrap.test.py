import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType

import tomllib

ROOT = Path(__file__).resolve().parent


def load_toml(name: str) -> dict:
    with (ROOT / name).open("rb") as config_file:
        return tomllib.load(config_file)


def load_mise_lock_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("mise_lock", ROOT / "mise.lock.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load mise.lock.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tool_version(specification: object) -> str:
    if isinstance(specification, str):
        return specification
    if isinstance(specification, dict) and isinstance(
        specification.get("version"), str
    ):
        return specification["version"]
    raise TypeError(f"unsupported tool specification: {specification!r}")


class MisePolicyTests(unittest.TestCase):
    def test_renovate_owns_supported_mise_updates(self) -> None:
        renovate = json.loads((ROOT / "renovate.json").read_text())
        self.assertIn(":maintainLockFilesWeekly", renovate["extends"])
        disabled_mise_rules = [
            rule
            for rule in renovate["packageRules"]
            if rule.get("enabled") is False and "mise" in rule.get("matchManagers", [])
        ]
        self.assertEqual(disabled_mise_rules, [])

    def test_repository_updates_only_explicitly_unsupported_tools(self) -> None:
        mise_lock = load_mise_lock_module()
        self.assertEqual(mise_lock.UNSUPPORTED_TOOLS, {"work-macos": ("http:twg",)})
        calls: list[tuple[str, ...]] = []

        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            for name in (*mise_lock.CONFIG_FILES, *mise_lock.LOCK_FILES):
                source = ROOT / name
                if source.exists():
                    shutil.copy2(source, stage / name)

            @contextmanager
            def staged_repository(root: Path):
                self.assertEqual(root, ROOT)
                yield stage

            def run_mise(root: Path, *arguments: str) -> None:
                self.assertEqual(root, stage)
                calls.append(arguments)

            def finalize_staged_update(root: Path, staged: Path) -> None:
                self.assertEqual(root, ROOT)
                self.assertEqual(staged, stage)
                self.assertIn(
                    mise_lock.UNLOCKED_CONFIG, (stage / "mise.toml").read_text()
                )
                calls.append(("finalize",))

            mise_lock.staged_repository = staged_repository
            mise_lock.run_mise = run_mise
            mise_lock.finalize_staged_update = finalize_staged_update
            mise_lock.update_unsupported_tools(ROOT)

        self.assertEqual(
            calls,
            [
                ("--env", "work-macos", "upgrade", "--bump", "http:twg"),
                ("finalize",),
            ],
        )

        workflow = (ROOT / ".github/workflows/repository-updates.yml").read_text()
        run_commands = re.findall(r"^\s*run:\s*([^|].*)$", workflow, re.MULTILINE)
        self.assertIn("python3 mise.lock.py update-unsupported", run_commands)
        self.assertNotIn("python3 mise.lock.py update", run_commands)


class MiseConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.base = load_toml("mise.toml")
        cls.personal = load_toml("mise.personal-macos.toml")
        cls.work = load_toml("mise.work-macos.toml")

    def test_age_decryption_remains_strict_by_default(self) -> None:
        self.assertNotIn("strict", self.base["settings"]["age"])

    def test_ci_workflows_explicitly_allow_missing_age_keys(self) -> None:
        for workflow_name in ("mise.yml", "repository-updates.yml"):
            with self.subTest(workflow=workflow_name):
                workflow = (ROOT / ".github/workflows" / workflow_name).read_text()
                self.assertIn('  MISE_AGE_STRICT: "false"', workflow)

    def test_ci_can_load_configs_without_age_keys_or_certificate_file(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise, "mise must be available to validate profile loading")
        with tempfile.TemporaryDirectory() as home:
            environment = {
                "CI": "1",
                "HOME": home,
                "MISE_AGE_STRICT": "false",
                "MISE_TRUSTED_CONFIG_PATHS": str(ROOT),
                "MISE_YES": "1",
                "PATH": os.defpath,
            }
            for arguments in (
                ("config",),
                ("ls",),
                ("--env", "work-macos", "config"),
            ):
                with self.subTest(arguments=arguments):
                    result = subprocess.run(
                        [mise, *arguments],
                        cwd=ROOT,
                        env=environment,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(
                        result.returncode,
                        0,
                        "CI must explicitly allow config loading without age keys or "
                        "SSL_CERT_FILE:\n" + result.stderr,
                    )

    def test_certificate_variables_are_safe_without_ssl_cert_file(self) -> None:
        certificate_variables = (
            "REQUESTS_CA_BUNDLE",
            "NODE_EXTRA_CA_CERTS",
            "AWS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "HTTPLIB2_CA_CERTS",
        )
        for variable in certificate_variables:
            with self.subTest(variable=variable):
                self.assertEqual(self.work["env"][variable], "${SSL_CERT_FILE:-}")

    def test_every_declared_tool_version_has_a_matching_lock_entry(self) -> None:
        for config_name, lock_name in (
            ("mise.toml", "mise.lock"),
            ("mise.personal-macos.toml", "mise.personal-macos.lock"),
            ("mise.work-macos.toml", "mise.work-macos.lock"),
        ):
            config_tools = load_toml(config_name).get("tools", {})
            lock_tools = load_toml(lock_name).get("tools", {})
            for tool, specification in config_tools.items():
                version = tool_version(specification)
                with self.subTest(config=config_name, tool=tool, version=version):
                    self.assertTrue(
                        any(
                            entry["version"] == version
                            for entry in lock_tools.get(tool, [])
                        ),
                        f"{config_name}: {tool}@{version} is missing from {lock_name}",
                    )

    def test_yarn_lock_covers_every_supported_platform(self) -> None:
        yarn_tool = "aqua:yarnpkg/berry"
        yarn_version = tool_version(self.base["tools"][yarn_tool])
        self.assertNotIn("yarn", self.base["tools"])
        yarn_lock = next(
            entry
            for entry in load_toml("mise.lock")["tools"][yarn_tool]
            if entry["version"] == yarn_version
        )
        for platform in ("linux-arm64", "linux-x64", "macos-arm64", "macos-x64"):
            with self.subTest(platform=platform):
                self.assertTrue(yarn_lock[f"platforms.{platform}"]["url"])

    def test_shared_gws_skills_and_locks_are_synchronized(self) -> None:
        shared_skills = {
            "gws-calendar",
            "gws-docs",
            "gws-drive",
            "gws-gmail",
            "gws-shared",
            "gws-sheets",
        }
        profile_roots = [
            ROOT / "dotfiles" / profile / "agents" for profile in ("personal", "work")
        ]
        locks = [
            json.loads((profile_root / ".skill-lock.json").read_text())
            for profile_root in profile_roots
        ]
        for skill in shared_skills:
            skill_files = [
                profile_root / "skills" / skill / "SKILL.md"
                for profile_root in profile_roots
            ]
            with self.subTest(skill=skill):
                self.assertTrue(all(path.is_file() for path in skill_files))
                self.assertEqual(len({path.read_bytes() for path in skill_files}), 1)
                entries = [lock["skills"].get(skill) for lock in locks]
                self.assertTrue(all(entry is not None for entry in entries))
                self.assertTrue(
                    all(entry["source"] == "googleworkspace/cli" for entry in entries)
                )
                self.assertEqual(
                    len({entry["skillFolderHash"] for entry in entries}), 1
                )

    def test_google_workspace_configuration_stays_in_shared_scope(self) -> None:
        google_env = {
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_WORKSPACE_CLI_CLIENT_ID",
            "GOOGLE_WORKSPACE_CLI_CLIENT_SECRET",
            "GOOGLE_WORKSPACE_PROJECT_ID",
        }
        self.assertLessEqual(google_env, self.base["env"].keys())
        self.assertTrue(google_env.isdisjoint(self.work["env"].keys()))
        self.assertTrue(google_env.isdisjoint(self.personal.get("env", {}).keys()))
        self.assertIn("npm:@googleworkspace/cli", self.base["tools"])
        self.assertNotIn("npm:@googleworkspace/cli", self.work.get("tools", {}))
        self.assertNotIn("npm:@googleworkspace/cli", self.personal.get("tools", {}))

    def test_python_precedes_gcloud_installation(self) -> None:
        steps = [
            line.strip()
            for line in self.base["bootstrap"]["hooks"]["pre-tools"].splitlines()
            if line.strip()
        ]
        python_steps = [
            index
            for index, step in enumerate(steps)
            if "mise install" in step and step.endswith("python")
        ]
        gcloud_steps = [
            index
            for index, step in enumerate(steps)
            if "mise install" in step
            and step.endswith("gcloud")
            and "CLOUDSDK_PYTHON" in step
            and "mise which python3" in step
        ]
        self.assertEqual(len(python_steps), 1)
        self.assertEqual(len(gcloud_steps), 1)
        self.assertLess(python_steps[0], gcloud_steps[0])
        self.assertEqual(self.base["tools"]["gcloud"]["depends"], ["python"])
        self.assertNotIn("{{", tool_version(self.base["tools"]["python"]))

    def test_mas_is_installed_before_the_main_package_pass(self) -> None:
        packages = self.base["bootstrap"]["packages"]
        pre_packages = self.base["bootstrap"]["hooks"]["pre-packages"]
        self.assertIn("brew:mas", packages)
        self.assertRegex(
            pre_packages,
            r"(?m)^\s*mise\s+bootstrap\s+packages\s+apply\s+brew:mas\s+--yes\s*$",
        )


if __name__ == "__main__":
    unittest.main()
