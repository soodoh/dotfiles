#!/usr/bin/env python3
import tomllib
from pathlib import Path

colima_config = (Path(__file__).with_name("colima.yaml")).read_text()
for expected in (
    "cpu: 4",
    "memory: 8",
    "disk: 100",
    "arch: aarch64",
    "runtime: docker",
    "vmType: vz",
    "rosetta: true",
    "mountType: virtiofs",
    "mountInotify: true",
):
    assert expected in colima_config, expected

with (Path(__file__).parents[3] / "mise.toml").open("rb") as config_file:
    mise_config = tomllib.load(config_file)

colima_agent = mise_config["bootstrap"]["macos"]["launchd"]["agents"]["colima-default"]
assert colima_agent == {
    "program": "~/.local/bin/mise",
    "args": [
        "exec",
        "--",
        "/opt/homebrew/bin/colima",
        "start",
        "--foreground",
        "--profile",
        "default",
    ],
    "run_at_load": True,
    "working_directory": "~/Projects/dotfiles",
    "stdout_path": "~/Library/Logs/colima-default.log",
    "stderr_path": "~/Library/Logs/colima-default.error.log",
}
