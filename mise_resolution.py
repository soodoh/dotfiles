"""Read tool resolution from an isolated mise staging directory."""

import json
import os
import re
import subprocess
from pathlib import Path

_VERSION_PLACEHOLDER = re.compile(r"{{\s*version\s*}}")


def expand_http_url(template: str, version: str) -> str:
    """Substitute a version without evaluating any other Tera syntax."""
    expanded = _VERSION_PLACEHOLDER.sub(lambda _: version, template)
    if any(marker in expanded for marker in ("{{", "{%", "{#")):
        raise ValueError("supports only literal URLs and {{ version }}")
    return expanded


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
