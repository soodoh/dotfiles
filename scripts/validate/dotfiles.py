#!/usr/bin/env python3
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIGS = [ROOT / "mise.toml", ROOT / "mise.personal-macos.toml", ROOT / "mise.work-macos.toml"]

for config in CONFIGS:
    with config.open("rb") as handle:
        data = tomllib.load(handle)
    for target, value in data.get("dotfiles", {}).items():
        source = value if isinstance(value, str) else value.get("source")
        if source and not (ROOT / source).exists():
            raise SystemExit(f"{config.name}: source for {target} is missing: {source}")

with (ROOT / "mise.personal-macos.toml").open("rb") as handle:
    personal = tomllib.load(handle)["dotfiles"]
personal_skills = {target.rsplit("/", 1)[-1] for target in personal if target.startswith("~/.agents/skills/")}
expected = {
    "find-skills", "grill-me", "obsidian-cli", "playwright-cli", "skill-creator",
    "thermo-nuclear-code-quality-review", "vercel-react-best-practices",
}
if personal_skills != expected:
    raise SystemExit(f"personal skill subset differs: {sorted(personal_skills)}")
shared_lock = json.loads((ROOT / "dotfiles/profiles/common/.agents/.skill-lock.json").read_text())
personal_lock = json.loads((ROOT / "dotfiles/profiles/personal/.agents/.skill-lock.json").read_text())
expected_lock = dict(shared_lock)
expected_lock["skills"] = {name: data for name, data in shared_lock["skills"].items() if name in expected}
if personal_lock != expected_lock:
    raise SystemExit("personal skill lock is not the exact filtered shared lock")

with (ROOT / "mise.work-macos.toml").open("rb") as handle:
    work = tomllib.load(handle)["dotfiles"]
if work.get("~/.agents/skills") != "dotfiles/profiles/common/.agents/skills":
    raise SystemExit("work profile must link the complete skill catalog")

for profile in ("personal", "work"):
    prefix = ROOT / "dotfiles" / "profiles" / profile
    required = {
        "~/.pi/agent/settings.json": prefix / ".pi/agent/settings.json",
        "~/.pi/agent/mcp.json": prefix / ".pi/agent/mcp.json",
        "~/.pi/agent/models.json": prefix / ".pi/agent/models.json",
        "~/.pi/agent/extensions/pi-openai-fast.json": prefix / ".pi/agent/extensions/pi-openai-fast.json",
        "~/.pi/workflows/model-tiers.json": prefix / ".pi/workflows/model-tiers.json",
    }
    config_path = ROOT / f"mise.{profile}-macos.toml"
    with config_path.open("rb") as handle:
        entries = tomllib.load(handle)["dotfiles"]
    for target, source in required.items():
        if entries.get(target) != str(source.relative_to(ROOT)):
            raise SystemExit(f"{config_path.name}: incorrect overlay for {target}")

with (ROOT / "mise.toml").open("rb") as handle:
    shared = tomllib.load(handle)["dotfiles"]
if shared.get("~/.pi/agent/pi-extensions") != "pi-extensions":
    raise SystemExit("Pi extensions must point directly into the checkout")
