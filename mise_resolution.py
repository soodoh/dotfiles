"""Read tool resolution from an isolated mise staging directory."""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from mise_declarations import ToolRequest

_PROJECTION_SECTIONS = ("settings", "tool_config", "alias", "plugins")


def _toml_value(value: Any) -> str:
    """Serialize JSON-compatible TOML configuration values for projected stages."""
    if isinstance(value, dict):
        return "{ " + ", ".join(
            f"{_toml_value(key)} = {_toml_value(item)}" for key, item in value.items()
        ) + " }"
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _write_projected_config(path: Path, data: dict[str, Any]) -> None:
    """Write a projected mise TOML config preserving backend options."""
    path.write_text(
        "".join(f"{_toml_value(key)} = {_toml_value(value)}\n" for key, value in data.items())
    )


def read_mise_resolution(
    stage: Path,
    *,
    profile: str | None = None,
    root_config_only: bool = False,
    python_request: str | None = None,
) -> tuple[dict[str, list[tuple[str, str]]], str]:
    """Read (requested, resolved) version pairs and diagnostics, without installing.

    The caller prepares the stage and chooses its lock mode. Projected configs
    load only mise.toml; actual profile configs use mise's normal discovery.
    """
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("MISE_")
    }
    environment.update(
        {
            "MISE_CONFIG_DIR": str(stage / ".global"),
            "MISE_GLOBAL_CONFIG_FILE": str(stage / ".empty.toml"),
            "MISE_SYSTEM_CONFIG_FILE": str(stage / ".empty.toml"),
            "MISE_ENV": "",
            "MISE_SAFE": "1",
            "MISE_TRUSTED_CONFIG_PATHS": str(stage),
            "MISE_SELF_UPDATE_AUTO": "false",
        }
    )
    if root_config_only:
        environment["MISE_OVERRIDE_CONFIG_FILENAMES"] = "mise.toml"
    if python_request is not None:
        environment["MISE_PYTHON_VERSION"] = python_request
    arguments = ["mise", "--cd", str(stage), "--no-env", "--no-hooks"]
    if profile is not None:
        arguments.extend(["--env", profile])
    result = subprocess.run(
        [*arguments, "ls", "--current", "--offline", "--json"],
        cwd=stage,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    diagnostics = result.stderr.strip()
    if result.returncode:
        raise ValueError(
            f"{profile or 'shared'}: mise resolution failed:\n{diagnostics}"
        )

    payload = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise TypeError("mise returned no tool resolution table")
    resolved = {}
    for tool, records in payload.items():
        if not isinstance(records, list):
            raise TypeError(f"mise returned no resolution records for {tool}")
        requests = []
        for record in records:
            if not isinstance(record, dict):
                raise TypeError(
                    f"mise returned an invalid resolution record for {tool}"
                )
            request, version = record.get("requested_version"), record.get("version")
            if not isinstance(request, str) or not isinstance(version, str):
                raise TypeError(f"mise returned no version identity for {tool}")
            requests.append((request, version))
        resolved[tool] = requests
    return resolved, diagnostics


def resolve_projected_configs(
    lock_root: Path,
    configs: dict[str, dict[str, Any]],
    tools_by_source: dict[str, dict[str, list[ToolRequest]]],
    *,
    profile: str | None = None,
    root_config_only: bool = False,
    strip_os: bool = False,
    unlocked: bool = False,
) -> tuple[dict[str, list[tuple[str, str]]], str]:
    """Project selected tool declarations into an isolated stage and resolve offline."""
    if not any(tools_by_source.values()):
        return {}, ""
    sources = (
        ("mise.toml",)
        if root_config_only or profile is None
        else ("mise.toml", f"mise.{profile}.toml")
    )
    with tempfile.TemporaryDirectory(prefix="mise-resolve-projected-") as directory:
        stage = Path(directory)
        for source in sources:
            projection = {
                key: configs[source][key]
                for key in _PROJECTION_SECTIONS
                if key in configs[source]
            }
            if unlocked and source == "mise.toml":
                projection["settings"] = {
                    **projection.get("settings", {}),
                    "lockfile": True,
                    "locked": False,
                }
                projection["tool_config"] = {
                    **projection.get("tool_config", {}),
                    "locked": False,
                }
            if tools := tools_by_source.get(source):
                projected_tools: dict[str, list[Any]] = {}
                for tool, requests in tools.items():
                    values: list[Any] = []
                    for request in requests:
                        item = (
                            request.without_os() if strip_os else request
                        ).to_toml_value()
                        if item not in values:
                            values.append(item)
                    projected_tools[tool] = values
                projection["tools"] = projected_tools
            _write_projected_config(stage / source, projection)
            lock_name = source.replace(".toml", ".lock")
            shutil.copy2(lock_root / lock_name, stage / lock_name)
        return read_mise_resolution(
            stage,
            profile=profile,
            root_config_only=root_config_only,
        )
