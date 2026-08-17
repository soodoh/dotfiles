#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_LOCKS = (
    ("mise.toml", "mise.lock"),
    ("mise.personal-macos.toml", "mise.personal-macos.lock"),
    ("mise.work-macos.toml", "mise.work-macos.lock"),
)

for config_name, lock_name in CONFIG_LOCKS:
    with (ROOT / config_name).open("rb") as handle:
        configured_tools = tomllib.load(handle).get("tools", {})
    with (ROOT / lock_name).open("rb") as handle:
        locked_tools = tomllib.load(handle).get("tools", {})
    configured = set(configured_tools)
    locked = set(locked_tools)
    if configured != locked:
        raise SystemExit(
            f"{config_name}/{lock_name} mismatch: missing={sorted(configured-locked)} extra={sorted(locked-configured)}"
        )
    for name, config in configured_tools.items():
        version = config if isinstance(config, str) else config["version"]
        entries = locked_tools[name]
        matches = [entry for entry in entries if entry["version"] == version]
        if not matches:
            raise SystemExit(f"{lock_name}: {name} does not lock configured version {version}")
        if isinstance(config, dict) and "platforms" in config:
            entry = matches[0]
            for platform, metadata in config["platforms"].items():
                locked_metadata = entry.get(f"platforms.{platform}")
                expected = {key: metadata[key] for key in ("url", "checksum") if key in metadata}
                if locked_metadata is None or any(locked_metadata.get(key) != value for key, value in expected.items()):
                    raise SystemExit(f"{lock_name}: {name} metadata differs for {platform}")

with (ROOT / "mise.toml").open("rb") as handle:
    node_version = tomllib.load(handle)["tools"]["node"]
if (ROOT / ".nvmrc").read_text().strip() != node_version:
    raise SystemExit(".nvmrc must match the Node version pinned in mise.toml")
if "--metadata-only" in sys.argv:
    raise SystemExit(0)

commands = {
    "node", "npm", "corepack", "bun", "python3", "uv", "go", "rustc", "cargo", "rustfmt",
    "rust-analyzer", "gh", "jq", "rg", "fzf", "atuin", "lazygit", "starship", "zoxide",
    "sesh", "yazi", "nvim", "tree-sitter", "docker-language-server", "lua-language-server",
    "marksman", "ruff", "shellcheck", "shfmt", "stylua", "kdlfmt", "taplo", "gopls",
    "yamllint", "pi", "playwright-mcp", "awk-language-server", "bash-language-server", "biome",
    "eslint_d", "graphql-lsp", "oxlint", "prettier", "prisma-language-server",
    "pyright-langserver", "typescript-language-server", "vim-language-server",
    "vscode-css-language-server", "vscode-html-language-server", "vscode-json-language-server",
    "vscode-eslint-language-server", "yaml-language-server",
}
profile = os.environ.get("DOTFILES_PROFILE") or os.environ.get("MISE_ENV")
if os.environ.get("VALIDATE_PROFILE_TOOLS") == "1":
    if profile == "personal-macos":
        commands.add("aws")
    elif profile == "work-macos":
        commands.update({"az", "azure-mcp", "twg"})

missing = sorted(command for command in commands if shutil.which(command) is None)
if missing:
    raise SystemExit("missing configured executables: " + ", ".join(missing))

for command, expected in {"node": "24.18.1", "npm": "12.0.2", "corepack": "0.35.0", "pi": "0.84.2"}.items():
    output = subprocess.check_output([command, "--version"], text=True).strip()
    if expected not in output:
        raise SystemExit(f"{command} version differs: got {output!r}, expected {expected}")
