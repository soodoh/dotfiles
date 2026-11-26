"""Interpret the tool declaration forms used by lock validation and CI caching."""

import re
from dataclasses import dataclass
from typing import Any

_VERSION_PLACEHOLDER = re.compile(r"{{\s*version\s*}}")


def expand_http_url(template: str, version: str) -> str:
    """Substitute a version without evaluating any other Tera syntax."""
    expanded = _VERSION_PLACEHOLDER.sub(lambda _: version, template)
    if any(marker in expanded for marker in ("{{", "{%", "{#")):
        raise ValueError("supports only literal URLs and {{ version }}")
    return expanded


@dataclass(frozen=True)
class ToolRequest:
    version: str
    options: dict[str, Any]

    def supports_os(self, os_name: str) -> bool:
        scope = self.options.get("os")
        if isinstance(scope, str):
            return os_name == scope
        return scope is None or os_name in scope

    def without_os(self) -> "ToolRequest":
        if "os" not in self.options:
            return self
        return ToolRequest(
            self.version,
            {key: value for key, value in self.options.items() if key != "os"},
        )

    def to_toml_value(self) -> str | dict[str, Any]:
        return {"version": self.version, **self.options} if self.options else self.version


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
                    or isinstance(scope, list) and all(isinstance(os, str) for os in scope)
                ):
                    raise ValueError(f"{source}: {name}: os must be a string or list of strings")
            else:
                raise ValueError(f"{source}: {name}: tool request must declare a string version")
            if request not in requests:
                requests.append(request)
        declarations[name] = requests
    return declarations
