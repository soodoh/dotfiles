"""Interpret committed mise lock records without imposing consumer policy."""

from collections.abc import Iterator
from typing import Any

Record = dict[str, Any]
_PLATFORM_PREFIX = "platforms."


def platform_artifact(record: Record, platform: str) -> Any:
    return record.get(f"{_PLATFORM_PREFIX}{platform}")


def project_record(record: Record, platform: str) -> Record:
    """Keep the record's metadata and only the requested platform's artifact."""
    platform_key = f"{_PLATFORM_PREFIX}{platform}"
    return {
        key: value for key, value in record.items()
        if not key.startswith(_PLATFORM_PREFIX) or key == platform_key
    }


class LockRecords:
    def __init__(self, name: str, lock: dict) -> None:
        self._name = name
        self._lock = lock

    def _tools(self, *, required: bool) -> dict:
        tools = self._lock.get("tools", None if required else {})
        if not isinstance(tools, dict):
            raise TypeError(f"{self._name}: expected a tools table")
        return tools

    def _read(self, tool: str, entries: object, version: str | None) -> Iterator[Record]:
        if not isinstance(entries, list) or not entries:
            raise ValueError(f"{self._name}: {tool}: expected locked version entries")
        # This repository uses core short names and qualified non-core tools.
        expected_backend = tool if ":" in tool else f"core:{tool}"
        for entry in entries:
            if not isinstance(entry, dict):
                raise TypeError(f"{self._name}: {tool}: expected locked version tables")
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
                raise ValueError(f"{context}: expected backend {expected_backend!r}, found {backend!r}")
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
