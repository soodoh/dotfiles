from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "audit.py"
SPEC = importlib.util.spec_from_file_location("environment_audit", MODULE_PATH)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class AuditParsingTests(unittest.TestCase):
    def test_bun_scoped_packages(self) -> None:
        output = """/tmp/node_modules (2)
├── @earendil-works/pi-coding-agent@0.84.0
└── ctx7@0.4.1
"""
        with patch.object(AUDIT, "run", return_value=output):
            self.assertEqual(
                AUDIT.bun_globals(),
                ["@earendil-works/pi-coding-agent", "ctx7"],
            )

    def test_cargo_package_names(self) -> None:
        output = """atuin v18.9.0:
    atuin
starship v1.24.0:
    starship
"""
        with patch.object(AUDIT, "run", return_value=output):
            self.assertEqual(AUDIT.cargo_globals(), ["atuin", "starship"])

    def test_lines_are_unique_and_sorted(self) -> None:
        self.assertEqual(AUDIT.lines("z\na\nz\n"), ["a", "z"])

    def test_brew_leaves_are_normalized_to_tokens(self) -> None:
        outputs = [
            "felixkratz/formulae/borders\nfish\n",
            "borders\nfish\n",
            "aerospace\n",
            "felixkratz/formulae\n",
        ]
        with patch.object(AUDIT, "run", side_effect=outputs):
            explicit, all_formulae, casks, taps = AUDIT.brew_state()
        self.assertEqual(explicit, ["borders", "fish"])
        self.assertEqual(all_formulae, ["borders", "fish"])
        self.assertEqual(casks, ["aerospace"])
        self.assertEqual(taps, ["felixkratz/formulae"])

    def test_homebrew_ownership_wins_over_stale_app_store_metadata(self) -> None:
        app = Path("/Applications/Slack.app")
        with (
            patch.object(AUDIT, "app_bundle_paths", return_value=[app]),
            patch.object(AUDIT, "plist_metadata", return_value=("com.tinyspeck.slackmacgap", "Slack")),
            patch.object(AUDIT, "cask_app_map", return_value={"Slack.app": "slack"}),
            patch.object(AUDIT, "app_store_id", return_value="803453959"),
        ):
            records, store_ids = AUDIT.applications(["slack"], [])
        self.assertEqual(records[0]["source"], "brew_cask")
        self.assertNotIn("store_id", records[0])
        self.assertEqual(store_ids, [])


if __name__ == "__main__":
    unittest.main()
