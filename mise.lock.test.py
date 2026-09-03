import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from types import ModuleType

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
        original = os.environ.copy()
        try:
            for name in self.module.MISE_CONFIG_ENVIRONMENT:
                os.environ[name] = "unexpected"
            environment = self.module.mise_environment(root)
        finally:
            os.environ.clear()
            os.environ.update(original)
        self.assertEqual(environment["MISE_TRUSTED_CONFIG_PATHS"], str(root))
        self.assertEqual(environment["MISE_SAFE"], "1")
        self.assertEqual(environment["MISE_YES"], "1")
        for name in self.module.MISE_CONFIG_ENVIRONMENT - {"MISE_TRUSTED_CONFIG_PATHS"}:
            with self.subTest(name=name):
                self.assertNotIn(name, environment)

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
