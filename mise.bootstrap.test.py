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

    def test_renovate_updates_the_repository_mise_version(self) -> None:
        renovate = json.loads((ROOT / "renovate.json").read_text())
        managers = [
            manager
            for manager in renovate["customManagers"]
            if manager.get("packageNameTemplate") == "jdx/mise"
        ]
        self.assertEqual(len(managers), 1)
        manager = managers[0]
        self.assertEqual(manager["datasourceTemplate"], "github-releases")
        self.assertIn("min_version", manager["matchStrings"][0])
        pattern = manager["matchStrings"][0].replace(
            "(?<currentValue>", "(?P<currentValue>"
        )
        self.assertRegex((ROOT / "mise.toml").read_text(), pattern)

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


class MiseConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.base = load_toml("mise.toml")
        cls.personal = load_toml("mise.personal-macos.toml")
        cls.work = load_toml("mise.work-macos.toml")

    def test_brew_casks_are_explicitly_macos_only(self) -> None:
        for config_name, config in (
            ("mise.toml", self.base),
            ("mise.personal-macos.toml", self.personal),
            ("mise.work-macos.toml", self.work),
        ):
            packages = config.get("bootstrap", {}).get("packages", {})
            for package, specification in packages.items():
                if not package.startswith("brew-cask:"):
                    continue
                with self.subTest(config=config_name, package=package):
                    self.assertIsInstance(specification, dict)
                    self.assertEqual(specification.get("os"), "macos")

    def test_work_tailscale_control_proxy_is_profile_scoped(self) -> None:
        self.assertIn("brew:gost", self.work["bootstrap"]["packages"])
        self.assertNotIn("brew:gost", self.base["bootstrap"]["packages"])
        self.assertNotIn("brew:gost", self.personal.get("bootstrap", {}).get("packages", {}))

        managed_directory = self.work["bootstrap"]["directories"]["/etc/tailscale"]
        self.assertEqual(managed_directory["owner"], "root")
        self.assertEqual(managed_directory["group"], "wheel")
        self.assertEqual(managed_directory["mode"], "0755")

        managed_file = self.work["bootstrap"]["files"][
            "/etc/tailscale/tailscaled-env.txt"
        ]
        self.assertEqual(managed_file["source"], "dotfiles/work/tailscaled-env.txt")
        self.assertEqual(managed_file["owner"], "root")
        self.assertEqual(managed_file["group"], "wheel")
        self.assertEqual(managed_file["mode"], "0600")

        agent = self.work["bootstrap"]["macos"]["launchd"]["agents"][
            "tailscale-control-proxy"
        ]
        self.assertEqual(agent["program"], "~/.local/bin/mise")
        self.assertEqual(agent["args"][:3], ["--env", "work-macos", "exec"])
        self.assertNotIn("GOST_AUTH_PASSWORD", json.dumps(agent))
        self.assertTrue(agent["environment"]["PATH"].startswith("/opt/homebrew/bin:"))
        self.assertEqual(agent["environment"]["MISE_EXEC_AUTO_INSTALL"], "false")
        self.assertTrue(agent["keep_alive"])

    def test_moshi_launch_agent_has_one_shared_owner(self) -> None:
        agents = self.base["bootstrap"]["macos"]["launchd"]["agents"]
        self.assertIn("moshi-hook", agents)
        for profile in (self.personal, self.work):
            profile_agents = (
                profile.get("bootstrap", {})
                .get("macos", {})
                .get("launchd", {})
                .get("agents", {})
            )
            self.assertNotIn("moshi-hook", profile_agents)

    def test_moshi_launch_command_gets_mise_path_without_shell_activation(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        agent = self.base["bootstrap"]["macos"]["launchd"]["agents"]["moshi-hook"]
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            checkout = home / "checkouts/dotfiles"
            checkout.mkdir(parents=True)
            repo_alias = home / agent["working_directory"].removeprefix("~/")
            repo_alias.parent.mkdir(parents=True)
            repo_alias.symlink_to(checkout, target_is_directory=True)
            tools = home / "tools"
            tools.mkdir()
            herdr = tools / "herdr"
            herdr.write_text("#!/bin/sh\nexit 0\n")
            herdr.chmod(0o755)
            moshi = home / "moshi-hook"
            moshi.write_text(
                '#!/bin/sh\n[ "$1" = serve ] || exit 64\ncommand -v herdr\n'
            )
            moshi.chmod(0o755)
            (checkout / "mise.toml").write_text(
                f"[env]\n_.path = [{json.dumps(str(tools))}]\n"
            )
            environment = {
                "HOME": str(home),
                "PATH": os.defpath,  # launchd-like environment, no interactive activation.
                "MISE_TRUSTED_CONFIG_PATHS": str(checkout),
            }
            self.assertIsNone(shutil.which("herdr", path=environment["PATH"]))
            # Replace only the daemon with a probe; run the declared mise exec arguments.
            arguments = [
                str(moshi) if arg.endswith("/moshi-hook") else arg
                for arg in agent["args"]
            ]
            result = subprocess.run(
                [mise, *arguments],
                cwd=repo_alias,
                check=False,
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), str(herdr))

    def test_node_version_matches_nvmrc(self) -> None:
        self.assertEqual(
            tool_version(self.base["tools"]["node"]),
            (ROOT / ".nvmrc").read_text().strip(),
            "Keep mise and fnm on the same Node LTS version",
        )

    def test_azure_devops_mcp_allows_only_required_package_builds(self) -> None:
        tool = self.work["tools"]["npm:@azure-devops/mcp"]
        self.assertEqual(tool["allow_builds"], ["keytar"])

    def test_work_azure_profiles_are_isolated(self) -> None:
        self.assertEqual(
            self.work["env"]["AZURE_CONFIG_DIR"],
            "{{ env.HOME }}/.azure/dev/.azure",
        )
        mcp = json.loads((ROOT / "dotfiles/work/pi/agent/mcp.json").read_text())[
            "mcpServers"
        ]
        azure = mcp["azure"]
        self.assertEqual(azure["args"], ["server", "start", "--read-only"])
        self.assertEqual(
            azure["env"]["HOME"],
            "${HOME}/.azure/prod",
        )
        self.assertEqual(
            azure["env"]["AZURE_CONFIG_DIR"],
            "${HOME}/.azure/prod/.azure",
        )
        for variable in (
            "AZURE_DEV_TENANT_ID",
            "AZURE_PROD_TENANT_ID",
            "AZURE_SUBSCRIPTION_ID",
        ):
            with self.subTest(variable=variable):
                self.assertEqual(set(self.work["env"][variable]), {"age"})
        self.assertEqual(
            azure["env"]["AZURE_SUBSCRIPTION_ID"],
            "${AZURE_SUBSCRIPTION_ID}",
        )
        self.assertEqual(
            azure["env"]["AZURE_TOKEN_CREDENTIALS"],
            "AzureCliCredential",
        )
        self.assertIs(azure["inheritEnv"], False)

        azure_test = mcp["azure-test"]
        self.assertEqual(azure_test["command"], "azmcp")
        self.assertEqual(azure_test["args"], ["server", "start", "--read-only"])
        self.assertEqual(azure_test["env"]["HOME"], "${HOME}/.azure/dev")
        self.assertEqual(
            azure_test["env"]["AZURE_CONFIG_DIR"],
            "${HOME}/.azure/dev/.azure",
        )
        self.assertEqual(
            azure_test["env"]["AZURE_TOKEN_CREDENTIALS"],
            "AzureCliCredential",
        )
        self.assertNotIn("AZURE_SUBSCRIPTION_ID", azure_test["env"])
        self.assertIs(azure_test["inheritEnv"], False)

        for server_name, server, environment_names in (
            ("azure", azure, {"Stage", "Demo", "Prod"}),
            ("azure-test", azure_test, {"Integration", "Test", "Dev"}),
        ):
            with self.subTest(server=server_name):
                self.assertIn("--read-only", server["args"])
                self.assertIn("kusto", server["includeTools"])
                self.assertEqual(server["directTools"], "search")
                self.assertLessEqual(
                    environment_names,
                    set(server["searchKeywords"]["kusto"]),
                )

        azure_devops = mcp["azure-devops"]
        self.assertIs(azure_devops["directTools"], False)
        self.assertIn("pipelines_build", azure_devops["includeTools"])
        self.assertIn("pipelines_build_log", azure_devops["includeTools"])
        self.assertIn("pipelines_write", azure_devops["includeTools"])
        self.assertEqual(
            self.work["dotfiles"]["~/.pi/agent/AGENTS.md"],
            "dotfiles/work/pi/agent/AGENTS.md",
        )

    def test_mcp_servers_follow_shared_safety_defaults(self) -> None:
        configs = {
            profile: json.loads(
                (ROOT / f"dotfiles/{profile}/pi/agent/mcp.json").read_text()
            )
            for profile in ("personal", "work")
        }
        direct_tool_exceptions = {"context7"}
        for profile, config in configs.items():
            self.assertIs(config["settings"]["sampling"], False)
            self.assertNotIn("samplingAutoApprove", config["settings"])
            for server_name, server in config["mcpServers"].items():
                with self.subTest(profile=profile, server=server_name):
                    self.assertEqual(server.get("lifecycle", "lazy"), "lazy")
                    if "command" in server:
                        self.assertIs(server.get("inheritEnv"), False)
                    if server_name not in direct_tool_exceptions:
                        self.assertIn(
                            server.get("directTools", False), (False, "search")
                        )

        playwright = configs["work"]["mcpServers"]["playwright"]
        for unsafe_tool in (
            "browser_run_code_unsafe",
            "browser_drop",
            "browser_webmcp_call",
        ):
            self.assertIn(unsafe_tool, playwright["approveTools"])

    def test_renovate_can_generate_locks_without_age_keys_or_overrides(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        tool = "npm:@earendil-works/pi-coding-agent"
        # An exactly pinned npm tool exercises real lock generation without downloads.
        # Test both Renovate execution modes and every dependency configuration.
        for profile in (None, "personal-macos", "work-macos"):
            for safe in (False, True):
                with self.subTest(profile=profile, safe=safe):  # noqa: SIM117
                    with tempfile.TemporaryDirectory() as directory:
                        stage = Path(directory)
                        home = stage / "home"
                        home.mkdir()
                        for name in load_mise_lock_module().CONFIG_FILES:
                            shutil.copy2(ROOT / name, stage / name)
                        environment = {
                            "HOME": str(home),
                            "PATH": os.defpath,
                            "MISE_TRUSTED_CONFIG_PATHS": str(stage),
                            "MISE_YES": "1",
                        }
                        if safe:
                            environment["MISE_SAFE"] = "1"
                        arguments = [mise]
                        if profile:
                            arguments.extend(["--env", profile])
                        result = subprocess.run(
                            [*arguments, "lock", tool],
                            cwd=stage,
                            env=environment,
                            capture_output=True,
                            text=True,
                            timeout=60,
                            check=False,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        with (stage / "mise.lock").open("rb") as lock_file:
                            locked = tomllib.load(lock_file)
                        self.assertEqual(
                            locked["tools"][tool][0]["version"],
                            tool_version(self.base["tools"][tool]),
                        )

    def test_workstation_profiles_require_age_keys(self) -> None:
        fish = shutil.which("fish")
        mise = shutil.which("mise")
        self.assertIsNotNone(fish)
        self.assertIsNotNone(mise)
        for profile in ("personal", "work"):
            with self.subTest(profile=profile):  # noqa: SIM117
                with tempfile.TemporaryDirectory() as home:
                    result = subprocess.run(
                        [
                            fish,
                            "--no-config",
                            "-c",
                            'source "$argv[1]"; "$argv[2]" env --json',
                            str(ROOT / "dotfiles" / profile / "mise-profile.fish"),
                            mise,
                        ],
                        cwd=ROOT,
                        env={
                            "HOME": home,
                            "PATH": os.defpath,
                            # The profile must override even an inherited CI setting.
                            "MISE_AGE_STRICT": "false",
                            "MISE_TRUSTED_CONFIG_PATHS": str(ROOT),
                            "MISE_YES": "1",
                        },
                        capture_output=True,
                        text=True,
                        timeout=60,
                        check=False,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("Failed to decrypt", result.stderr)
                    self.assertIn("No age identities found", result.stderr)

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

    def test_aerospace_is_a_declarative_macos_package(self) -> None:
        package = self.base["bootstrap"]["packages"][
            "brew-cask:nikitabobko/tap/aerospace"
        ]
        self.assertEqual(package, {"version": "latest", "os": "macos"})
        self.assertNotIn("bootstrap:homebrew-aerospace", self.base["tasks"])
        self.assertGreaterEqual(
            tuple(map(int, self.base["min_version"].split("."))),
            (2026, 9, 12),
            "AeroSpace requires staged_path support for third-party casks",
        )


if __name__ == "__main__":
    unittest.main()
