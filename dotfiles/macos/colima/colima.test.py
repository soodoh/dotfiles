#!/usr/bin/env python3
from pathlib import Path

config = (Path(__file__).with_name("colima.yaml")).read_text()
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
    assert expected in config, expected
