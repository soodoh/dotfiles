import base64
import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType
from urllib.parse import urlsplit

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
        mise_lock.UNSUPPORTED_TOOLS = {"work-macos": ("http:fixture",)}
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
                ("--env", "work-macos", "upgrade", "--bump", "http:fixture"),
                ("finalize",),
            ],
        )


class MiseConfigurationTests(unittest.TestCase):
    def test_agent_validation_has_a_dependency_install_prerequisite(self) -> None:
        tasks = load_toml("mise.toml")["tasks"]
        installers = {
            name for name, task in tasks.items()
            if "bun ci --cwd pi-extensions" in (
                task["run"] if isinstance(task.get("run"), list)
                else [task.get("run")]
            )
        }

        def prerequisites(name: str, seen: set[str]) -> set[str]:
            self.assertNotIn(name, seen, "task dependencies must be acyclic")
            result = set(tasks[name].get("depends", []))
            for dependency in tuple(result):
                result.update(prerequisites(dependency, seen | {name}))
            return result

        for name in ("validate:agents:fast", "validate:agents:integration"):
            with self.subTest(task=name):
                self.assertTrue(
                    prerequisites(name, set()) & installers,
                    "runtime consumers must wait for installation, including standalone invocation",
                )

    def test_profile_bootstrap_plans_only_run_on_macos(self) -> None:
        commands = load_toml("mise.toml")["tasks"]["validate:config"]["run"]
        script = commands[-1]
        with tempfile.TemporaryDirectory() as directory:
            tools = Path(directory)
            (tools / "uname").write_text('#!/bin/sh\nprintf "%s\\n" "$FAKE_UNAME"\n')
            (tools / "mise").write_text(
                '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MISE_CALLS"\n'
            )
            for name in ("uname", "mise"):
                (tools / name).chmod(0o755)
            calls = tools / "calls"
            for platform, expected in (
                ("Linux", []),
                (
                    "Darwin",
                    [
                        "--env personal-macos bootstrap plan",
                        "--env work-macos bootstrap plan",
                    ],
                ),
            ):
                with self.subTest(platform=platform):
                    calls.write_text("")
                    environment = os.environ | {
                        "PATH": f"{tools}:{os.environ['PATH']}",
                        "FAKE_UNAME": platform,
                        "MISE_CALLS": str(calls),
                    }
                    subprocess.run(
                        ["bash", "-c", script],
                        cwd=ROOT,
                        env=environment,
                        check=True,
                    )
                    self.assertEqual(calls.read_text().splitlines(), expected)

    @classmethod
    def setUpClass(cls) -> None:
        cls.base = load_toml("mise.toml")
        cls.personal = load_toml("mise.personal-macos.toml")
        cls.work = load_toml("mise.work-macos.toml")
        cls.shared_environment = cls.base["env"] | load_toml(
            "dotfiles/common/mise/credentials.toml"
        )["env"]
        cls.personal_environment = cls.personal.get("env", {}) | load_toml(
            "dotfiles/personal/mise-credentials.toml"
        )["env"]
        cls.work_environment = cls.work["env"] | load_toml(
            "dotfiles/work/mise-credentials.toml"
        )["env"]

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
        self.assertNotIn(
            "brew:gost", self.personal.get("bootstrap", {}).get("packages", {})
        )

        managed_directory = self.work["bootstrap"]["directories"]["/etc/tailscale"]
        self.assertEqual(managed_directory["owner"], "root")
        self.assertEqual(int(managed_directory["mode"], 8) & 0o022, 0)

        managed_file = self.work["bootstrap"]["files"][
            "/etc/tailscale/tailscaled-env.txt"
        ]
        self.assertTrue((ROOT / managed_file["source"]).is_file())
        self.assertEqual(managed_file["owner"], "root")
        self.assertEqual(int(managed_file["mode"], 8) & 0o022, 0)

        agent = self.work["bootstrap"]["macos"]["launchd"]["agents"][
            "tailscale-control-proxy"
        ]
        self.assertEqual(agent["args"][agent["args"].index("--env") + 1], "work-macos")
        self.assertNotIn("GOST_AUTH_PASSWORD", json.dumps(agent))
        self.assertEqual(agent["environment"]["MISE_EXEC_AUTO_INSTALL"], "false")

    def test_work_http_proxy_uses_local_first_hop_for_the_entire_profile(self) -> None:
        environment = self.work_environment
        self.assertEqual(environment["HTTP_PROXY"], environment["HTTPS_PROXY"])
        proxy = urlsplit(environment["HTTP_PROXY"])
        self.assertEqual(proxy.scheme, "http")
        self.assertIn(proxy.hostname, {"localhost", "127.0.0.1", "::1"})
        self.assertIsNotNone(proxy.port)
        bypasses = {item.strip() for item in environment["NO_PROXY"].split(",")}
        self.assertLessEqual({"localhost", "127.0.0.1", "::1"}, bypasses)
        for host in (
            "controlplane.tailscale.com",
            urlsplit(self.base["env"]["CLIPROXYAPI_BASE_URL"]).hostname,
        ):
            self.assertIsNotNone(host)
            for bypass in bypasses:
                domain = bypass.lstrip(".")
                self.assertFalse(
                    bypass == "*" or host == domain or host.endswith("." + domain),
                    f"{host} must use the local proxy, not NO_PROXY={bypass}",
                )
        managed_file = self.work["bootstrap"]["files"][
            "/etc/tailscale/tailscaled-env.txt"
        ]
        daemon_environment = dict(
            line.split("=", 1)
            for line in (ROOT / managed_file["source"]).read_text().splitlines()
            if line and not line.startswith("#")
        )
        for variable in ("HTTP_PROXY", "HTTPS_PROXY"):
            self.assertEqual(daemon_environment[variable], environment[variable])

    def test_colima_failed_start_is_cleaned_up_before_launchd_retries(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        agent = self.base["bootstrap"]["macos"]["launchd"]["agents"][
            "colima-default"
        ]
        # Colima can leave Lima alive after startup fails. A subsequent start
        # then reports "already running" without ever making Docker available.
        for startup_status, cleanup_status in ((0, 0), (1, 0), (7, 1)):
            with self.subTest(start=startup_status, cleanup=cleanup_status):
                with tempfile.TemporaryDirectory() as directory:
                    stage = Path(directory)
                    probe = stage / "colima"
                    calls = stage / "calls"
                    probe.write_text(
                        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n'
                        'case "$1" in\n'
                        'start) exit "$STARTUP_STATUS" ;;\n'
                        'stop) exit "$CLEANUP_STATUS" ;;\n'
                        '*) exit 64 ;;\nesac\n'
                    )
                    probe.chmod(0o755)
                    (stage / "mise.toml").write_text("")
                    arguments = [
                        arg.replace("/opt/homebrew/bin/colima", str(probe))
                        for arg in agent["args"]
                    ]
                    result = subprocess.run(
                        [mise, *arguments],
                        cwd=stage,
                        env={
                            "HOME": directory,
                            "PATH": os.defpath,
                            "MISE_TRUSTED_CONFIG_PATHS": directory,
                            "CALLS": str(calls),
                            "STARTUP_STATUS": str(startup_status),
                            "CLEANUP_STATUS": str(cleanup_status),
                        },
                        capture_output=True,
                        text=True,
                        timeout=10,
                        check=False,
                    )
                    self.assertEqual(result.returncode, startup_status, result.stderr)
                    commands = [
                        line.split() for line in calls.read_text().splitlines()
                    ]
                    self.assertEqual(commands[0][0], "start")
                    self.assertIn("--foreground", commands[0])
                    self.assertEqual(len(commands), 1 if startup_status == 0 else 2)
                    if startup_status:
                        self.assertEqual(commands[1][0], "stop")
                        self.assertIn("--force", commands[1])
                        for command in commands:
                            self.assertEqual(
                                command[command.index("--profile") + 1], "default"
                            )
        # The native policy must retry failures, not successful no-op starts.
        self.assertTrue(agent.get("keep_alive_on_failure"))
        self.assertFalse(agent.get("keep_alive", False))
        self.assertGreaterEqual(agent.get("throttle_interval", 0), 10)

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

    def test_pi_development_sdk_matches_the_installed_host_pin(self) -> None:
        manifest = json.loads((ROOT / "pi-extensions/package.json").read_text())
        host_version = tool_version(
            self.base["tools"]["npm:@earendil-works/pi-coding-agent"]
        )
        for package in manifest["peerDependencies"]:
            if package.startswith("@earendil-works/pi-"):
                with self.subTest(package=package):
                    self.assertEqual(
                        manifest["devDependencies"][package],
                        host_version,
                        "Test extensions against the same Pi SDK as the mise host",
                    )

    def test_azure_devops_mcp_allows_only_required_package_builds(self) -> None:
        tool = self.work["tools"]["npm:@azure-devops/mcp"]
        self.assertEqual(tool["allow_builds"], ["keytar"])

    def test_work_grafana_mcp_is_prod_only_and_read_only(self) -> None:
        servers = json.loads(
            (ROOT / "dotfiles/work/pi/agent/mcp.json").read_text()
        )["mcpServers"]
        self.assertEqual(
            [name for name in servers if name.startswith("grafana")],
            ["grafana-prod"],
        )
        grafana = servers["grafana-prod"]
        self.assertIn("--disable-write", " ".join(grafana["args"]))
        self.assertEqual(urlsplit(grafana["env"]["GRAFANA_URL"]).scheme, "https")
        for variable in ("HOME", "AZURE_CONFIG_DIR"):
            self.assertEqual(
                grafana["env"][variable], servers["azure"]["env"][variable]
            )
        self.assertNotIn("GRAFANA_SERVICE_ACCOUNT_TOKEN", grafana["env"])

    def test_workspace_mcp_credentials_are_encrypted_and_work_only(self) -> None:
        servers = json.loads(
            (ROOT / "dotfiles/work/pi/agent/mcp.json").read_text()
        )["mcpServers"]
        personal_servers = json.loads(
            (ROOT / "dotfiles/personal/pi/agent/mcp.json").read_text()
        )["mcpServers"]
        workspace = {
            name: server for name, server in servers.items() if name.startswith("gws-")
        }
        self.assertTrue(workspace)
        self.assertTrue(workspace.keys().isdisjoint(personal_servers))
        for name, server in workspace.items():
            with self.subTest(server=name):
                url = urlsplit(server["url"])
                self.assertEqual(url.scheme, "https")
                self.assertTrue(url.hostname.endswith(".googleapis.com"))
                self.assertRegex(
                    server["oauth"]["clientId"],
                    r"^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$",
                )
                reference = re.fullmatch(
                    r"\$\{([A-Z_]+)\}", server["oauth"]["clientSecret"]
                )
                self.assertIsNotNone(reference)
                variable = reference[1]
                self.assertEqual(set(self.work_environment[variable]), {"age"})
                self.assertNotIn(variable, self.shared_environment)
                self.assertNotIn(variable, self.personal_environment)
        self.assertEqual(
            servers["gws-gmail"]["oauth"]["scope"].split(),
            ["https://www.googleapis.com/auth/gmail.readonly"],
        )

    def test_work_azure_profiles_are_isolated(self) -> None:
        mcp = json.loads(
            (ROOT / "dotfiles/work/pi/agent/mcp.json").read_text()
        )["mcpServers"]
        azure = mcp["azure"]
        for variable in (
            "AZURE_DEV_TENANT_ID",
            "AZURE_PROD_TENANT_ID",
            "AZURE_SUBSCRIPTION_ID",
        ):
            with self.subTest(variable=variable):
                self.assertEqual(set(self.work_environment[variable]), {"age"})
        self.assertEqual(
            azure["env"]["AZURE_TOKEN_CREDENTIALS"],
            "AzureCliCredential",
        )

        azure_test = mcp["azure-test"]
        shell_directory = self.work_environment["AZURE_CONFIG_DIR"].replace(
            "{{ env.HOME }}", "${HOME}"
        )
        self.assertEqual(azure_test["env"]["AZURE_CONFIG_DIR"], shell_directory)
        self.assertNotEqual(azure["env"]["HOME"], azure_test["env"]["HOME"])
        self.assertNotEqual(
            azure["env"]["AZURE_CONFIG_DIR"], azure_test["env"]["AZURE_CONFIG_DIR"]
        )
        for server in (azure, azure_test):
            self.assertTrue(
                server["env"]["AZURE_CONFIG_DIR"].startswith(
                    server["env"]["HOME"] + "/"
                )
            )
        self.assertEqual(
            azure_test["env"]["AZURE_TOKEN_CREDENTIALS"],
            "AzureCliCredential",
        )
        for server in (azure, azure_test):
            self.assertIn("--read-only", server["args"])

    def test_automation_can_generate_locks_without_age_keys(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        tool = "npm:@earendil-works/pi-coding-agent"
        # An exactly pinned npm tool exercises real lock generation without downloads.
        # Neither trusted nor safe Renovate may need runner-specific overrides.
        for profile in (None, "personal-macos", "work-macos"):
            for mode in ("trusted", "safe"):
                with self.subTest(profile=profile, mode=mode):  # noqa: SIM117
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
                        if mode == "safe":
                            # Renovate's default path never evaluates project env.
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

    def test_bootstrap_hook_uses_selected_profile_without_shell_exports(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        # Run the real hook, but no actual packages, tools, services or dotfiles.
        # The nested mise and uname stubs make this safe on every CI platform.
        cases = (
            (None, [], {}, None),
            (None, ["--env", "personal-macos"], {}, "personal-macos"),
            (None, [], {"MISE_ENV": "work-macos"}, "work-macos"),
            ("personal-macos", [], {}, "personal-macos"),
            ("work-macos", [], {}, "work-macos"),
            ("personal-macos", ["--env", "work-macos"], {}, "work-macos"),
            ("work-macos", [], {"MISE_ENV": "personal-macos"}, "personal-macos"),
            ("work-macos", ["--env", "personal-macos"], {"MISE_ENV": "work-macos"}, "personal-macos"),
            ("personal-macos", ["--env", "unknown"], {}, None),
            ("personal-macos", ["--env", "personal-macos,work-macos"], {}, None),
        )
        for installed, flags, overrides, expected in cases:
            with self.subTest(installed=installed, flags=flags, overrides=overrides):
                with tempfile.TemporaryDirectory() as directory:
                    home = Path(directory).resolve()
                    config = home / ".config/mise"
                    config.mkdir(parents=True)
                    if installed:
                        shutil.copy2(
                            ROOT / "dotfiles" / installed.removesuffix("-macos") / "miserc.toml",
                            config / "miserc.toml",
                        )
                    stage = home / "checkout"
                    stage.mkdir()
                    (stage / "mise.toml").write_text(
                        "[bootstrap.hooks]\npre-packages = "
                        + json.dumps(self.base["bootstrap"]["hooks"]["pre-packages"])
                        + "\n"
                    )
                    if installed:
                        (config / "conf.d").mkdir()
                        (config / "conf.d/dotfiles").symlink_to(stage, target_is_directory=True)
                    tools = home / "bin"
                    tools.mkdir()
                    calls = home / "calls"
                    (tools / "uname").write_text('#!/bin/sh\nprintf "Darwin\\n"\n')
                    (tools / "mise").write_text(
                        '#!/bin/sh\nprintf "%s|%s\\n" "${MISE_ENV:-}" "$*" >> "$CALLS"\n'
                    )
                    for path in tools.iterdir():
                        path.chmod(0o755)
                    environment = {
                        "HOME": str(home), "PATH": f"{tools}:{os.defpath}",
                        "MISE_TRUSTED_CONFIG_PATHS": str(stage),
                        "MISE_DATA_DIR": str(home / "data"),
                        "MISE_CACHE_DIR": str(home / "cache"),
                        "MISE_STATE_DIR": str(home / "state"),
                        "CALLS": str(calls),
                        **overrides,
                    }
                    for cwd in ((stage, home) if installed else (stage,)):
                        with self.subTest(cwd=cwd):
                            calls.unlink(missing_ok=True)
                            result = subprocess.run(
                                [mise, *flags, "bootstrap", "--only", "packages"],
                                cwd=cwd, env=environment, capture_output=True, text=True,
                                timeout=20, check=False,
                            )
                            if expected:
                                self.assertEqual(result.returncode, 0, result.stderr)
                                self.assertEqual(
                                    calls.read_text().splitlines(),
                                    [f"{expected}|bootstrap packages apply brew:mas --yes"],
                                )
                            else:
                                self.assertNotEqual(result.returncode, 0, result.stderr)
                                self.assertIn("choose an explicit profile", result.stderr)
                                self.assertFalse(
                                    calls.exists(), "invalid profiles must not apply packages"
                                )

    @contextmanager
    def workstation_home(self, profile: str):
        # Reproduce only the declared mise links, never workstation bootstrap.
        # Isolate all state and start without inherited shell configuration.
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            profile_config = self.personal if profile == "personal" else self.work
            for destination, source in (
                self.base["dotfiles"] | profile_config["dotfiles"]
            ).items():
                if not destination.startswith("~/.config/mise/"):
                    continue
                target = home / destination.removeprefix("~/")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(ROOT / source)
            yield home, {
                "HOME": str(home),
                "PATH": os.defpath,
                "MISE_DATA_DIR": str(home / "data"),
                "MISE_CACHE_DIR": str(home / "cache"),
                "MISE_STATE_DIR": str(home / "state"),
                "MISE_TRUSTED_CONFIG_PATHS": f"{ROOT}:{home}",
                "MISE_YES": "1",
            }

    def test_native_dotfiles_apply_installs_mise_layout_and_reapplies_from_both_discovery_paths(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        for profile in ("personal", "work"):
            with tempfile.TemporaryDirectory() as directory:
                home = Path(directory).resolve()
                environment = {
                    "HOME": str(home), "PATH": os.defpath,
                    # dot apply reloads config after installing the global links.
                    # This keyless fixture tests links, not decryption policy.
                    "MISE_AGE_STRICT": "false",
                    "MISE_DATA_DIR": str(home / "data"),
                    "MISE_CACHE_DIR": str(home / "cache"),
                    "MISE_STATE_DIR": str(home / "state"),
                    "MISE_TRUSTED_CONFIG_PATHS": f"{ROOT}:{home}",
                }
                with self.subTest(profile=profile):
                    # Dotfiles only, in a disposable home: no bootstrap, packages,
                    # shell changes, macOS defaults, services, or application tasks.
                    result = subprocess.run(
                        [mise, "--env", f"{profile}-macos", "dot", "apply", "--yes"],
                        cwd=ROOT, env=environment, capture_output=True, text=True,
                        timeout=30, check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    config = home / ".config/mise"
                    self.assertEqual(
                        (config / "miserc.toml").resolve(),
                        ROOT / "dotfiles" / profile / "miserc.toml",
                    )
                    self.assertEqual((config / "conf.d/dotfiles").resolve(), ROOT)
                    for name in load_mise_lock_module().LOCK_FILES:
                        self.assertEqual((config / name).resolve(), ROOT / name)
                    # Repeat from both discovery paths without --env: installed
                    # miserc must select the same profile, with stable source paths.
                    profile_config = self.personal if profile == "personal" else self.work
                    for cwd in (ROOT, home):
                        result = subprocess.run(
                            [mise, "dot", "apply", "--yes"],
                            cwd=cwd, env=environment, capture_output=True, text=True,
                            timeout=30, check=False,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        for destination, source in (
                            self.base["dotfiles"] | profile_config["dotfiles"]
                        ).items():
                            target = home / destination.removeprefix("~/")
                            self.assertEqual(target.resolve(), (ROOT / source).resolve())

    def test_workstation_profiles_require_age_keys(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        for profile in ("personal", "work"):
            with self.workstation_home(profile) as (home, environment):
                for cwd in (home, ROOT):
                    with self.subTest(profile=profile, cwd=cwd):
                        result = subprocess.run(
                            [mise, "env", "--json"],
                            cwd=cwd,
                            env=environment,
                            capture_output=True,
                            text=True,
                            timeout=30,
                            check=False,
                        )
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("Failed to decrypt", result.stderr)
                        self.assertIn("No age identities found", result.stderr)

    def test_workstation_credentials_decrypt_only_the_selected_profile(self) -> None:
        mise = shutil.which("mise")
        age = shutil.which("age")
        keygen = shutil.which("age-keygen")
        self.assertIsNotNone(mise)
        self.assertIsNotNone(age)
        self.assertIsNotNone(keygen)
        # Use disposable keys and public fixture values, never workstation identities.
        for profile in ("personal", "work"):
            with self.workstation_home(profile) as (home, environment):
                identity = home / ".config/mise/age.txt"
                subprocess.run(
                    [keygen, "-o", str(identity)], capture_output=True, check=True,
                )
                recipient = subprocess.check_output(
                    [keygen, "-y", str(identity)], text=True,
                ).strip()
                wrong_identity = subprocess.run(
                    [mise, "env", "--json"], cwd=home, env=environment,
                    capture_output=True, text=True, timeout=30, check=False,
                )
                self.assertNotEqual(wrong_identity.returncode, 0)
                self.assertIn("Failed to decrypt", wrong_identity.stderr)

                expected = {}
                for scope, destination in (
                    ("shared", ".config/mise/conf.d/credentials.toml"),
                    ("personal", ".config/mise/config.personal-macos.toml"),
                    ("work", ".config/mise/config.work-macos.toml"),
                ):
                    target = home / destination
                    original = target.read_text()
                    declarations = tomllib.loads(original)["env"]
                    # Paths are also valid fixture values for the work CA setting.
                    value = str(home / f"{scope}-fixture.pem")
                    Path(value).touch()
                    encrypted = subprocess.check_output(
                        [age, "-r", recipient], input=value.encode(),
                    )
                    ciphertext = base64.b64encode(encrypted).decode().rstrip("=")
                    expected[scope] = {}
                    for name, specification in declarations.items():
                        if isinstance(specification, dict) and "age" in specification:
                            original = original.replace(specification["age"], ciphertext)
                            expected[scope][name] = value
                    # Replace only this temporary home's symlink, never its source.
                    target.unlink()
                    target.write_text(original)

                other = "work" if profile == "personal" else "personal"
                for selected, flags in ((profile, []), (other, ["--env", f"{other}-macos"])):
                    for cwd in (home, ROOT):
                        with self.subTest(profile=profile, selected=selected, cwd=cwd):
                            result = subprocess.run(
                                [mise, *flags, "env", "--json"], cwd=cwd, env=environment,
                                capture_output=True, text=True, timeout=30, check=False,
                            )
                            self.assertEqual(result.returncode, 0, result.stderr)
                            resolved = json.loads(result.stdout)
                            active = expected["shared"] | expected[selected]
                            self.assertTrue(active)
                            for name, value in active.items():
                                self.assertEqual(resolved.get(name), value, name)
                            excluded = expected["personal" if selected == "work" else "work"]
                            self.assertTrue(excluded.keys().isdisjoint(resolved))

    def test_dependency_configs_load_without_credentials_or_decryption_overrides(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise, "mise must be available to validate profile loading")
        with tempfile.TemporaryDirectory() as home:
            environment = {
                "CI": "1",
                "HOME": home,
                "MISE_TRUSTED_CONFIG_PATHS": str(ROOT),
                "MISE_YES": "1",
                "PATH": os.defpath,
            }
            for arguments in (
                ("config",),
                ("ls",),
                ("--env", "personal-macos", "env", "--json"),
                ("--env", "work-macos", "env", "--json"),
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
                        "Dependency config loading must not need workstation credentials:\n"
                        + result.stderr,
                    )

    def test_certificate_variables_resolve_with_or_without_ssl_cert_file(self) -> None:
        certificate_variables = (
            "REQUESTS_CA_BUNDLE",
            "NODE_EXTRA_CA_CERTS",
            "AWS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "HTTPLIB2_CA_CERTS",
        )
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        with self.workstation_home("work") as (home, workstation_environment):
            certificate = home / "certificate.pem"
            certificate.touch()
            for ssl_cert_file in (None, str(certificate)):
                with self.subTest(ssl_cert_file=ssl_cert_file):
                    environment = workstation_environment | {"MISE_AGE_STRICT": "false"}
                    if ssl_cert_file:
                        environment["SSL_CERT_FILE"] = ssl_cert_file
                    result = subprocess.run(
                        [mise, "--env", "work-macos", "env", "--json"],
                        cwd=ROOT,
                        env=environment,
                        capture_output=True,
                        text=True,
                        timeout=30,
                        check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    resolved = json.loads(result.stdout)
                    for variable in certificate_variables:
                        if ssl_cert_file:
                            self.assertEqual(resolved.get(variable), ssl_cert_file)
                        else:
                            self.assertIn(resolved.get(variable), (None, ""))

    def test_every_declared_tool_version_has_a_matching_lock_entry(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        environment = load_mise_lock_module().mise_environment(ROOT)
        for profile in (None, "personal-macos", "work-macos"):
            arguments = [mise]
            config_tools = dict(self.base["tools"])
            lock_tools = dict(load_toml("mise.lock")["tools"])
            if profile:
                arguments.extend(["--env", profile])
                config_tools.update(load_toml(f"mise.{profile}.toml").get("tools", {}))
                lock_tools.update(load_toml(f"mise.{profile}.lock").get("tools", {}))
            result = subprocess.run(
                [*arguments, "ls", "--current", "--offline", "--json"],
                cwd=ROOT, env=environment, capture_output=True, text=True,
                timeout=30, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("Failed to resolve", result.stderr)
            resolved = json.loads(result.stdout)
            self.assertEqual(set(resolved), set(config_tools))
            for tool, specification in config_tools.items():
                with self.subTest(profile=profile, tool=tool):
                    records = resolved[tool]
                    self.assertEqual(
                        [record["requested_version"] for record in records],
                        [tool_version(specification)],
                    )
                    for record in records:
                        self.assertIn(
                            record["version"],
                            [entry["version"] for entry in lock_tools.get(tool, [])],
                            f"{profile}: {tool}@{record['version']} is missing from the lock",
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

    def test_shared_skill_catalogs_and_locks_are_synchronized(self) -> None:
        profile_roots = [
            ROOT / "dotfiles" / profile / "agents" for profile in ("personal", "work")
        ]
        locks = [
            json.loads((profile_root / ".skill-lock.json").read_text())
            for profile_root in profile_roots
        ]
        shared_skills = locks[0]["skills"].keys() & locks[1]["skills"].keys()
        for skill in shared_skills:
            entries = [lock["skills"][skill] for lock in locks]
            if entries[0]["source"] != entries[1]["source"]:
                continue
            skill_files = [
                profile_root / "skills" / skill / "SKILL.md"
                for profile_root in profile_roots
            ]
            with self.subTest(skill=skill):
                self.assertTrue(all(path.is_file() for path in skill_files))
                self.assertEqual(len({path.read_bytes() for path in skill_files}), 1)
                self.assertEqual(
                    len({entry["skillFolderHash"] for entry in entries}), 1
                )

    def test_bootstrap_loads_global_github_credentials_without_fish(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        config = ROOT / self.base["dotfiles"]["~/.config/mise/config.toml"]
        for mode in ("linked", "explicit"):
            with self.subTest(mode=mode):  # noqa: SIM117
                with tempfile.TemporaryDirectory() as home:
                    environment = {
                        "HOME": home,
                        "PATH": os.defpath,
                        "MISE_ENV": "work-macos",
                        "MISE_TRUSTED_CONFIG_PATHS": str(ROOT),
                    }
                    if mode == "linked":
                        target = Path(home) / ".config/mise/config.toml"
                        target.parent.mkdir(parents=True)
                        target.symlink_to(config)
                    else:
                        environment["MISE_GLOBAL_CONFIG_FILE"] = str(config)
                    # Read the setting at bootstrap scope; never apply bootstrap
                    # or execute gh against the user's credentials.
                    result = subprocess.run(
                        [mise, "settings", "get", "github.credential_command"],
                        cwd=ROOT,
                        env=environment,
                        capture_output=True,
                        text=True,
                        timeout=10,
                        check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(
                        result.stdout.strip(),
                        load_toml(str(config))["settings"]["github"][
                            "credential_command"
                        ],
                    )

    def test_workstation_profiles_select_locked_tools_and_allow_project_overrides(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        for profile in ("personal", "work"):
            profile_config = self.personal if profile == "personal" else self.work
            with self.workstation_home(profile) as (home, environment):
                project = home / "other-project"
                project.mkdir()
                # Selection needs no secrets; strict decryption is tested separately.
                environment["MISE_AGE_STRICT"] = "false"
                for cwd in (home, ROOT, project):
                    with self.subTest(profile=profile, cwd=cwd):
                        expected = self.base["tools"] | profile_config["tools"]
                        if cwd == project:
                            (project / "mise.toml").write_text(
                                '[tools]\n"aqua:starship/starship" = "1.0.0"\n'
                            )
                            (project / "mise.lock").write_text(
                                '[[tools."aqua:starship/starship"]]\n'
                                'version = "1.0.0"\n'
                                'backend = "aqua:starship/starship"\n'
                            )
                            expected = expected | {"aqua:starship/starship": "1.0.0"}
                        result = subprocess.run(
                            [mise, "ls", "--current", "--json"],
                            cwd=cwd,
                            env=environment,
                            capture_output=True,
                            text=True,
                            timeout=30,
                            check=False,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertNotIn("Failed to resolve", result.stderr)
                        selected = {
                            tool: [record["requested_version"] for record in records]
                            for tool, records in json.loads(result.stdout).items()
                        }
                        self.assertEqual(
                            selected,
                            {
                                tool: [tool_version(specification)]
                                for tool, specification in expected.items()
                            },
                        )

    def test_workstation_profile_can_be_overridden_explicitly(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        for profile, other in (("personal", "work"), ("work", "personal")):
            with self.workstation_home(profile) as (home, environment):
                environment["MISE_AGE_STRICT"] = "false"
                result = subprocess.run(
                    [mise, "--env", f"{other}-macos", "ls", "--current", "--json"],
                    cwd=home, env=environment, capture_output=True, text=True,
                    timeout=30, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("Failed to resolve", result.stderr)
                selected = {
                    tool: [record["requested_version"] for record in records]
                    for tool, records in json.loads(result.stdout).items()
                }
                other_config = self.personal if other == "personal" else self.work
                self.assertEqual(selected, {
                    tool: [tool_version(specification)]
                    for tool, specification in (self.base["tools"] | other_config["tools"]).items()
                })

    def test_workstation_global_settings_work_without_shell_exports(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        for profile in ("personal", "work"):
            with self.workstation_home(profile) as (home, environment):
                for cwd in (home, ROOT):
                    for setting, expected in (
                        ("self_update.auto", "true"),
                        ("age.strict", "true"),
                        ("github.credential_command", 'gh auth token --hostname "$MISE_CREDENTIAL_HOST"'),
                    ):
                        with self.subTest(profile=profile, cwd=cwd, setting=setting):
                            result = subprocess.run(
                                [mise, "settings", "get", setting],
                                cwd=cwd,
                                env=environment,
                                capture_output=True,
                                text=True,
                                timeout=10,
                                check=False,
                            )
                            self.assertEqual(result.returncode, 0, result.stderr)
                            self.assertEqual(result.stdout.strip(), expected)

    def test_workstation_global_tasks_run_in_the_checkout_with_selected_profile(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        for profile in ("personal", "work"):
            with self.workstation_home(profile) as (home, environment):
                # Exercise native task loading with a harmless task beside the real
                # config, without editing the checkout or executing a setup task.
                fragment = home / ".config/mise/conf.d/task-probe"
                fragment.mkdir(parents=True)
                (fragment / "mise.toml").write_text(
                    '[task_config]\ndir = "' + str(ROOT) + '"\n'
                    '[tasks.profile-probe]\n'
                    'run = \'printf "%s\\n%s\\n" "$PWD" "$MISE_ENV"\'\n'
                )
                environment["MISE_AGE_STRICT"] = "false"
                # Metadata validates the real tasks' directory; executing the probe
                # additionally checks native profile propagation to child processes.
                for cwd in (home, ROOT):
                    with self.subTest(profile=profile, cwd=cwd):
                        result = subprocess.run(
                            [mise, "tasks", "info", "validate:repository", "--json"],
                            cwd=cwd, env=environment, capture_output=True, text=True,
                            timeout=20, check=False,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        task = json.loads(result.stdout)
                        self.assertEqual(Path(task["dir"]).resolve(), ROOT)
                result = subprocess.run(
                    [mise, "run", "profile-probe"],
                    cwd=home, env=environment, capture_output=True, text=True,
                    timeout=20, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines(), [str(ROOT), f"{profile}-macos"])

    def test_google_cloud_configuration_stays_in_shared_scope(self) -> None:
        google_env = {
            name
            for name in self.shared_environment
            if name.startswith("GOOGLE_CLOUD_")
        }
        self.assertTrue(google_env.isdisjoint(self.work_environment))
        self.assertTrue(google_env.isdisjoint(self.personal_environment))

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

    def test_aerospace_launch_agent_matches_each_profile_cask_appdir(self) -> None:
        shared_agent = self.base["bootstrap"]["macos"]["launchd"]["agents"]["aerospace"]
        work_agent = self.work["bootstrap"]["macos"]["launchd"]["agents"]["aerospace"]
        personal_agents = (
            self.personal.get("bootstrap", {})
            .get("macos", {})
            .get("launchd", {})
            .get("agents", {})
        )

        for profile, agent in (
            (self.personal, personal_agents.get("aerospace", shared_agent)),
            (self.work, work_agent),
        ):
            environment = self.base["env"] | profile.get("env", {})
            appdir = environment.get("MISE_BREW_CASK_OPT_APPDIR", "/Applications")
            appdir = appdir.replace("{{ env.HOME }}", "~")
            self.assertEqual(
                Path(agent["program"]),
                Path(appdir) / "AeroSpace.app/Contents/MacOS/AeroSpace",
            )
        self.assertEqual(
            {key: value for key, value in work_agent.items() if key != "program"},
            {key: value for key, value in shared_agent.items() if key != "program"},
            "profile overrides replace the entire agent; retain its startup settings",
        )

    def test_mise_supports_aerospace_third_party_cask_installation(self) -> None:
        self.assertGreaterEqual(
            tuple(map(int, self.base["min_version"].split("."))),
            (2026, 9, 12),
            "AeroSpace requires staged_path support for third-party casks",
        )


if __name__ == "__main__":
    unittest.main()
