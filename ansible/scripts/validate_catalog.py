#!/usr/bin/env python3
"""Validate logical tool catalog mappings for a profile/platform pair."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import yaml

ALLOWED_MANAGERS = {
    "apt",
    "brew_cask",
    "brew_formula",
    "bun",
    "cargo",
    "go",
    "npm",
    "pacman",
    "script",
    "uv",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True)
    parser.add_argument("--profile", required=True)
    args = parser.parse_args()

    catalog_path = Path(__file__).resolve().parents[1] / "vars" / "catalog.yml"
    data = yaml.safe_load(catalog_path.read_text())
    errors: list[str] = []

    if args.platform not in data["supported_platforms"]:
        errors.append(f"unsupported platform: {args.platform}")
    if args.profile not in data["supported_profiles"]:
        errors.append(f"unsupported profile: {args.profile}")
    if args.profile == "work" and args.platform != "macos":
        errors.append("work profile is supported only on macOS")

    selected = (
        data["shared_tools"]
        + data["platform_tools"].get(args.platform, [])
        + data["personal_tools"]
        + (data["work_tools"] if args.profile == "work" else [])
    )
    duplicates = sorted({tool for tool in selected if selected.count(tool) > 1})
    if duplicates:
        errors.append(f"duplicate selected tools: {', '.join(duplicates)}")

    for tool in selected:
        definition = data["tool_catalog"].get(tool)
        if definition is None:
            errors.append(f"missing catalog entry: {tool}")
            continue
        specification = definition.get("platforms", {}).get(args.platform)
        if specification is None:
            errors.append(f"missing {args.platform} mapping: {tool}")
            continue
        manager = specification.get("manager")
        if manager not in ALLOWED_MANAGERS:
            errors.append(f"invalid manager for {tool}: {manager}")
        if not specification.get("name"):
            errors.append(f"missing package name for {tool}/{args.platform}")

    app_bundle_ids = [
        app["bundle_id"] for app in data["platform_applications"].get(args.platform, [])
    ]
    if len(app_bundle_ids) != len(set(app_bundle_ids)):
        errors.append(f"duplicate application bundle IDs for {args.platform}")

    if errors:
        print("Catalog validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Catalog valid: {args.profile}/{args.platform} ({len(selected)} logical tools)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
