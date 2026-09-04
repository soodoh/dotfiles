#!/usr/bin/env python3
import unittest
from pathlib import Path

import tomllib


class ColimaLaunchAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with (Path(__file__).parents[3] / "mise.toml").open("rb") as config_file:
            mise_config = tomllib.load(config_file)
        cls.agent = mise_config["bootstrap"]["macos"]["launchd"]["agents"][
            "colima-default"
        ]

    def test_launches_default_profile_through_mise(self) -> None:
        self.assertEqual(self.agent["program"], "~/.local/bin/mise")
        self.assertEqual(
            self.agent["args"],
            [
                "exec",
                "--",
                "/opt/homebrew/bin/colima",
                "start",
                "--foreground",
                "--profile",
                "default",
            ],
        )
        self.assertTrue(self.agent["run_at_load"])

    def test_uses_repository_working_directory_and_separate_logs(self) -> None:
        self.assertEqual(self.agent["working_directory"], "~/Projects/dotfiles")
        self.assertEqual(self.agent["stdout_path"], "~/Library/Logs/colima-default.log")
        self.assertEqual(
            self.agent["stderr_path"], "~/Library/Logs/colima-default.error.log"
        )


if __name__ == "__main__":
    unittest.main()
