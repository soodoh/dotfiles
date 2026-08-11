#!/usr/bin/env python3
"""Report drift between a resolved desired state and explicitly installed tools."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
from typing import Any

MANAGERS = (
    "brew_formula",
    "brew_cask",
    "brew_tap",
    "apt",
    "pacman",
    "bun",
    "npm",
    "cargo",
    "go",
    "uv",
    "mas",
)


def run(*args: str) -> str | None:
    if shutil.which(args[0]) is None:
        return None
    result = subprocess.run(args, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def lines(output: str | None) -> list[str]:
    return sorted({line.strip() for line in (output or "").splitlines() if line.strip()})


def brew_state() -> tuple[list[str], list[str], list[str], list[str]]:
    explicit = sorted({name.rsplit("/", 1)[-1] for name in lines(run("brew", "leaves"))})
    all_formulae = lines(run("brew", "list", "--formula"))
    casks = lines(run("brew", "list", "--cask"))
    taps = lines(run("brew", "tap"))
    return explicit, all_formulae, casks, taps


def bun_globals() -> list[str]:
    output = run("bun", "pm", "ls", "-g") or ""
    packages: list[str] = []
    for line in output.splitlines():
        match = re.search(r"(?:├──|└──)\s+(.+?)@[^@\s]+$", line.strip())
        if match:
            packages.append(match.group(1))
    return sorted(set(packages))


def npm_globals() -> list[str]:
    output = run("npm", "ls", "-g", "--depth=0", "--json")
    if not output:
        return []
    try:
        return sorted(json.loads(output).get("dependencies", {}).keys())
    except json.JSONDecodeError:
        return []


def cargo_globals() -> list[str]:
    output = run("cargo", "install", "--list") or ""
    return sorted(
        {
            match.group(1)
            for line in output.splitlines()
            if (match := re.match(r"^([^\s]+)\s+v[^:]+:$", line))
        }
    )


def uv_tools() -> list[str]:
    output = run("uv", "tool", "list") or ""
    return sorted(
        {
            match.group(1)
            for line in output.splitlines()
            if (match := re.match(r"^([^\s-][^\s]*)\s+v\S+$", line))
        }
    )


def go_tools() -> list[str]:
    go = shutil.which("go")
    if not go:
        return []
    go_path = run(go, "env", "GOPATH")
    if not go_path:
        return []
    bin_dir = Path(go_path.split(os.pathsep)[0]) / "bin"
    modules: set[str] = set()
    if not bin_dir.is_dir():
        return []
    for binary in bin_dir.iterdir():
        if not binary.is_file() or not os.access(binary, os.X_OK):
            continue
        metadata = run(go, "version", "-m", str(binary)) or ""
        for line in metadata.splitlines():
            fields = line.strip().split()
            if fields and fields[0] == "mod" and len(fields) > 1:
                modules.add(fields[1])
                break
    return sorted(modules)


def app_bundle_paths() -> list[Path]:
    roots = (Path("/Applications"), Path.home() / "Applications")
    bundles: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        for current, directories, _files in os.walk(root):
            current_path = Path(current)
            depth = len(current_path.relative_to(root).parts)
            if current_path.suffix == ".app":
                bundles.append(current_path)
                directories[:] = []
                continue
            if depth >= 3:
                directories[:] = []
    return sorted(set(bundles))


def plist_metadata(app: Path) -> tuple[str | None, str | None]:
    plist_path = app / "Contents" / "Info.plist"
    if not plist_path.is_file():
        return None, None
    try:
        with plist_path.open("rb") as plist_file:
            data = plistlib.load(plist_file)
        bundle_id = data.get("CFBundleIdentifier")
        display_name = data.get("CFBundleDisplayName") or data.get("CFBundleName")
        return bundle_id, display_name
    except (OSError, plistlib.InvalidFileException):
        return None, None


def cask_app_map(casks: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for installed_token in casks:
        output = run("brew", "info", "--cask", "--json=v2", installed_token)
        if not output:
            continue
        try:
            payload = json.loads(output)
        except json.JSONDecodeError:
            continue
        for cask in payload.get("casks", []):
            token = cask.get("token")
            for artifact in cask.get("artifacts", []):
                app_artifact = artifact.get("app") if isinstance(artifact, dict) else None
                if token and isinstance(app_artifact, list):
                    for name in app_artifact:
                        if isinstance(name, str):
                            result[Path(name).name] = token
    return result


def app_store_id(app: Path) -> str | None:
    output = run("mdls", "-name", "kMDItemAppStoreAdamID", "-raw", str(app))
    if output and output not in {"(null)", "null"}:
        return output
    return None


def applications(casks: list[str], protected_prefixes: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    cask_map = cask_app_map(casks)
    records: list[dict[str, Any]] = []
    removable_store_ids: list[str] = []
    for app in app_bundle_paths():
        bundle_id, display_name = plist_metadata(app)
        bundle_id = bundle_id or f"path:{app}"
        protected = any(bundle_id.startswith(prefix) for prefix in protected_prefixes)
        store_id = app_store_id(app)
        cask = cask_map.get(app.name)
        if cask:
            source = "brew_cask"
        elif store_id or (app / "Contents" / "_MASReceipt" / "receipt").exists():
            source = "app_store"
        else:
            source = "vendor"
        record: dict[str, Any] = {
            "name": display_name or app.stem,
            "bundle_id": bundle_id,
            "path": str(app),
            "source": source,
            "protected": protected,
        }
        if cask:
            record["package"] = cask
        if store_id and source == "app_store":
            record["store_id"] = store_id
            if not protected:
                removable_store_ids.append(store_id)
        records.append(record)
    return sorted(records, key=lambda item: item["bundle_id"]), sorted(set(removable_store_ids))


def manager_state(platform: str, protected_prefixes: list[str]) -> tuple[dict[str, list[str]], dict[str, list[str]], list[dict[str, Any]]]:
    installed = {manager: [] for manager in MANAGERS}
    installed_all = {manager: [] for manager in MANAGERS}
    casks: list[str] = []
    if platform == "macos":
        formulae, all_formulae, casks, taps = brew_state()
        installed["brew_formula"] = formulae
        installed_all["brew_formula"] = all_formulae
        installed["brew_cask"] = installed_all["brew_cask"] = casks
        installed["brew_tap"] = installed_all["brew_tap"] = taps
    elif platform == "debian":
        installed["apt"] = installed_all["apt"] = lines(run("apt-mark", "showmanual"))
    elif platform == "arch":
        installed["pacman"] = installed_all["pacman"] = lines(run("pacman", "-Qqe"))

    installed["bun"] = installed_all["bun"] = bun_globals()
    installed["npm"] = installed_all["npm"] = npm_globals()
    installed["cargo"] = installed_all["cargo"] = cargo_globals()
    installed["go"] = installed_all["go"] = go_tools()
    installed["uv"] = installed_all["uv"] = uv_tools()
    app_records: list[dict[str, Any]] = []
    if platform == "macos":
        app_records, store_ids = applications(casks, protected_prefixes)
        installed["mas"] = installed_all["mas"] = store_ids
    return installed, installed_all, app_records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--desired", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    desired = json.loads(args.desired.read_text())
    desired_managers = {
        manager: sorted(set(desired.get("managers", {}).get(manager, [])))
        for manager in MANAGERS
    }
    protected = {
        manager: set(desired.get("protected", {}).get(manager, []))
        for manager in MANAGERS
    }
    prefixes = desired.get("protected_application_bundle_prefixes", [])
    installed, installed_all, app_records = manager_state(desired["platform"], prefixes)

    extras = {
        manager: sorted(set(installed[manager]) - set(desired_managers[manager]) - protected[manager])
        for manager in MANAGERS
    }
    missing = {
        manager: sorted(set(desired_managers[manager]) - set(installed_all[manager]))
        for manager in MANAGERS
    }

    desired_bundle_ids = {item["bundle_id"] for item in desired.get("applications", [])}
    app_extras = [
        item
        for item in app_records
        if item["bundle_id"] not in desired_bundle_ids and not item["protected"]
    ]
    app_missing = [
        item
        for item in desired.get("applications", [])
        if item["bundle_id"] not in {record["bundle_id"] for record in app_records}
    ]

    report = {
        "profile": desired["profile"],
        "platform": desired["platform"],
        "desired": {"managers": desired_managers, "applications": desired.get("applications", [])},
        "installed": {"managers": installed, "applications": app_records},
        "extras": {"managers": extras, "applications": app_extras},
        "missing": {"managers": missing, "applications": app_missing},
        "cleanup_policy": {
            "automatic": ["brew_formula", "brew_cask", "brew_tap", "apt", "pacman", "bun", "npm", "cargo", "uv", "mas", "application_bundles"],
            "report_only": ["go"],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    print(f"Drift report: {args.output}")
    print(f"Profile/platform: {desired['profile']}/{desired['platform']}")
    for manager in MANAGERS:
        if extras[manager]:
            print(f"EXTRA {manager}: {', '.join(extras[manager])}")
        if missing[manager]:
            print(f"MISSING {manager}: {', '.join(missing[manager])}")
    if app_extras:
        print("EXTRA applications:")
        for app in app_extras:
            print(f"  - {app['name']} [{app['bundle_id']}] ({app['source']})")
    if app_missing:
        print("MISSING applications:")
        for app in app_missing:
            print(f"  - {app['name']} [{app['bundle_id']}]")
    if not any(extras.values()) and not any(missing.values()) and not app_extras and not app_missing:
        print("No drift detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
