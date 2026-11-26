"""Build CI cache keys from mise inputs that affect installed tools."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

# Executing this helper by path puts .github/workflows, not the root, on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from mise_resolution import RunCommand, resolve_cache_declarations

# v4 hashes ordered requests per tool instead of one request per tool.
SCHEMA = "mise-tools-v4"
# Default to invalidating on new settings; these only govern workstation state.
NON_INSTALL_SETTINGS = {"age", "dotfiles"}


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        return tomllib.load(stream)


def installed_mise_version(*, run_command: RunCommand = subprocess.run) -> str:
    result = run_command(
        ["mise", "--version"], capture_output=True, text=True, check=True
    )
    output = result.stdout.strip()
    match = re.match(r"^(\d+\.\d+\.\d+)(?:\s|$)", output)
    if match is None:
        raise ValueError(f"mise reported an invalid version: {output!r}")
    return match[1]


def platform_name(os_name: str, architecture: str) -> str:
    operating_system = {"linux": "linux", "macos": "macos"}.get(os_name.lower())
    machine = {"x64": "x64", "arm64": "arm64"}.get(architecture.lower())
    if operating_system is None or machine is None:
        raise ValueError(f"unsupported cache platform: {os_name}/{architecture}")
    return f"{operating_system}-{machine}"


def cache_inputs(
    root: Path,
    os_name: str,
    architecture: str,
    *,
    run_command: RunCommand = subprocess.run,
) -> tuple[dict[str, Any], dict[str, Any]]:
    config = load_toml(root / "mise.toml")
    lock = load_toml(root / "mise.lock")
    platform = platform_name(os_name, architecture)
    resolved = resolve_cache_declarations(
        root, config, lock, platform=platform, run_command=run_command
    )

    policy_tools: dict[str, Any] = {}
    identity_tools: dict[str, Any] = {}
    for source, tools in resolved.items():
        policy_tools[source] = {}
        identity_tools[source] = {}
        for tool, resolved_entries in tools.items():
            policy_tools[source][tool] = [
                {
                    "options": entry.request.options,
                    "backend": (
                        entry.backend_metadata() if source == "root" else []
                    ),
                }
                for entry in resolved_entries
            ]
            identity_tools[source][tool] = [
                {"version": entry.version, "lock": entry.lock_entries}
                for entry in resolved_entries
            ]

    settings = config.get("settings", {})
    policy = {
        "schema": SCHEMA,
        "settings": {
            key: value
            for key, value in settings.items()
            if key not in NON_INSTALL_SETTINGS
        },
        "tool_config": config.get("tool_config", {}),
        "aliases": config.get("alias", {}),
        "plugins": config.get("plugins", {}),
        "hooks": config.get("hooks", {}),
        "declarations": policy_tools,
        # Ordinary runtime env is irrelevant; installer/compiler overrides aren't.
        "install_env": {
            key: value for key, value in config.get("env", {}).items()
            if re.match(r"^(CARGO_|RUST|NPM_CONFIG_|npm_config_|PIP_|PYTHON_CONFIGURE_|NODE_OPTIONS$|CC$|CXX$|CFLAGS$|CXXFLAGS$|LDFLAGS$|MISE_(?!AGE_|GITHUB_TOKEN$))", key)
        },
    }
    identity = {
        "schema": SCHEMA,
        "platform": platform,
        "declarations": identity_tools,
    }
    return policy, identity


def safe_component(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
        raise ValueError(f"invalid or missing compatibility boundary: {value!r}")
    return value.lower()


def build_keys(
    root: Path,
    os_name: str,
    architecture: str,
    image: str,
    mise_version: str,
    *,
    run_command: RunCommand = subprocess.run,
) -> dict[str, str]:
    policy, identity = cache_inputs(
        root, os_name, architecture, run_command=run_command
    )
    boundary = "-".join(
        (
            SCHEMA,
            safe_component(os_name),
            safe_component(architecture),
            safe_component(image),
            f"mise-{safe_component(mise_version)}",
            f"policy-{canonical_hash(policy)}",
        )
    )
    return {
        "primary-key": f"{boundary}-tools-{canonical_hash(identity)}",
        "restore-key": f"{boundary}-",
        "policy-hash": canonical_hash(policy),
        "tools-hash": canonical_hash(identity),
    }


def snapshot(
    root: Path,
    os_name: str,
    architecture: str,
    *,
    run_command: RunCommand = subprocess.run,
) -> dict[str, Any]:
    policy, identity = cache_inputs(
        root, os_name, architecture, run_command=run_command
    )
    return {
        "policy": canonical_hash(policy),
        "tools": {
            f"{tool}@{entry['version']}": canonical_hash(entry)
            for tools in identity["declarations"].values()
            for tool, requests in tools.items()
            for entry in requests
        },
    }


def reinstall_tools(previous: dict, current: dict) -> list[str]:
    # --locked does not re-check cached binaries when the same version's lock
    # artifact changes. Unknown/replaced fingerprints must be installed afresh.
    old = previous.get("tools", {}) if previous.get("policy") == current["policy"] else {}
    return sorted(tool for tool, fingerprint in current["tools"].items() if old.get(tool) != fingerprint)


def reconcile_or_record(
    arguments: argparse.Namespace,
    *,
    run_command: RunCommand = subprocess.run,
) -> None:
    data = arguments.data_dir
    manifest = data / ".dotfiles-ci-cache-inputs.json"
    current = snapshot(
        arguments.root, arguments.os, arguments.arch, run_command=run_command
    )
    try:
        previous = json.loads(manifest.read_text())
    except (FileNotFoundError, ValueError):
        previous = {}
    if arguments.mode == "reconcile":
        if (data / "installs").exists():
            tools = reinstall_tools(previous, current)
            if tools:
                print("Reinstalling new or changed cached lock artifacts:", ", ".join(tools), flush=True)
                run_command(["mise", "install", "--locked", "--force", *tools], check=True)
    else:
        # Preserve fingerprints for older versions retained by compatible restores.
        if previous.get("policy") == current["policy"]:
            current["tools"] = {**previous.get("tools", {}), **current["tools"]}
        data.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(current, sort_keys=True) + "\n")


def emit_outputs(outputs: dict[str, str]) -> None:
    for name, value in outputs.items():
        print(f"{name}={value}")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with Path(github_output).open("a") as stream:
            for name, value in outputs.items():
                stream.write(f"{name}={value}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--os", default=os.environ.get("RUNNER_OS"))
    parser.add_argument("--arch", default=os.environ.get("RUNNER_ARCH"))
    parser.add_argument("--image", default=os.environ.get("ImageOS"))
    parser.add_argument(
        "--mode", choices=("key", "reconcile", "record"), default="key"
    )
    parser.add_argument("--data-dir", type=Path, default=Path.home() / ".local/share/mise")
    arguments = parser.parse_args()
    if arguments.mode in ("reconcile", "record"):
        reconcile_or_record(arguments)
        return

    emit_outputs(
        build_keys(
            arguments.root,
            arguments.os,
            arguments.arch,
            arguments.image,
            installed_mise_version(),
        )
    )


if __name__ == "__main__":
    main()
