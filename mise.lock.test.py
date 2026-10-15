import importlib.util
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


class MiseLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_mise_environment_cannot_be_redirected_from_generation_root(self) -> None:
        root = Path("/tmp/isolated-mise-root")
        with patch.dict(os.environ, {}, clear=True):
            for name in self.module.MISE_CONFIG_ENVIRONMENT:
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
        for name in self.module.MISE_CONFIG_ENVIRONMENT - {
            "MISE_TRUSTED_CONFIG_PATHS", "MISE_CONFIG_DIR", "MISE_ENV",
            "MISE_GLOBAL_CONFIG_FILE"
        }:
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

            def fake_run_mise(generation_root: Path, *arguments: str) -> None:
                observed_roots.append(generation_root)
                self.assertNotEqual(generation_root, root)
                self.assertIn(
                    self.module.UNLOCKED_CONFIG,
                    (generation_root / "mise.toml").read_text(),
                )
                self.assertEqual(
                    arguments,
                    (
                        "--env",
                        "personal-macos",
                        "lock",
                        "--quiet",
                        "--platform",
                        self.module.PLATFORMS,
                    ),
                )

            self.module.run_mise = fake_run_mise
            generated = self.module.generate_profile_lockfiles(root, "personal-macos")
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
            candidates = {
                "mise.lock": VALID_LOCK,
                "mise.personal-macos.lock": b"not toml = [",
                "mise.work-macos.lock": VALID_LOCK,
            }
            self.module.generate_lockfiles = lambda _root: candidates
            with self.assertRaisesRegex(RuntimeError, "not valid TOML"):
                self.module.refresh_lockfiles(root)
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

            def fail_run_mise(_root: Path, *_arguments: str) -> None:
                raise RuntimeError("simulated interruption")

            self.module.run_mise = fail_run_mise
            with self.assertRaisesRegex(RuntimeError, "simulated interruption"):
                self.module.update_unsupported_tools(root)
            after = {
                name: (root / name).read_bytes() for name in self.module.CONFIG_FILES
            }
            self.assertEqual(after, before)
            self.assertIn(
                self.module.LOCKED_CONFIG,
                (root / "mise.toml").read_text(),
            )


if __name__ == "__main__":
    unittest.main()
