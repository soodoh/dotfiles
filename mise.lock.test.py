import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
VALID_LOCK = b"[tools]\n"


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "mise_lock_tested", ROOT / "mise.lock.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load mise.lock.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_minimal_repository(root: Path) -> None:
    (root / "mise.toml").write_text("[tool_config]\nlocked = true\n")
    for profile in ("personal-macos", "work-macos"):
        (root / f"mise.{profile}.toml").write_text("[tools]\n")
    for name in ("mise.lock", "mise.personal-macos.lock", "mise.work-macos.lock"):
        (root / name).write_bytes(VALID_LOCK)


def write_validation_repository(root: Path) -> None:
    write_minimal_repository(root)
    (root / "mise.toml").write_text(
        '[settings]\nlockfile = true\n[tool_config]\nlocked = true\n'
        '[tools]\npython = "3.15.2"\n'
        'rust = { version = "1.99.1", components = ["rustfmt", "clippy"] }\n'
    )
    # Archive dates can advance independently of the requested Python version.
    archive = '\n'.join(
        f'[tools.python."platforms.{platform}"]\n'
        f'url = "https://example.invalid/20261026/python-{platform}.tar.gz"\n'
        f'checksum = "sha256:{"a" * 64}"\n'
        'provenance = "github-attestations"\n'
        for platform in ("linux-x64", "linux-arm64", "macos-x64", "macos-arm64")
    )
    (root / "mise.lock").write_text(
        '[[tools.python]]\nversion = "3.15.2"\nbackend = "core:python"\n'
        + archive
        + '\n[[tools.rust]]\nversion = "1.99.1"\nbackend = "core:rust"\n'
        '[tools.rust.options]\ncomponents = "clippy,rustfmt"\n'
    )
    (root / "mise.work-macos.toml").write_text(
        '[tools]\n"npm:example" = "1.2.3"\n'
        '"pipx:example" = { version = "1.0.0", python = "3.13" }\n'
    )
    (root / "mise.work-macos.lock").write_text(
        '[[tools."npm:example"]]\nversion = "1.2.3"\nbackend = "npm:example"\n'
        '[[tools."pipx:example"]]\nversion = "1.0.0"\nbackend = "pipx:example"\n'
        '[tools."pipx:example".options]\npython = "3.13"\n'
        '[[tools.python]]\nversion = "3.13.18"\nbackend = "core:python"\n'
        + archive
    )


def add_http_tool(root: Path, config_name: str, *, literal: bool = False, scope: str | None = None) -> None:
    declarations = ['[tools."http:example"]', 'version = "1.2"']
    if scope is not None:
        declarations.append(f'os = ["{scope}"]')
    archives = ['[[tools."http:example"]]', 'version = "1.2.3"', 'backend = "http:example"']
    for platform in ("linux-x64", "linux-arm64", "macos-x64", "macos-arm64"):
        if scope and not platform.startswith(scope + "-"):
            continue
        url = f"https://example.invalid/{platform}/1.2.3.tar.gz"
        template = url if literal else url.replace("1.2.3", "{{ version }}")
        declarations.extend([
            f'[tools."http:example".platforms.{platform}]', f'url = "{template}"',
        ])
        archives.extend([
            f'[tools."http:example"."platforms.{platform}"]', f'url = "{url}"',
            f'checksum = "sha256:{"a" * 64}"',
        ])
    for name, lines in (
        (config_name, declarations),
        (config_name.replace(".toml", ".lock"), archives),
    ):
        with (root / name).open("a") as stream:
            stream.write("\n" + "\n".join(lines) + "\n")


class MiseLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()
        self.output = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.output))

    def test_mise_environment_cannot_be_redirected_from_generation_root(self) -> None:
        root = Path("/tmp/isolated-mise-root")
        redirect_vars = (
            "MISE_CONFIG_DIR",
            "MISE_CONFIG_FILE",
            "MISE_DEFAULT_CONFIG_FILENAME",
            "MISE_ENV",
            "MISE_GLOBAL_CONFIG_FILE",
            "MISE_OVERRIDE_CONFIG_FILENAMES",
            "MISE_SYSTEM_CONFIG_FILE",
            "MISE_TRUSTED_CONFIG_PATHS",
            "MISE_PYTHON_VERSION",
            "MISE_TOOL_CONFIG__LOCKED",
        )
        with patch.dict(os.environ, {}, clear=True):
            for name in redirect_vars:
                os.environ[name] = "unexpected"
            environment = self.module.mise_environment(root)
        self.assertEqual(environment["MISE_TRUSTED_CONFIG_PATHS"], str(root))
        self.assertEqual(environment["MISE_SAFE"], "1")
        self.assertEqual(environment["MISE_YES"], "1")
        self.assertEqual(environment["MISE_CONFIG_DIR"], str(root / ".mise-global"))
        self.assertEqual(environment["MISE_ENV"], "")
        self.assertEqual(
            environment["MISE_GLOBAL_CONFIG_FILE"],
            str(ROOT / "dotfiles/common/mise/config.toml"),
        )
        self.assertEqual(
            environment["MISE_SYSTEM_CONFIG_FILE"],
            str(root / ".empty.toml"),
        )
        for name in (
            "MISE_CONFIG_FILE",
            "MISE_DEFAULT_CONFIG_FILENAME",
            "MISE_OVERRIDE_CONFIG_FILENAMES",
            "MISE_PYTHON_VERSION",
            "MISE_TOOL_CONFIG__LOCKED",
        ):
            with self.subTest(name=name):
                self.assertNotIn(name, environment)

    def test_staged_commands_ignore_workstation_global_tools_and_profile(self) -> None:
        mise = shutil.which("mise")
        self.assertIsNotNone(mise)
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            global_config = home / ".config/mise"
            global_config.mkdir(parents=True)
            (global_config / "config.toml").write_text('[tools]\npython = "1.2.3"\n')
            (global_config / "miserc.toml").write_text('env = ["work-macos"]\n')
            root = home / "stage"
            root.mkdir()
            (root / "mise.toml").write_text('[tools]\nnode = "24.22.0"\n')
            (root / "mise.work-macos.toml").write_text('[tools]\ngo = "1.27.2"\n')
            with patch.dict(os.environ, {"HOME": str(home), "PATH": os.defpath}, clear=True):
                environment = self.module.mise_environment(root)
            shared_settings = ROOT / "dotfiles/common/mise/config.toml"
            for flags, expected in (
                ([], {root / "mise.toml"}),
                (["--env", "work-macos"], {root / "mise.toml", root / "mise.work-macos.toml"}),
            ):
                result = subprocess.run(
                    [mise, *flags, "config", "ls", "--json"],
                    cwd=root, env=environment, capture_output=True, text=True,
                    timeout=10, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(
                    {Path(entry["path"]).resolve() for entry in json.loads(result.stdout)},
                    expected | {shared_settings},
                )
            result = subprocess.run(
                [mise, "settings", "get", "github.credential_command"],
                cwd=root, env=environment, capture_output=True, text=True,
                timeout=10, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                result.stdout.strip(), 'gh auth token --hostname "$MISE_CREDENTIAL_HOST"'
            )

    def test_check_accepts_pinned_artifacts_offline_without_refreshing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            before = {path.name: path.read_bytes() for path in root.iterdir()}
            real_run = subprocess.run
            calls = 0

            def offline_run(command, **kwargs):
                nonlocal calls
                calls += 1
                self.assertIn("--offline", command)
                self.assertNotIn("lock", command)
                self.assertNotIn("upgrade", command)
                return real_run(command, **kwargs)

            self.module.check_lockfiles(root, run_command=offline_run)
            self.assertGreater(calls, 0)
            self.assertEqual(
                {path.name: path.read_bytes() for path in root.iterdir()}, before
            )

    def test_check_rejects_version_backend_and_option_drift_with_context(self) -> None:
        for file, old, new, tool in (
            ("mise.toml", 'python = "3.15.2"', 'python = "3.15.3"', "python"),
            ("mise.lock", 'backend = "core:python"', 'backend = "core:node"', "python"),
            ("mise.toml", '["rustfmt", "clippy"]', '["rustfmt"]', "rust"),
            ("mise.work-macos.lock", 'version = "1.2.3"', 'version = "1.2.4"', "npm:example"),
        ):
            with self.subTest(file=file, new=new), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                write_validation_repository(root)
                path = root / file
                path.write_text(path.read_text().replace(old, new))
                with self.assertRaises(SystemExit) as error:
                    self.module.check_lockfiles(root)
                message = str(error.exception)
                self.assertIn(tool, message)
                self.assertIn("mise", message)
                self.assertIn("refresh", message)

    def test_check_accepts_http_urls_using_the_resolved_version_or_literal_urls(self) -> None:
        for config in ("mise.toml", "mise.work-macos.toml"):
            for literal in (False, True):
                with self.subTest(config=config, literal=literal), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    write_validation_repository(root)
                    add_http_tool(root, config, literal=literal)
                    before = {path.name: path.read_bytes() for path in root.iterdir()}
                    self.module.check_lockfiles(root)
                    self.assertEqual(
                        {path.name: path.read_bytes() for path in root.iterdir()}, before
                    )

    def test_check_requires_scoped_archives_even_on_the_other_os(self) -> None:
        scope = "linux" if os.uname().sysname == "Darwin" else "macos"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            add_http_tool(root, "mise.toml", scope=scope)
            self.module.check_lockfiles(root)
            lock = root / "mise.lock"
            lock.write_text(lock.read_text().replace(
                f'[tools."http:example"."platforms.{scope}-arm64"]',
                f'[tools."http:example"."platforms.{scope}-unknown"]',
            ))
            with self.assertRaisesRegex(SystemExit, f"http:example.*missing {scope}-arm64 archive"):
                self.module.check_lockfiles(root)

    def test_check_resolves_other_os_requests_through_mise_for_versions_and_options(self) -> None:
        scope = "linux" if os.uname().sysname == "Darwin" else "macos"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            config = root / "mise.toml"
            config.write_text(
                config.read_text().replace(
                    'rust = { version = "1.99.1", components = ["rustfmt", "clippy"] }',
                    f'rust = {{ version = "1.99.1", components = ["rustfmt", "clippy"], os = ["{scope}"] }}',
                )
                + '\n[tools."github:example/tool"]\n'
                + 'version = "v0.16.2"\n'
                + f'os = ["{scope}"]\n'
                + 'strip_components = 1\n'
                + 'bin_path = "bin"\n'
            )
            lock = root / "mise.lock"
            archives = "\n".join(
                f'[tools."github:example/tool"."platforms.{scope}-{arch}"]\n'
                f'url = "https://example.invalid/v0.16.2/tool-{scope}-{arch}.tar.gz"\n'
                f'checksum = "sha256:{"a" * 64}"\n'
                for arch in ("x64", "arm64")
            )
            lock.write_text(
                lock.read_text()
                + '\n[[tools."github:example/tool"]]\n'
                + 'version = "0.16.2"\n'
                + 'backend = "github:example/tool"\n'
                + archives
            )
            self.module.check_lockfiles(root)

            original = config.read_text()
            for old, new, tool in (
                ('version = "v0.16.2"', 'version = "v0.16.3"', "github:example/tool"),
                ('components = ["rustfmt", "clippy"]', 'components = ["rustfmt"]', "rust"),
            ):
                with self.subTest(tool=tool):
                    config.write_text(original.replace(old, new))
                    with self.assertRaisesRegex(SystemExit, tool):
                        self.module.check_lockfiles(root)
                    config.write_text(original)

    def test_check_rejects_http_url_drift_in_declarations_or_locks(self) -> None:
        for config in ("mise.toml", "mise.work-macos.toml"):
            lock = config.replace(".toml", ".lock")
            for name in (config, lock):
                for platform in ("linux-arm64", "macos-x64"):
                    with self.subTest(name=name, platform=platform), tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        write_validation_repository(root)
                        add_http_tool(root, config)
                        path = root / name
                        path.write_text(path.read_text().replace(
                            f"https://example.invalid/{platform}/",
                            f"https://changed.invalid/{platform}/",
                        ))
                        with self.assertRaises(SystemExit) as error:
                            self.module.check_lockfiles(root)
                        for context in (config, lock, "http:example", platform, "url", "refresh"):
                            self.assertIn(context, str(error.exception))

    def test_check_validates_http_default_url_with_platform_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            add_http_tool(root, "mise.toml")
            config = root / "mise.toml"
            content = config.read_text().replace(
                'version = "1.2"',
                'version = "1.2"\nurl = "https://example.invalid/all/{{version}}.tar.gz"',
            )
            content = content.split('[tools."http:example".platforms.macos-arm64]')[0]
            config.write_text(content)
            lock = root / "mise.lock"
            lock.write_text(lock.read_text().replace(
                "https://example.invalid/macos-arm64/1.2.3.tar.gz",
                "https://example.invalid/all/1.2.3.tar.gz",
            ))
            self.module.check_lockfiles(root)
            config.write_text(content.replace("example.invalid/all/", "changed.invalid/all/"))
            with self.assertRaisesRegex(SystemExit, "macos-arm64: url"):
                self.module.check_lockfiles(root)

    def test_check_fails_closed_on_unsupported_http_url_templates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            add_http_tool(root, "mise.toml")
            config = root / "mise.toml"
            config.write_text(config.read_text().replace("{{ version }}", "{{ version | upper }}"))
            with self.assertRaisesRegex(SystemExit, "http:example.*supports only literal URLs"):
                self.module.check_lockfiles(root)

    def test_check_requires_the_private_python_runtime_in_profile_locks(self) -> None:
        for array_form in (False, True):
            with self.subTest(array_form=array_form), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                write_validation_repository(root)
                if array_form:
                    config = root / "mise.work-macos.toml"
                    specification = '{ version = "1.0.0", python = "3.13" }'
                    config.write_text(config.read_text().replace(
                        specification, f"[{specification}]",
                    ))
                self.module.check_lockfiles(root)
                path = root / "mise.work-macos.lock"
                path.write_text(path.read_text().split('[[tools.python]]')[0])
                with self.assertRaises(SystemExit) as error:
                    self.module.check_lockfiles(root)
                self.assertIn("python", str(error.exception))
                self.assertIn("3.13", str(error.exception))

    def test_check_requires_all_supported_archive_platforms_and_checksums(self) -> None:
        for platform in ("linux-x64", "linux-arm64", "macos-x64", "macos-arm64"):
            for field in ("platform", "url", "checksum"):
                with self.subTest(platform=platform, field=field), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    write_validation_repository(root)
                    path = root / "mise.lock"
                    content = path.read_text()
                    header = f'[tools.python."platforms.{platform}"]'
                    if field == "platform":
                        content = content.replace(header, header.replace(platform, "unsupported"))
                    else:
                        start = content.index(header)
                        prefix, rest = content[:start], content[start:]
                        rest = rest.replace(f'{field} = "', f'ignored_{field} = "', 1)
                        content = prefix + rest
                    path.write_text(content)
                    with self.assertRaises(SystemExit) as error:
                        self.module.check_lockfiles(root)
                    self.assertIn("mise.lock", str(error.exception))
                    self.assertIn(platform, str(error.exception))

    def test_check_rejects_invalid_archive_integrity_metadata(self) -> None:
        for old, new, field in (
            ("sha256:" + "a" * 64, "sha256:invalid", "checksum"),
            ("https://example.invalid", "http://example.invalid", "url"),
            ('provenance = "github-attestations"', 'provenance = false', "provenance"),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                write_validation_repository(root)
                path = root / "mise.lock"
                path.write_text(path.read_text().replace(old, new))
                with self.assertRaises(SystemExit) as error:
                    self.module.check_lockfiles(root)
                self.assertIn(field, str(error.exception))

    def test_unavailable_archive_exemption_does_not_allow_invalid_present_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            atuin_archives = "\n".join(
                f'[tools."aqua:atuinsh/atuin"."platforms.{platform}"]\n'
                f'url = "https://example.invalid/atuin-{platform}.tar.gz"\n'
                f'checksum = "sha256:{"a" * 64}"\n'
                for platform in ("linux-x64", "linux-arm64", "macos-arm64")
            )
            with (root / "mise.toml").open("a") as stream:
                stream.write('\n"aqua:atuinsh/atuin" = "18.10.0"\n')
            with (root / "mise.lock").open("a") as stream:
                stream.write(
                    '\n[[tools."aqua:atuinsh/atuin"]]\n'
                    'version = "18.10.0"\nbackend = "aqua:atuinsh/atuin"\n'
                    + atuin_archives
                )
            self.module.check_lockfiles(root)
            with (root / "mise.lock").open("a") as stream:
                stream.write(
                    '\n[tools."aqua:atuinsh/atuin"."platforms.macos-x64"]\n'
                    'url = "https://example.invalid/atuin-macos-x64.tar.gz"\n'
                    'checksum = "invalid"\n'
                )
            with self.assertRaises(SystemExit) as error:
                self.module.check_lockfiles(root)
            self.assertIn("checksum", str(error.exception))

    def test_check_reports_missing_or_malformed_input_file(self) -> None:
        for name in ("mise.work-macos.lock", "mise.personal-macos.toml"):
            for content in (None, 'tools = ['):
                with self.subTest(name=name, content=content), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    write_validation_repository(root)
                    path = root / name
                    if content is None:
                        path.unlink()
                    else:
                        path.write_text(content)
                    with self.assertRaises(SystemExit) as error:
                        self.module.check_lockfiles(root)
                    self.assertIn(name, str(error.exception))

    def test_check_ignores_workstation_tool_and_locking_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            with patch.dict(os.environ, {
                "MISE_PYTHON_VERSION": "1.2.3",
                "MISE_ENV": "work-macos",
                "MISE_TOOL_CONFIG__LOCKED": "false",
                "MISE_GLOBAL_CONFIG_FILE": str(root / "missing-global.toml"),
            }):
                self.module.check_lockfiles(root)

    def test_refresh_explicitly_publishes_new_archive_builds(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_validation_repository(root)
            expected_shared = (root / "mise.lock").read_bytes().replace(
                b"20261026", b"20261110"
            )

            def fake_run(command, **kwargs) -> subprocess.CompletedProcess[str]:
                stage = Path(kwargs["cwd"])
                for name in self.module.LOCK_FILES:
                    path = stage / name
                    if path.exists():
                        path.write_bytes(
                            path.read_bytes().replace(b"20261026", b"20261110")
                        )
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

            self.module.refresh_lockfiles(root, run_command=fake_run)
            self.assertEqual((root / "mise.lock").read_bytes(), expected_shared)
            self.module.check_lockfiles(root)

    def test_plan_changes_is_deterministic_and_handles_missing_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "mise.lock").write_bytes(b"same")
            (root / "mise.personal-macos.lock").write_bytes(b"old")
            candidates = {
                "mise.lock": b"same",
                "mise.personal-macos.lock": b"new",
                "mise.work-macos.lock": b"new",
            }
            self.assertEqual(
                self.module.plan_changes(root, candidates, self.module.LOCK_FILES),
                ("mise.personal-macos.lock", "mise.work-macos.lock"),
            )

    def test_profile_results_must_agree_on_shared_lock(self) -> None:
        agreeing = {
            "personal-macos": {
                "mise.lock": VALID_LOCK,
                "mise.personal-macos.lock": b"[tools.personal]\n",
            },
            "work-macos": {
                "mise.lock": VALID_LOCK,
                "mise.work-macos.lock": b"[tools.work]\n",
            },
        }
        merged = self.module.merge_profile_lockfiles(agreeing)
        self.assertEqual(tuple(merged), self.module.LOCK_FILES)

        disagreeing = {
            **agreeing,
            "work-macos": {
                **agreeing["work-macos"],
                "mise.lock": b"[tools.different]\n",
            },
        }
        with self.assertRaisesRegex(RuntimeError, "personal-macos and work-macos"):
            self.module.merge_profile_lockfiles(disagreeing)

    def test_profile_generation_uses_an_isolated_unlocked_copy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_minimal_repository(root)
            source_before = (root / "mise.toml").read_bytes()
            observed_roots: list[Path] = []

            def fake_run(command, **kwargs) -> subprocess.CompletedProcess[str]:
                generation_root = Path(kwargs["cwd"])
                observed_roots.append(generation_root)
                self.assertNotEqual(generation_root, root)
                self.assertIn(
                    self.module.UNLOCKED_CONFIG,
                    (generation_root / "mise.toml").read_text(),
                )
                self.assertEqual(
                    tuple(command[3:]),
                    (
                        "--env",
                        "personal-macos",
                        "lock",
                        "--quiet",
                        "--platform",
                        self.module.PLATFORMS,
                    ),
                )
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

            generated = self.module.generate_profile_lockfiles(
                root, "personal-macos", run_command=fake_run
            )
            self.assertEqual(generated["mise.lock"], VALID_LOCK)
            self.assertEqual(len(observed_roots), 1)
            self.assertFalse(observed_roots[0].exists())
            self.assertEqual((root / "mise.toml").read_bytes(), source_before)

    def test_refresh_validates_all_candidates_before_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_minimal_repository(root)
            before = {
                name: (root / name).read_bytes()
                for name in (*self.module.CONFIG_FILES, *self.module.LOCK_FILES)
            }

            def invalid_toml_run(command, **kwargs) -> subprocess.CompletedProcess[str]:
                stage = Path(kwargs["cwd"])
                personal_lock = stage / "mise.personal-macos.lock"
                if personal_lock.exists():
                    personal_lock.write_bytes(b"not toml = [")
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

            with self.assertRaisesRegex(RuntimeError, "not valid TOML"):
                self.module.refresh_lockfiles(root, run_command=invalid_toml_run)
            after = {name: (root / name).read_bytes() for name in before}
            self.assertEqual(after, before)

    def test_publication_replaces_only_changed_complete_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_minimal_repository(root)
            changed_content = b"[tools.changed]\n"
            candidates = {
                "mise.lock": VALID_LOCK,
                "mise.personal-macos.lock": changed_content,
                "mise.work-macos.lock": VALID_LOCK,
            }
            replacements: list[str] = []

            def record_replace(path: Path, content: bytes) -> None:
                replacements.append(path.name)
                path.write_bytes(content)

            self.module.atomic_replace = record_replace
            changed = self.module.publish_candidates(
                root, candidates, self.module.LOCK_FILES
            )
            self.assertEqual(changed, ("mise.personal-macos.lock",))
            self.assertEqual(replacements, ["mise.personal-macos.lock"])
            self.assertEqual(
                (root / "mise.personal-macos.lock").read_bytes(), changed_content
            )

    def test_failed_update_never_unlocks_the_tracked_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_minimal_repository(root)
            before = {
                name: (root / name).read_bytes() for name in self.module.CONFIG_FILES
            }

            def fail_run(_command, **_kwargs) -> subprocess.CompletedProcess[str]:
                raise RuntimeError("simulated interruption")

            with self.assertRaisesRegex(RuntimeError, "simulated interruption"):
                self.module.update_unsupported_tools(root, run_command=fail_run)
            after = {
                name: (root / name).read_bytes() for name in self.module.CONFIG_FILES
            }
            self.assertEqual(after, before)
            self.assertIn(
                self.module.LOCKED_CONFIG,
                (root / "mise.toml").read_text(),
            )

    def test_check_lockfiles_rejects_mise_resolution_warnings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_minimal_repository(root)

            def warn_run(command, **_kwargs) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="{}",
                    stderr="WARN Failed to resolve aqua:example@1.0.0\n",
                )

            with self.assertRaisesRegex(SystemExit, "Failed to resolve"):
                self.module.check_lockfiles(root, run_command=warn_run)


if __name__ == "__main__":
    unittest.main()
