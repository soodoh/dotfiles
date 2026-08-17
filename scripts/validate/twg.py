#!/usr/bin/env python3
import hashlib
import os
import tempfile
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
with (ROOT / "mise.work-macos.toml").open("rb") as handle:
    config = tomllib.load(handle)
with (ROOT / "mise.work-macos.lock").open("rb") as handle:
    lock = tomllib.load(handle)

tool = config["tools"]["http:twg"]
entries = lock["tools"]["http:twg"]
if len(entries) != 1 or entries[0]["version"] != tool["version"]:
    raise SystemExit("TWG lock version does not match config")
for platform, metadata in tool["platforms"].items():
    url = metadata["url"]
    checksum = metadata["checksum"]
    if f"v{tool['version']}" not in url or not checksum.startswith("sha256:") or len(checksum) != 71:
        raise SystemExit(f"invalid TWG metadata for {platform}")
    locked = entries[0].get(f"platforms.{platform}")
    if not locked or locked.get("url") != url or locked.get("checksum") != checksum:
        raise SystemExit(f"TWG lock mismatch for {platform}")
    if os.environ.get("VALIDATE_TWG_DOWNLOADS") == "1":
        with urllib.request.urlopen(url, timeout=60) as response:
            digest = hashlib.sha256(response.read()).hexdigest()
        if digest != checksum.removeprefix("sha256:"):
            raise SystemExit(f"TWG checksum mismatch for {platform}")
