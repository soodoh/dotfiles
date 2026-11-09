import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).with_name("twg-skills.py")
spec = importlib.util.spec_from_file_location("twg_skills", SOURCE)
twg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(twg)


class TwgSkillsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "mise.work-macos.toml").write_text(
            '[tools."http:twg"]\nversion = "9.1.0"\n'
        )
        self.agents = self.root / "dotfiles/work/agents"
        self.catalog = self.agents / "skills"
        self.catalog.mkdir(parents=True)
        self.skill(self.catalog, "twg-retired", "Previous bundled skill")
        self.skill(self.catalog, "jira", "Unrelated skill")
        self.binary = self.root / "twg"
        self.configuration = self.root / "export.json"
        self.configure()
        self.binary.write_text(
            f"#!{sys.executable}\n"
            + """
import json, os, pathlib, sys
root = pathlib.Path(__file__).parent
config = json.loads((root / "export.json").read_text())
assert "TWG_TOKEN" not in os.environ
assert "HTTPS_PROXY" not in os.environ
assert pathlib.Path.home() != root
args = sys.argv[1:]
with (root / "calls").open("a") as calls:
    calls.write(json.dumps(args) + "\\n")
if args == ["--version"]:
    print(config["version"])
else:
    assert args == ["skills", "install", "--local", "--yes", "--no-prune"]
    for name in config["names"]:
        folder = pathlib.Path(".agents/skills") / name
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text("---\\nname: " + name + "\\ndescription: Test fixture\\n---\\n")
        (folder / ".twg-install.json").write_text(json.dumps({
            "installedVersion": config.get("metadataVersion", config["version"]),
            "installedAt": "volatile timestamp",
            "binaryPath": str(root / "twg"),
        }))
        if config.get("malformed"):
            (folder / "SKILL.md").write_text("name: " + name)
        if config.get("symlink"):
            (folder / "outside").symlink_to(root / "export.json")
        else:
            (folder / "references").mkdir()
            (folder / "references/guide.md").write_text("Version-matched reference\\n")
    if config.get("fail"):
        raise SystemExit(23)
"""
        )
        self.binary.chmod(0o755)

    def configure(self, **changes):
        self.configuration.write_text(
            json.dumps({"version": "9.1.0", "names": ["twg", "twg-example"], **changes})
        )

    def skill(self, parent, name, content):
        directory = parent / name
        directory.mkdir(parents=True)
        (directory / "SKILL.md").write_text(content)

    def contents(self):
        return {
            str(path.relative_to(self.agents)): path.read_bytes()
            for path in self.agents.rglob("*")
            if path.is_file()
        }

    def test_refresh_replaces_owned_skills_and_keeps_unrelated_catalog_entries(self):
        self.assertTrue(twg.refresh(self.root, str(self.binary)))
        self.assertFalse((self.catalog / "twg-retired").exists())
        self.assertEqual(
            (self.catalog / "jira/SKILL.md").read_text(), "Unrelated skill"
        )
        self.assertEqual(
            (self.catalog / "twg/references/guide.md").read_text(),
            "Version-matched reference\n",
        )
        self.assertEqual(list(self.catalog.rglob(".twg-install.json")), [])
        recorded = json.loads((self.agents / twg.PROVENANCE).read_text())
        self.assertEqual(recorded["version"], "9.1.0")
        self.assertNotIn(str(self.root), json.dumps(recorded))
        twg.check(self.root)

    def test_same_version_is_a_noop_and_fresh_exports_are_reproducible(self):
        twg.refresh(self.root, str(self.binary))
        initial = self.contents()
        calls = (self.root / "calls").read_text()
        self.assertFalse(twg.refresh(self.root, str(self.binary)))
        self.assertEqual((self.root / "calls").read_text(), calls)
        (self.agents / twg.PROVENANCE).unlink()
        twg.refresh(self.root, str(self.binary))
        self.assertEqual(self.contents(), initial)

    def test_failed_or_incomplete_exports_leave_existing_snapshot_untouched(self):
        for config in (
            {"fail": True},
            {"names": ["twg-example"]},
            {"symlink": True},
            {"malformed": True},
            {"metadataVersion": "8.0.0"},
        ):
            with self.subTest(config=config):
                self.configure(**config)
                initial = self.contents()
                with self.assertRaises((ValueError, twg.subprocess.CalledProcessError)):
                    twg.refresh(self.root, str(self.binary))
                self.assertEqual(self.contents(), initial)

    def test_copy_failure_preserves_the_existing_snapshot(self):
        initial = self.contents()
        with (
            patch.object(twg.shutil, "copytree", side_effect=OSError("copy failed")),
            self.assertRaisesRegex(OSError, "copy failed"),
        ):
            twg.refresh(self.root, str(self.binary))
        self.assertEqual(self.contents(), initial)

    def test_manifest_publication_failure_restores_existing_skills(self):
        twg.refresh(self.root, str(self.binary))
        initial = self.contents()
        (self.root / "mise.work-macos.toml").write_text(
            '[tools."http:twg"]\nversion = "9.2.0"\n'
        )
        self.configure(version="9.2.0", names=["twg", "twg-replacement"])
        with (
            patch.object(Path, "replace", side_effect=OSError("rename failed")),
            self.assertRaisesRegex(OSError, "rename failed"),
        ):
            twg.refresh(self.root, str(self.binary))
        self.assertEqual(self.contents(), initial)

    def test_wrong_binary_version_fails_before_export(self):
        self.configure(version="9.2.0")
        initial = self.contents()
        with self.assertRaisesRegex(ValueError, "version mismatch"):
            twg.refresh(self.root, str(self.binary))
        self.assertEqual((self.root / "calls").read_text(), '["--version"]\n')
        self.assertEqual(self.contents(), initial)

    def test_checker_detects_version_and_content_drift_without_running_cli(self):
        twg.refresh(self.root, str(self.binary))
        (self.root / "mise.work-macos.toml").write_text(
            '[tools."http:twg"]\nversion = "9.2.0"\n'
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            twg.check(self.root)
        (self.root / "mise.work-macos.toml").write_text(
            '[tools."http:twg"]\nversion = "9.1.0"\n'
        )
        (self.catalog / "twg/references/guide.md").write_text("Unexpected edit")
        with self.assertRaisesRegex(ValueError, "does not match"):
            twg.check(self.root)

    def test_cli_pin_changes_regenerate_the_corresponding_snapshot(self):
        twg.refresh(self.root, str(self.binary))
        (self.root / "mise.work-macos.toml").write_text(
            '[tools."http:twg"]\nversion = "9.2.0"\n'
        )
        self.configure(version="9.2.0", names=["twg", "twg-new"])
        self.assertTrue(twg.refresh(self.root, str(self.binary)))
        recorded = json.loads((self.agents / twg.PROVENANCE).read_text())
        self.assertEqual(recorded["version"], "9.2.0")
        self.assertEqual(recorded["skills"], ["twg", "twg-new"])
        self.assertFalse((self.catalog / "twg-example").exists())
        twg.check(self.root)

    def test_export_does_not_inherit_workstation_credentials_or_proxies(self):
        with patch.dict(
            os.environ,
            {"TWG_TOKEN": "fixture-secret", "HTTPS_PROXY": "http://fixture.invalid"},
        ):
            twg.refresh(self.root, str(self.binary))
        twg.check(self.root)


if __name__ == "__main__":
    unittest.main()
