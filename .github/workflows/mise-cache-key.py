"""Build CI cache keys from mise inputs that affect installed tools."""

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import tomllib

SCHEMA = "mise-tools-v2"
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


def requested_version(specification: Any) -> str:
    if isinstance(specification, str):
        return specification
    if isinstance(specification, dict) and isinstance(
        specification.get("version"), str
    ):
        return specification["version"]
    raise ValueError("tool declaration has no string version")


def install_options(specification: Any) -> dict[str, Any]:
    if isinstance(specification, str):
        return {}
    if isinstance(specification, dict):
        return {
            key: value for key, value in specification.items() if key != "version"
        }
    raise ValueError("unsupported tool declaration")


def declared_tools(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    declarations = {"root": config.get("tools", {})}
    for task_name, task in config.get("tasks", {}).items():
        if isinstance(task, dict) and isinstance(task.get("tools"), dict):
            declarations[f"task:{task_name}"] = task["tools"]
    return declarations


def platform_name(os_name: str, architecture: str) -> str:
    operating_system = {"linux": "linux", "macos": "macos"}.get(os_name.lower())
    machine = {"x64": "x64", "arm64": "arm64"}.get(architecture.lower())
    if operating_system is None or machine is None:
        raise ValueError(f"unsupported cache platform: {os_name}/{architecture}")
    return f"{operating_system}-{machine}"


def relevant_lock_entry(entry: dict[str, Any], platform: str) -> dict[str, Any]:
    selected = {
        key: value for key, value in entry.items() if not key.startswith("platforms.")
    }
    platform_key = f"platforms.{platform}"
    if platform_key in entry:
        selected[platform_key] = entry[platform_key]
    return selected


def matching_lock_entries(
    locks: dict[str, Any], tool: str, version: str, platform: str
) -> list[dict[str, Any]]:
    entries = locks.get("tools", {}).get(tool, [])
    return [
        relevant_lock_entry(entry, platform)
        for entry in entries
        if entry.get("version") == version
    ]


def cache_inputs(
    root: Path, os_name: str, architecture: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    config = load_toml(root / "mise.toml")
    locks = load_toml(root / "mise.lock")
    platform = platform_name(os_name, architecture)
    declarations = declared_tools(config)
    # Raw templates can depend on arbitrary env/vars/files, which this projection
    # intentionally does not hash. Fail closed rather than claim safe reuse.
    if "{{" in json.dumps(declarations):
        raise ValueError("templated tool inputs require a cache-key policy review")

    policy_tools: dict[str, Any] = {}
    identity_tools: dict[str, Any] = {}
    for source, tools in sorted(declarations.items()):
        policy_tools[source] = {}
        identity_tools[source] = {}
        for tool, specification in sorted(tools.items()):
            version = requested_version(specification)
            entries = matching_lock_entries(locks, tool, version, platform)
            if source == "root" and not entries:
                raise ValueError(f"{tool}@{version} has no matching mise.lock entry")
            policy_tools[source][tool] = {
                "options": install_options(specification),
                "backend": [
                    {key: entry[key] for key in ("backend", "options") if key in entry}
                    for entry in entries
                ] if source == "root" else [],
            }
            identity_tools[source][tool] = {
                "version": version,
                "lock": entries,
            }

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
) -> dict[str, str]:
    policy, identity = cache_inputs(root, os_name, architecture)
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


def snapshot(root: Path, os_name: str, architecture: str) -> dict[str, Any]:
    policy, identity = cache_inputs(root, os_name, architecture)
    return {
        "policy": canonical_hash(policy),
        "tools": {
            f"{tool}@{entry['version']}": canonical_hash(entry)
            for tools in identity["declarations"].values()
            for tool, entry in tools.items()
        },
    }


def reinstall_tools(previous: dict, current: dict) -> list[str]:
    # --locked does not re-check cached binaries when the same version's lock
    # artifact changes. Unknown/replaced fingerprints must be installed afresh.
    old = previous.get("tools", {}) if previous.get("policy") == current["policy"] else {}
    return sorted(tool for tool, fingerprint in current["tools"].items() if old.get(tool) != fingerprint)


def reconcile_or_record(arguments: argparse.Namespace) -> None:
    data = arguments.data_dir
    manifest = data / ".dotfiles-ci-cache-inputs.json"
    current = snapshot(arguments.root, arguments.os, arguments.arch)
    try:
        previous = json.loads(manifest.read_text())
    except (FileNotFoundError, ValueError):
        previous = {}
    if arguments.mode == "reconcile":
        if (data / "installs").exists():
            tools = reinstall_tools(previous, current)
            if tools:
                print("Reinstalling new or changed cached lock artifacts:", ", ".join(tools), flush=True)
                subprocess.run(["mise", "install", "--locked", "--force", *tools], check=True)
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
    parser.add_argument("--mise-version", default=os.environ.get("MISE_VERSION"))
    parser.add_argument("--mode", choices=("key", "reconcile", "record"), default="key")
    parser.add_argument("--data-dir", type=Path, default=Path.home() / ".local/share/mise")
    arguments = parser.parse_args()
    if arguments.mode != "key":
        reconcile_or_record(arguments)
        return
    emit_outputs(
        build_keys(
            arguments.root,
            arguments.os,
            arguments.arch,
            arguments.image,
            arguments.mise_version,
        )
    )


if __name__ == "__main__":
    main()
