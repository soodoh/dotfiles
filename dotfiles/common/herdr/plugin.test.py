"""Exercise guards with disposable Git checkouts; never install or execute a plugin."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import plugin


class PluginTests(unittest.TestCase):
    spec = plugin.NOTIFIER

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="herdr-plugin-test-")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.env = {
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
        }
        self.system_name = "Darwin"
        self.installs: list[tuple[str, str]] = []
        self.remote_calls: list[list[str]] = []
        self.install_behavior = None
        self.remote_behavior = None
        self.host = self.make_host()

        self.config_dir = self.home / "config/herdr"
        self.config_dir.mkdir(parents=True)
        self.registry = self.config_dir / "plugins.json"
        self.checkout = self.config_dir / "plugins/github" / self.spec.checkout
        self.upstream = self.home / "upstream"
        plugin.git("init", "--quiet", self.upstream, host=self.host)
        (self.upstream / ".gitignore").write_text("/target/\n/bin/\n")
        (self.upstream / "herdr-plugin.toml").write_text(
            f'id = "{self.spec.id}"\nversion = "0.11.0"\n'
        )
        plugin.git("-C", self.upstream, "add", ".", host=self.host)
        plugin.git(
            "-C", self.upstream, "commit", "--quiet", "-m", "initial", host=self.host
        )
        self.old = plugin.git("-C", self.upstream, "rev-parse", "HEAD", host=self.host)
        (self.upstream / "source").write_text("next revision\n")
        plugin.git("-C", self.upstream, "add", ".", host=self.host)
        plugin.git(
            "-C", self.upstream, "commit", "--quiet", "-m", "next", host=self.host
        )
        self.new = plugin.git("-C", self.upstream, "rev-parse", "HEAD", host=self.host)

    def make_host(self, *, environ=None, system_name=None):
        env = self.env if environ is None else environ
        os_name = self.system_name if system_name is None else system_name

        def run(args, **kwargs):
            if args[:3] == ["herdr", "plugin", "install"]:
                repo, pin = args[3], args[5]
                self.assertEqual(
                    args, ["herdr", "plugin", "install", repo, "--ref", pin, "--yes"]
                )
                self.installs.append((repo, pin))
                if self.install_behavior is not None:
                    return self.install_behavior(args, repo, pin)
                self.assertEqual(repo, self.spec.repo)
                self.seed_install(pin)
                return subprocess.CompletedProcess(args, 0, "", "")
            if args[:2] == ["git", "ls-remote"]:
                self.remote_calls.append(list(args))
                if self.remote_behavior is not None:
                    return self.remote_behavior(args)
                raise AssertionError(f"unexpected ls-remote: {args}")
            check = kwargs.pop("check", False)
            return subprocess.run(args, check=check, **kwargs)

        return plugin.Host(
            run=run,
            environ=env,
            system=lambda: os_name,
            which=lambda cmd: f"/fixture/bin/{cmd}",
            home=lambda: self.home,
        )

    def seed_install(self, pin):
        if self.checkout.exists():
            shutil.rmtree(
                self.checkout
            )  # Disposable fixture only, not production behavior.
        plugin.git("clone", "--quiet", self.upstream, self.checkout, host=self.host)
        plugin.git(
            "-C", self.checkout, "checkout", "--quiet", "--detach", pin, host=self.host
        )
        binary = self.checkout / self.spec.binary
        binary.parent.mkdir(parents=True)
        binary.write_text("fixture only: must never execute\n")
        binary.chmod(0o755)
        self.entry = {
            "plugin_id": self.spec.id,
            "enabled": True,
            "plugin_root": str(self.checkout),
            "manifest_path": str(self.checkout / "herdr-plugin.toml"),
            "source": {
                "kind": "github",
                "owner": self.spec.repo.split("/")[0],
                "repo": self.spec.repo.split("/")[1],
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
                self.env["MISE_ENV"] = profile
                plugin.reconcile("bootstrap", self.old, self.spec, host=self.host)
        self.assertEqual(self.installs, [(self.spec.repo, self.old)])
        plugin.reconcile("update", self.new, self.spec, host=self.host)
        plugin.reconcile("update", self.new, self.spec, host=self.host)
        self.assertEqual(
            self.installs, [(self.spec.repo, self.old), (self.spec.repo, self.new)]
        )
        self.assertEqual(
            plugin.installed_pin(self.config_dir, self.spec, host=self.host), self.new
        )

    def test_both_actions_apply_changed_committed_pins_including_rollbacks(self):
        for action in ("bootstrap", "update"):
            with self.subTest(action=action):
                self.seed_install(self.old)
                self.installs.clear()
                for desired in (self.new, self.old):
                    plugin.reconcile(action, desired, self.spec, host=self.host)
                    self.assertEqual(self.installs[-1], (self.spec.repo, desired))
                    self.assertEqual(
                        plugin.installed_pin(
                            self.config_dir, self.spec, host=self.host
                        ),
                        desired,
                    )
                    before = self.registry.read_bytes()
                    calls = len(self.installs)
                    plugin.reconcile(action, desired, self.spec, host=self.host)
                    self.assertEqual(len(self.installs), calls)
                    self.assertEqual(self.registry.read_bytes(), before)
                self.assertEqual(len(self.installs), 2)

    def test_platform_scoping_and_explicit_macos_profile(self):
        without_profile = self.make_host(
            environ={k: v for k, v in self.env.items() if k != "MISE_ENV"}
        )
        with self.assertRaisesRegex(ValueError, "choose --env"):
            plugin.reconcile("bootstrap", self.new, self.spec, host=without_profile)
        self.assertEqual(self.installs, [])
        linux_host = self.make_host(
            environ={k: v for k, v in self.env.items() if k != "MISE_ENV"},
            system_name="Linux",
        )
        for action in ("bootstrap", "update"):
            plugin.reconcile(action, self.new, self.spec, host=linux_host)
        if "Linux" in self.spec.systems:
            self.assertEqual(self.installs, [(self.spec.repo, self.new)])
        else:
            self.assertEqual(self.installs, [])
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
                        "-C",
                        self.checkout,
                        "checkout",
                        "--quiet",
                        "--detach",
                        self.new,
                        host=self.host,
                    )
                elif state == "binary":
                    (self.checkout / self.spec.binary).unlink()
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
                        plugin.reconcile(action, self.new, self.spec, host=self.host)
                self.assertEqual(self.registry.read_bytes(), before)
        self.assertEqual(self.installs, [])

    def test_installer_failure_or_missing_postcondition_is_not_success(self):
        def fail_install(args, _repo, _pin):
            raise subprocess.CalledProcessError(1, args)

        self.install_behavior = fail_install
        with self.assertRaises(subprocess.CalledProcessError):
            plugin.reconcile("bootstrap", self.new, self.spec, host=self.host)

        self.install_behavior = lambda args, _repo, _pin: subprocess.CompletedProcess(
            args, 0, "", ""
        )
        with self.assertRaisesRegex(ValueError, "installer did not produce"):
            plugin.reconcile("bootstrap", self.new, self.spec, host=self.host)

    def test_pin_refresh_changes_only_pin_and_is_idempotent(self):
        config = self.home / "mise.toml"
        original = f'# preserve formatting\n[vars]\n{self.spec.pin_key} = "{self.old}" # pin\nother = "keep"\n'
        config.write_text(original)
        self.remote_behavior = lambda args: subprocess.CompletedProcess(
            args, 0, f"{self.new}\t{plugin.BRANCH}\n", ""
        )
        plugin.refresh_pin(config, self.spec, host=self.host)
        self.assertEqual(config.read_text(), original.replace(self.old, self.new))
        stamp = config.stat().st_mtime_ns
        plugin.refresh_pin(config, self.spec, host=self.host)
        self.assertEqual(config.stat().st_mtime_ns, stamp)
        self.assertEqual(
            self.remote_calls[-1],
            ["git", "ls-remote", "--exit-code", self.spec.url, plugin.BRANCH],
        )
        self.assertEqual(self.installs, [])

    def test_bad_remote_response_or_failure_leaves_pin_untouched(self):
        config = self.home / "mise.toml"
        original = f'[vars]\n{self.spec.pin_key} = "{self.old}"\n'
        config.write_text(original)
        for output in (
            "",
            "bad refs/heads/main",
            f"{self.new} refs/heads/wrong",
            f"{self.new} {plugin.BRANCH}\n{self.old} {plugin.BRANCH}",
        ):
            with self.subTest(output=output):
                self.remote_behavior = lambda args, output=output: (
                    subprocess.CompletedProcess(args, 0, output, "")
                )
                with self.assertRaises(ValueError):
                    plugin.refresh_pin(config, self.spec, host=self.host)
                self.assertEqual(config.read_text(), original)

        def fail_remote(args):
            raise subprocess.CalledProcessError(1, args)

        self.remote_behavior = fail_remote
        with self.assertRaises(subprocess.CalledProcessError):
            plugin.refresh_pin(config, self.spec, host=self.host)
        self.assertEqual(config.read_text(), original)
        self.assertEqual(self.installs, [])

    def test_healthy_release_install_is_adopted_without_rebuilding(self):
        self.seed_install(self.old)
        self.assertEqual(
            plugin.git("-C", self.checkout, "tag", "--list", host=self.host), ""
        )
        self.entry["source"]["requested_ref"] = "v0.11.0"
        self.save_registry()
        before = self.registry.read_bytes()
        for action in ("bootstrap", "update"):
            plugin.reconcile(action, self.old, self.spec, host=self.host)
        self.assertEqual(self.installs, [])
        self.assertEqual(self.registry.read_bytes(), before)
        self.entry["source"]["requested_ref"] = "v0.12.0"
        self.save_registry()
        with self.assertRaisesRegex(ValueError, "release differs"):
            plugin.reconcile("update", self.new, self.spec, host=self.host)
        self.assertEqual(self.installs, [])


class SeshTests(PluginTests):
    spec = plugin.SESH


class InstallerTests(unittest.TestCase):
    def test_install_delegates_to_herdr_with_explicit_pin(self):
        pin = "a" * 40
        for spec in plugin.PLUGINS:
            with self.subTest(plugin=spec.id):
                looked_up: list[str] = []
                invocations: list[tuple[list[str], dict]] = []

                def which(cmd, looked_up=looked_up):
                    looked_up.append(cmd)
                    return "/fixture/bin"

                def run(args, invocations=invocations, **kwargs):
                    invocations.append((list(args), kwargs))
                    return subprocess.CompletedProcess(args, 0, "", "")

                host = plugin.Host(run=run, which=which)
                plugin.install(pin, spec, host=host)
                self.assertEqual(
                    invocations,
                    [
                        (
                            [
                                "herdr",
                                "plugin",
                                "install",
                                spec.repo,
                                "--ref",
                                pin,
                                "--yes",
                            ],
                            {"check": True},
                        )
                    ],
                )
                self.assertEqual(looked_up, ["herdr", "git", *spec.prerequisites])

            for missing in ("herdr", "git", *spec.prerequisites):
                with self.subTest(plugin=spec.id, missing=missing):
                    invocations = []
                    host = plugin.Host(
                        run=lambda args, invocations=invocations, **kwargs: (
                            invocations.append(list(args))
                        ),
                        which=lambda cmd, missing=missing: (
                            None if cmd == missing else "/fixture/bin"
                        ),
                    )
                    with self.assertRaisesRegex(ValueError, f"missing {missing}"):
                        plugin.install(pin, spec, host=host)
                    self.assertEqual(invocations, [])


class LocalPluginTests(unittest.TestCase):
    plugin_id, root = plugin.LOCAL_PLUGINS[0]

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="herdr-local-plugin-test-")
        self.addCleanup(temporary.cleanup)
        config = Path(temporary.name).resolve()
        self.registry = config / "herdr/plugins.json"
        self.registry.parent.mkdir()
        self.commands: list[list[str]] = []
        self.host = plugin.Host(
            run=self.record_run,
            environ={"XDG_CONFIG_HOME": str(config)},
            which=lambda _cmd: "/bin/herdr",
        )

    def record_run(self, args, **kwargs):
        self.commands.append(list(args))
        return subprocess.CompletedProcess(args, 0, "", "")

    def register(self, **entry):
        entry = {"plugin_id": self.plugin_id, "enabled": True, **entry}
        self.registry.write_text(json.dumps([entry]))

    def test_absent_or_owned_plugins_are_relinked_to_refresh_the_manifest(self):
        plugin.link_local(self.plugin_id, self.root, host=self.host)
        self.register(plugin_root=str(self.root), source={"kind": "local"})
        plugin.link_local(self.plugin_id, self.root, host=self.host)
        link = ["herdr", "plugin", "link", str(self.root)]
        self.assertEqual(self.commands, [link, link])

    def test_disabled_or_foreign_registrations_are_preserved(self):
        self.register(plugin_root=str(self.root), enabled=False)
        plugin.link_local(self.plugin_id, self.root, host=self.host)
        for root, source in (
            ("/elsewhere", {"kind": "local"}),
            (str(self.root), {"kind": "github", "owner": "x", "repo": "y"}),
        ):
            self.register(plugin_root=root, source=source)
            with self.assertRaisesRegex(ValueError, "another source"):
                plugin.link_local(self.plugin_id, self.root, host=self.host)
        self.assertEqual(self.commands, [])


class HostTests(unittest.TestCase):
    def test_herdr_config_dir_ignores_empty_or_relative_xdg_config_home(self):
        with tempfile.TemporaryDirectory(prefix="herdr-host-test-") as directory:
            home = Path(directory).resolve()
            expected_default = (home / ".config/herdr").resolve()
            for environ in ({}, {"XDG_CONFIG_HOME": ""}, {"XDG_CONFIG_HOME": "rel/cfg"}):
                with self.subTest(environ=environ):
                    host = plugin.Host(environ=environ, home=lambda: home)
                    self.assertEqual(host.herdr_config_dir(), expected_default)
            custom = home / "xdg"
            host = plugin.Host(environ={"XDG_CONFIG_HOME": str(custom)}, home=lambda: home)
            self.assertEqual(host.herdr_config_dir(), (custom / "herdr").resolve())
            env_home_host = plugin.Host(environ={"HOME": str(home)})
            self.assertEqual(env_home_host.herdr_config_dir(), expected_default)
            for missing_home in ({}, {"HOME": ""}, {"HOME": "rel/home"}):
                with self.subTest(missing_home=missing_home):
                    isolated = plugin.Host(environ=missing_home)
                    with self.assertRaisesRegex(ValueError, "absolute HOME"):
                        isolated.herdr_config_dir()

    def test_find_executable_uses_injected_environ_path(self):
        with tempfile.TemporaryDirectory(prefix="herdr-path-test-") as directory:
            bindir = Path(directory).resolve()
            tool = bindir / "herdr-fake-tool"
            tool.write_text("#!/bin/sh\n")
            tool.chmod(0o755)
            host_with_path = plugin.Host(environ={"PATH": str(bindir)})
            self.assertEqual(host_with_path.find_executable("herdr-fake-tool"), str(tool))
            self.assertIsNone(host_with_path.find_executable("sh"))
            host_without_path = plugin.Host(environ={})
            self.assertIsNone(host_without_path.find_executable("sh"))


class RunActionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="herdr-run-action-test-")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.config_dir = self.home / "config/herdr"
        self.config_dir.mkdir(parents=True)
        self.old = "a" * 40
        self.new = "b" * 40
        self.config = self.home / "mise.toml"
        self.config.write_text(
            "[vars]\n"
            + "".join(f'{spec.pin_key} = "{self.old}"\n' for spec in plugin.PLUGINS)
        )

    def test_refresh_pin_updates_all_pins_without_linking_local_plugins(self):
        commands: list[list[str]] = []

        def run(args, **kwargs):
            commands.append(list(args))
            if args[:2] == ["git", "ls-remote"]:
                return subprocess.CompletedProcess(
                    args, 0, f"{self.new}\t{plugin.BRANCH}\n", ""
                )
            raise AssertionError(f"unexpected command: {args}")

        host = plugin.Host(
            run=run,
            environ={"HOME": str(self.home), "XDG_CONFIG_HOME": str(self.home / "config")},
            system=lambda: "Darwin",
            which=lambda cmd: f"/bin/{cmd}",
        )
        plugin.run_action("refresh-pin", config=self.config, host=host)
        self.assertEqual(
            commands,
            [
                ["git", "ls-remote", "--exit-code", spec.url, plugin.BRANCH]
                for spec in plugin.PLUGINS
            ],
        )
        for spec in plugin.PLUGINS:
            self.assertIn(f'{spec.pin_key} = "{self.new}"', self.config.read_text())

    def test_bootstrap_links_darwin_only_local_plugins_only_on_darwin(self):
        browser_links = (
            Path(plugin.__file__).resolve().parents[2] / "macos/herdr/browser-links"
        )
        for system_name, expected_roots in (
            ("Linux", [root for _, root in plugin.LOCAL_PLUGINS]),
            (
                "Darwin",
                [*(root for _, root in plugin.LOCAL_PLUGINS), browser_links],
            ),
        ):
            with self.subTest(system=system_name):
                links: list[Path] = []
                applicable = [s for s in plugin.PLUGINS if system_name in s.systems]
                base_env = {
                    "HOME": str(self.home),
                    "XDG_CONFIG_HOME": str(self.home / f"cfg-{system_name}"),
                    "MISE_ENV": "personal-macos",
                    "PATH": os.environ["PATH"],
                    "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_AUTHOR_NAME": "Test",
                    "GIT_AUTHOR_EMAIL": "test@example.invalid",
                    "GIT_COMMITTER_NAME": "Test",
                    "GIT_COMMITTER_EMAIL": "test@example.invalid",
                }
                cfg = Path(base_env["XDG_CONFIG_HOME"]) / "herdr"
                cfg.mkdir(parents=True)
                entries = []
                pins: dict[str, str] = {}
                real_host = plugin.Host(environ=base_env)
                for spec in applicable:
                    checkout = cfg / "plugins/github" / spec.checkout
                    checkout.mkdir(parents=True)
                    plugin.git("init", "--quiet", checkout, host=real_host)
                    (checkout / ".gitignore").write_text("/target/\n/bin/\n")
                    (checkout / "herdr-plugin.toml").write_text(
                        f'id = "{spec.id}"\nversion = "0.1.0"\n'
                    )
                    plugin.git("-C", checkout, "add", ".", host=real_host)
                    plugin.git(
                        "-C", checkout, "commit", "--quiet", "-m", "init", host=real_host
                    )
                    sha = plugin.git("-C", checkout, "rev-parse", "HEAD", host=real_host)
                    pins[spec.pin_key] = sha
                    binary = checkout / spec.binary
                    binary.parent.mkdir(parents=True)
                    binary.write_text("fixture\n")
                    binary.chmod(0o755)
                    owner, repo = spec.repo.split("/")
                    entries.append(
                        {
                            "plugin_id": spec.id,
                            "plugin_root": str(checkout),
                            "manifest_path": str(checkout / "herdr-plugin.toml"),
                            "enabled": True,
                            "source": {
                                "kind": "github",
                                "owner": owner,
                                "repo": repo,
                                "requested_ref": sha,
                                "resolved_commit": sha,
                                "managed_path": str(checkout),
                            },
                        }
                    )
                (cfg / "plugins.json").write_text(json.dumps(entries))
                mise_cfg = self.home / f"mise-{system_name}.toml"
                mise_cfg.write_text(
                    "[vars]\n"
                    + "".join(
                        f'{s.pin_key} = "{pins.get(s.pin_key, self.old)}"\n'
                        for s in plugin.PLUGINS
                    )
                )

                def run(args, **kwargs):
                    if args[:3] == ["herdr", "plugin", "link"]:
                        links.append(Path(args[3]))
                        return subprocess.CompletedProcess(args, 0, "", "")
                    check = kwargs.pop("check", False)
                    return subprocess.run(args, check=check, **kwargs)

                host = plugin.Host(
                    run=run,
                    environ=base_env,
                    system=lambda name=system_name: name,
                    which=lambda cmd: f"/bin/{cmd}",
                )
                plugin.run_action("bootstrap", config=mise_cfg, host=host)
                self.assertEqual(links, expected_roots)


if __name__ == "__main__":
    unittest.main()
