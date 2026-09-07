"""Guard Herdr-owned plugin state; refresh the desired pin without running plugin code."""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import tomllib

CONFIG = Path(__file__).resolve().parents[3] / "mise.toml"
BRANCH = "refs/heads/main"
SHA = re.compile(r"[0-9a-f]{40}")
RELEASE = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+")


@dataclass(frozen=True)
class Plugin:
    id: str
    repo: str
    pin_key: str
    binary: str
    prerequisites: tuple[str, ...]
    systems: tuple[str, ...]

    @property
    def checkout(self):
        # Herdr 0.8.2: readable plugin ID plus the first six SHA-256 bytes.
        return f"{self.id}-{hashlib.sha256(self.id.encode()).hexdigest()[:12]}"

    @property
    def url(self):
        return f"https://github.com/{self.repo}.git"


NOTIFIER = Plugin(
    "herdr-focus-notify",
    "yankewei/herdr-focus-notify",
    "herdr_focus_notify_ref",
    "target/release/herdr-focus-notify",
    ("cargo", "alerter", "xcrun"),
    ("Darwin",),
)
SESH = Plugin(
    "fullerzz.sesh",
    "fullerzz/herdr-plugin-sesh",
    "herdr_sesh_ref",
    "bin/herdr-sesh",
    ("go",),
    ("Darwin", "Linux"),
)
PLUGINS = (SESH, NOTIFIER)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.run(
        ["git", *map(str, args)], check=True, capture_output=True, text=True, timeout=60
    ).stdout.strip()


def installed_pin(config_dir, spec):
    """Return a healthy, owned pin or None; ambiguity is never permission to replace."""
    registry = config_dir / "plugins.json"
    checkout = config_dir / "plugins/github" / spec.checkout
    # CLI plugin.list treats corrupt registries as empty; read strictly instead.
    entries = json.loads(registry.read_text()) if registry.exists() else []
    require(not registry.is_symlink(), f"symlinked registry: {registry}")
    require(isinstance(entries, list), f"malformed registry: {registry}")
    require(
        all(
            isinstance(e, dict) and isinstance(e.get("plugin_id"), str) for e in entries
        ),
        f"malformed registry entries: {registry}",
    )
    ids = [e["plugin_id"] for e in entries]
    require(len(ids) == len(set(ids)), f"duplicate plugin IDs: {registry}")
    matches = [e for e in entries if e["plugin_id"] == spec.id]
    if not matches:
        require(
            not checkout.exists() and not checkout.is_symlink(),
            f"unregistered checkout: {checkout}; inspect it manually",
        )
        return None

    entry = matches[0]
    source = entry.get("source", {})
    require(
        isinstance(source, dict)
        and source.get("kind") == "github"
        and source.get("owner") == spec.repo.split("/")[0]
        and source.get("repo") == spec.repo.split("/")[1]
        and source.get("subdir") in (None, ""),
        "linked or foreign plugin; refusing replacement",
    )
    require(
        entry.get("enabled") is True, "plugin is disabled; enable manually if desired"
    )
    require(
        not entry.get("warnings"), "plugin registry reports warnings; inspect manually"
    )
    requested = source.get("requested_ref", "")
    pin = source.get("resolved_commit", "")
    require(
        isinstance(pin, str)
        and SHA.fullmatch(pin)
        and isinstance(requested, str)
        and (requested == pin or RELEASE.fullmatch(requested)),
        "plugin is not pinned consistently; inspect manually",
    )
    for value, expected in (
        (source.get("managed_path"), checkout),
        (entry.get("plugin_root"), checkout),
        (entry.get("manifest_path"), checkout / "herdr-plugin.toml"),
    ):
        require(
            isinstance(value, str)
            and Path(value).is_absolute()
            and Path(value).resolve() == expected,
            "plugin paths do not match Herdr's managed checkout",
        )
    require(
        checkout.resolve() == checkout
        and (checkout / ".git").is_dir()
        and not (checkout / ".git").is_symlink(),
        "missing, linked or symlinked checkout",
    )
    require(
        Path(git("-C", checkout, "rev-parse", "--show-toplevel")) == checkout,
        "checkout is not its own Git repository",
    )
    require(
        git("-C", checkout, "rev-parse", "HEAD") == pin,
        "checkout HEAD differs from registry",
    )
    require(
        not git("-C", checkout, "status", "--porcelain", "--untracked-files=all"),
        "dirty plugin checkout; preserve local changes and inspect manually",
    )
    manifest = tomllib.loads((checkout / "herdr-plugin.toml").read_text())
    require(manifest.get("id") == spec.id, "unexpected plugin manifest ID")
    if requested != pin:
        # Herdr fetches a detached commit without retaining local tag refs.
        # Adoption still requires HEAD == registry commit == desired SHA in reconcile.
        require(
            requested == f"v{manifest.get('version')}",
            "requested release differs from manifest version",
        )
    binary = checkout / spec.binary
    require(
        binary.is_file() and not binary.is_symlink() and os.access(binary, os.X_OK),
        "missing/unusable plugin executable; repair manually",
    )
    return pin


def install(pin, spec):
    for command in ("herdr", "git", *spec.prerequisites):
        require(
            shutil.which(command),
            f"missing {command}; provision declared tools/platform dependencies first",
        )
    subprocess.run(
        ["herdr", "plugin", "install", spec.repo, "--ref", pin, "--yes"], check=True
    )


def reconcile(action, pin, spec):
    """Bootstrap and update both apply the committed pin to healthy owned state."""
    require(action in ("bootstrap", "update"), "unsupported reconciliation action")
    if platform.system() not in spec.systems:
        return
    if platform.system() == "Darwin":
        require(
            os.environ.get("MISE_ENV") in ("personal-macos", "work-macos"),
            "choose --env personal-macos or --env work-macos",
        )
    require(
        isinstance(pin, str) and SHA.fullmatch(pin),
        "desired plugin pin must be a full commit SHA",
    )
    config_dir = (
        Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "herdr"
    ).resolve()
    current = installed_pin(config_dir, spec)
    if current == pin:
        print(f"{spec.id}: already at {pin}")
        return
    print(f"{spec.id}: applying committed pin {current or 'absent'} -> {pin}", flush=True)
    install(pin, spec)
    require(
        installed_pin(config_dir, spec) == pin,
        "installer did not produce the desired healthy plugin state",
    )


def refresh_pin(config, spec):
    """Resolve main to a SHA; edit only the pin, without checkout/build/installation."""
    text = config.read_text()
    old = tomllib.loads(text)["vars"][spec.pin_key]
    require(
        isinstance(old, str) and SHA.fullmatch(old),
        "existing plugin pin must be a full commit SHA",
    )
    fields = git("ls-remote", "--exit-code", spec.url, BRANCH).split()
    require(
        len(fields) == 2 and SHA.fullmatch(fields[0]) and fields[1] == BRANCH,
        "expected exactly one full commit SHA for the tracked upstream branch",
    )
    new = fields[0]
    if old == new:
        print(f"{spec.id}: pin unchanged")
        return
    updated, count = re.subn(
        rf'(?m)^({spec.pin_key}\s*=\s*)"{old}"', lambda m: f'{m[1]}"{new}"', text
    )
    require(count == 1, "expected exactly one plugin pin declaration")
    config.write_text(updated)
    print(f"{spec.id}: https://github.com/{spec.repo}/compare/{old}...{new}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("bootstrap", "update", "refresh-pin"))
    args = parser.parse_args()
    pins = tomllib.loads(CONFIG.read_text())["vars"]
    for spec in PLUGINS:
        if args.action == "refresh-pin":
            refresh_pin(CONFIG, spec)
        else:
            reconcile(args.action, pins[spec.pin_key], spec)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        sys.exit(f"Herdr plugin: {error}")
