"""Read, project, and validate repository mise tool declarations and lock records."""

import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Record = dict[str, Any]
RunCommand = Callable[..., subprocess.CompletedProcess[str]]

_PLATFORM_PREFIX = "platforms."
_PROJECTION_SECTIONS = ("settings", "tool_config", "alias", "plugins")
_VERSION_PLACEHOLDER = re.compile(r"{{\s*version\s*}}")


def _expand_http_url(template: str, version: str) -> str:
    """Substitute a version without evaluating any other Tera syntax."""
    expanded = _VERSION_PLACEHOLDER.sub(lambda _: version, template)
    if any(marker in expanded for marker in ("{{", "{%", "{#")):
        raise ValueError("supports only literal URLs and {{ version }}")
    return expanded


def _toml_value(value: Any) -> str:
    """Serialize JSON-compatible TOML configuration values for projected stages."""
    if isinstance(value, dict):
        return (
            "{ "
            + ", ".join(
                f"{_toml_value(key)} = {_toml_value(item)}"
                for key, item in value.items()
            )
            + " }"
        )
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def _write_projected_config(path: Path, data: dict[str, Any]) -> None:
    """Write a projected mise TOML config preserving backend options."""
    path.write_text(
        "".join(
            f"{_toml_value(key)} = {_toml_value(value)}\n"
            for key, value in data.items()
        )
    )


def _project_record(record: Record, platform: str) -> Record:
    """Keep the record's metadata and only the requested platform's artifact."""
    platform_key = f"{_PLATFORM_PREFIX}{platform}"
    return {
        key: value
        for key, value in record.items()
        if not key.startswith(_PLATFORM_PREFIX) or key == platform_key
    }


def platform_artifact(record: Record, platform: str) -> Any:
    return record.get(f"{_PLATFORM_PREFIX}{platform}")


@dataclass(frozen=True)
class ToolRequest:
    version: str
    options: dict[str, Any]

    def supports_os(self, os_name: str) -> bool:
        scope = self.options.get("os")
        if isinstance(scope, str):
            return os_name == scope
        return scope is None or os_name in scope

    def _without_os(self) -> "ToolRequest":
        if "os" not in self.options:
            return self
        return ToolRequest(
            self.version,
            {key: value for key, value in self.options.items() if key != "os"},
        )

    def _to_toml_value(self) -> str | dict[str, Any]:
        return {"version": self.version, **self.options} if self.options else self.version


@dataclass(frozen=True)
class ResolvedDeclaration:
    lock_name: str
    source: str
    tool: str
    version: str
    request: ToolRequest


@dataclass(frozen=True)
class ProfileResolution:
    matches: list[ResolvedDeclaration]
    warnings: str


@dataclass(frozen=True)
class ResolvedCacheEntry:
    request: ToolRequest
    version: str
    lock_entries: list[Record]


def read_tool_declarations(tools: object, source: str) -> dict[str, list[ToolRequest]]:
    """Read scalar, table, or ordered list declarations without resolving versions."""
    if not isinstance(tools, dict):
        raise ValueError(f"{source}: expected a tools table")
    declarations = {}
    for name, value in tools.items():
        requests = []
        specs = value if isinstance(value, list) else [value]
        for spec in specs:
            if isinstance(spec, str):
                request = ToolRequest(spec, {})
            elif isinstance(spec, dict) and isinstance(spec.get("version"), str):
                options = {key: val for key, val in spec.items() if key != "version"}
                request = ToolRequest(spec["version"], options)
                scope = options.get("os")
                if scope is not None and not (
                    isinstance(scope, str)
                    or isinstance(scope, list)
                    and all(isinstance(os_item, str) for os_item in scope)
                ):
                    raise ValueError(
                        f"{source}: {name}: os must be a string or list of strings"
                    )
            else:
                raise ValueError(
                    f"{source}: {name}: tool request must declare a string version"
                )
            if request not in requests:
                requests.append(request)
        declarations[name] = requests
    return declarations


class LockRecords:
    def __init__(self, name: str, lock: dict[str, Any]) -> None:
        self._name = name
        self._lock = lock

    def _tools(self, *, required: bool) -> dict[str, Any]:
        tools = self._lock.get("tools", None if required else {})
        if not isinstance(tools, dict):
            raise TypeError(f"{self._name}: expected a tools table")
        return tools

    def _read(self, tool: str, entries: object, version: str | None) -> Iterator[Record]:
        if not isinstance(entries, list) or not entries:
            raise ValueError(
                f"{self._name}: {tool}: expected locked version entries"
            )
        # This repository uses core short names and qualified non-core tools.
        expected_backend = tool if ":" in tool else f"core:{tool}"
        for entry in entries:
            if not isinstance(entry, dict):
                raise TypeError(
                    f"{self._name}: {tool}: expected locked version tables"
                )
            locked = entry.get("version")
            if not isinstance(locked, str) or not locked:
                raise TypeError(f"{self._name}: {tool}: missing or invalid version")
            if version is not None and locked != version:
                continue
            context = f"{self._name}: {tool}@{locked}"
            backend = entry.get("backend")
            if not isinstance(backend, str):
                raise TypeError(f"{context}: missing or invalid backend")
            if backend != expected_backend:
                raise ValueError(
                    f"{context}: expected backend {expected_backend!r}, found {backend!r}"
                )
            yield entry

    def checked_tools(self) -> dict[str, list[Record]]:
        """Validate and return all records, including ones not currently installed."""
        return {
            tool: list(self._read(tool, entries, version=None))
            for tool, entries in self._tools(required=True).items()
        }

    def matching(self, tool: str, version: str) -> list[Record]:
        """Select records for a native-resolved version, checking their identities."""
        tools = self._tools(required=False)
        return list(self._read(tool, tools[tool], version)) if tool in tools else []


def _read_mise_resolution(
    stage: Path,
    *,
    profile: str | None = None,
    root_config_only: bool = False,
    python_request: str | None = None,
    run_command: RunCommand = subprocess.run,
) -> tuple[dict[str, list[tuple[str, str]]], str]:
    """Read (requested, resolved) version pairs and diagnostics, without installing."""
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
    result = run_command(
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


def _resolve_projected_configs(
    lock_root: Path,
    configs: dict[str, dict[str, Any]],
    tools_by_source: dict[str, dict[str, list[ToolRequest]]],
    *,
    profile: str | None = None,
    root_config_only: bool = False,
    strip_os: bool = False,
    unlocked: bool = False,
    run_command: RunCommand = subprocess.run,
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
                            request._without_os() if strip_os else request
                        )._to_toml_value()
                        if item not in values:
                            values.append(item)
                    projected_tools[tool] = values
                projection["tools"] = projected_tools
            _write_projected_config(stage / source, projection)
            lock_name = source.replace(".toml", ".lock")
            shutil.copy2(lock_root / lock_name, stage / lock_name)
        return _read_mise_resolution(
            stage,
            profile=profile,
            root_config_only=root_config_only,
            run_command=run_command,
        )


def _check_cache_template_inputs(source: str, tool: str, request: ToolRequest) -> None:
    """Reject templated inputs except {{ version }} inside http: archive URLs."""
    error_message = f"{tool}: templated tool inputs require a cache-key policy review"
    reviewed = copy.deepcopy(request.options)
    if tool.startswith("http:"):
        for options in (reviewed, *reviewed.get("platforms", {}).values()):
            if isinstance(url := options.get("url"), str):
                try:
                    options["url"] = _expand_http_url(url, version="")
                except ValueError as error:
                    raise ValueError(error_message) from error
    encoded = json.dumps([source, tool, request.version, reviewed])
    if any(marker in encoded for marker in ("{{", "{%", "{#")):
        raise ValueError(error_message)


def validate_http_lock_urls(
    source: str,
    tool: str,
    request: ToolRequest,
    version: str,
    entries: list[Record],
    platforms: Iterable[str],
) -> None:
    """Check that declared http: archive URLs and checksums match committed locks."""
    lock_name = source.replace(".toml", ".lock")
    declared_platforms = request.options.get("platforms", {})
    for platform in sorted(set(platforms) | declared_platforms.keys()):
        if not request.supports_os(platform.split("-", 1)[0]):
            continue
        artifact = declared_platforms.get(platform, {})
        template = artifact.get("url", request.options.get("url"))
        if template is None:
            continue
        context = f"{source}: {tool}@{version}: {platform}: url"
        if not isinstance(template, str):
            raise TypeError(f"{context} must be a string")
        # Repository HTTP URLs are literals or use only mise's version variable.
        # Fail closed on richer templates instead of silently skipping validation;
        # never evaluate arbitrary template functions during offline validation.
        try:
            expected = _expand_http_url(template, version)
        except ValueError as error:
            raise ValueError(f"{context}: offline validation {error}") from error
        locked_artifacts = [
            locked
            for entry in entries
            if isinstance(locked := platform_artifact(entry, platform), dict)
        ]
        if not any(locked.get("url") == expected for locked in locked_artifacts):
            raise ValueError(
                f"{context}: {lock_name} does not match declared URL {expected!r}"
            )
        checksum = artifact.get("checksum", request.options.get("checksum"))
        if checksum is not None and not any(
            locked.get("checksum") == checksum for locked in locked_artifacts
        ):
            raise ValueError(
                f"{source}: {tool}@{version}: {platform}: {lock_name} does not match the declared checksum"
            )


def resolve_profile_declarations(
    stage: Path,
    configs: dict[str, dict[str, Any]],
    declarations: dict[str, dict[str, list[ToolRequest]]],
    *,
    profile: str | None = None,
    locks: dict[str, dict[str, list[Record]]] | None = None,
    run_command: RunCommand = subprocess.run,
) -> ProfileResolution:
    """Resolve host-active, cross-OS projected, and pipx Python requests offline."""
    sources = ("mise.toml", f"mise.{profile}.toml") if profile else ("mise.toml",)
    tools = {
        tool: (source, requests)
        for source in sources
        for tool, requests in declarations[source].items()
    }

    host_os = "macos" if sys.platform == "darwin" else sys.platform
    split_requests: dict[str, tuple[str, list[ToolRequest], list[ToolRequest]]] = {}
    inactive_by_source: dict[str, dict[str, list[ToolRequest]]] = {}
    for tool, (source, requests) in tools.items():
        active, inactive = [], []
        for request in requests:
            (active if request.supports_os(host_os) else inactive).append(request)
        split_requests[tool] = (source, active, inactive)
        if inactive:
            inactive_by_source.setdefault(source, {})[tool] = inactive

    resolved, warnings = _read_mise_resolution(
        stage, profile=profile, run_command=run_command
    )
    # Mise skips tools whose os filter does not match this host. Project only
    # those requests without their os filter so mise itself still validates
    # versions, backends, and normalized options against the committed locks.
    inactive_resolved, inactive_warnings = _resolve_projected_configs(
        stage,
        configs,
        inactive_by_source,
        profile=profile,
        strip_os=True,
        run_command=run_command,
    )

    problems: list[str] = []
    matches: list[ResolvedDeclaration] = []
    for tool, (source, active, inactive) in split_requests.items():
        lock_name = source.replace(".toml", ".lock")
        native_active = resolved.get(tool, [])
        native_inactive = inactive_resolved.get(tool, [])
        if sorted(r.version for r in active) != sorted(
            request for request, _ in native_active
        ) or sorted(r.version for r in inactive) != sorted(
            request for request, _ in native_inactive
        ):
            requested_versions = [r.version for r in tools[tool][1]]
            problems.append(
                f"{source}: {tool}: requests {requested_versions!r} have no matching lock "
                "(check version, backend and options)"
            )
            continue
        active_versions = dict(native_active)
        inactive_versions = dict(native_inactive)
        matches.extend(
            ResolvedDeclaration(lock_name, source, tool, active_versions[r.version], r)
            for r in active
        )
        matches.extend(
            ResolvedDeclaration(lock_name, source, tool, inactive_versions[r.version], r)
            for r in inactive
        )

    if locks is not None:
        # `ls --current` omits pipx's private Python runtime. Resolve each
        # requested runtime explicitly using mise's version matching.
        python_requests = {
            python
            for tool, (_, requests) in tools.items()
            if tool.startswith("pipx:")
            for item in requests
            if isinstance(python := item.options.get("python"), str)
        }
        lock_names = [source.replace(".toml", ".lock") for source in sources]
        python_versions = {
            entry["version"]
            for name in lock_names
            for entry in locks[name].get("python", [])
        }
        for request in sorted(python_requests):
            runtimes, _ = _read_mise_resolution(
                stage,
                profile=profile,
                python_request=request,
                run_command=run_command,
            )
            records = runtimes.get("python", [])
            if not records or any(
                requested != request or version not in python_versions
                for requested, version in records
            ):
                problems.append(
                    f"{profile or 'shared'}: private python@{request} has no matching lock"
                )

    combined_warnings = "\n".join(
        text for text in (warnings, inactive_warnings) if text
    )
    if problems:
        details = "\n".join(problems)
        if combined_warnings:
            details += "\n" + combined_warnings
        raise ValueError(details)
    return ProfileResolution(matches=matches, warnings=combined_warnings)


def resolve_cache_declarations(
    root: Path,
    config: dict[str, Any],
    lock: dict[str, Any],
    *,
    platform: str,
    run_command: RunCommand = subprocess.run,
) -> dict[str, dict[str, list[ResolvedCacheEntry]]]:
    """Resolve active root and task tool declarations for one target platform."""
    operating_system = platform.split("-", 1)[0]
    locks = LockRecords("mise.lock", lock)

    def active(tools: object, source: str) -> dict[str, list[ToolRequest]]:
        return {
            tool: selected
            for tool, requests in read_tool_declarations(tools, source).items()
            if (selected := [r for r in requests if r.supports_os(operating_system)])
        }

    declarations: dict[str, dict[str, list[ToolRequest]]] = {
        "root": active(config.get("tools", {}), "mise.toml")
    }
    for task_name, task in config.get("tasks", {}).items():
        if (
            isinstance(task, dict)
            and "tools" in task
            and (tools := active(task["tools"], f"mise.toml: task {task_name}"))
        ):
            declarations[f"task:{task_name}"] = tools

    for source, tools in declarations.items():
        for tool, requests in tools.items():
            for request in requests:
                _check_cache_template_inputs(source, tool, request)

    # `mise ls` does not include task tools. Project every distinct declaration
    # into [tools] so root and task requests use the same native resolver, even
    # when they request different versions of one tool. Never modify the checkout.
    projected_tools: dict[str, list[ToolRequest]] = {}
    for source_tools in declarations.values():
        for tool, requests in source_tools.items():
            versions = projected_tools.setdefault(tool, [])
            for request in requests:
                if request not in versions:
                    versions.append(request)

    records, diagnostics = _resolve_projected_configs(
        root,
        {"mise.toml": config},
        {"mise.toml": projected_tools},
        root_config_only=True,
        unlocked=True,
        run_command=run_command,
    )
    if diagnostics:
        print(diagnostics, file=sys.stderr)

    versions: dict[tuple[str, str], str] = {}
    for tool, resolved_versions in records.items():
        for request_version, version in resolved_versions:
            key = (tool, request_version)
            if key in versions and versions[key] != version:
                raise ValueError(
                    f"mise returned ambiguous versions for {tool}@{request_version}"
                )
            versions[key] = version

    result: dict[str, dict[str, list[ResolvedCacheEntry]]] = {}
    for source, tools in declarations.items():
        result[source] = {}
        for tool, requests in tools.items():
            resolved_entries: list[ResolvedCacheEntry] = []
            for request in requests:
                version = versions.get((tool, request.version))
                if version is None:
                    raise ValueError(
                        f"mise did not resolve {tool}@{request.version}"
                    )
                entries = [
                    _project_record(record, platform)
                    for record in locks.matching(tool, version)
                ]
                if source == "root" and not entries:
                    raise ValueError(
                        f"{tool}@{version} has no matching mise.lock entry"
                    )
                resolved_entries.append(
                    ResolvedCacheEntry(
                        request=request,
                        version=version,
                        lock_entries=entries,
                    )
                )
            result[source][tool] = resolved_entries
    return result
