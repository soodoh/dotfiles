import argparse
import os
import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parent
CONFIG_FILES = (
    "mise.toml",
    "mise.personal-macos.toml",
    "mise.work-macos.toml",
)
LOCK_FILES = (
    "mise.lock",
    "mise.personal-macos.lock",
    "mise.work-macos.lock",
)
PROFILES = ("personal-macos", "work-macos")
UNSUPPORTED_TOOLS = {"work-macos": ("http:twg",)}
PLATFORMS = "linux-x64,linux-arm64,macos-x64,macos-arm64"
LOCKED_CONFIG = "[tool_config]\nlocked = true"
UNLOCKED_CONFIG = "[tool_config]\nlocked = false"


def mise_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("MISE_ENV", None)
    environment["MISE_SAFE"] = "1"
    environment["MISE_YES"] = "1"
    return environment


def run_mise(root: Path, *arguments: str) -> None:
    mise = shutil.which("mise")
    if mise is None:
        raise RuntimeError("mise must be available to refresh lockfiles")
    subprocess.run(
        [mise, "--cd", str(root), *arguments],
        cwd=root,
        env=mise_environment(),
        check=True,
    )


@contextmanager
def unlocked_tool_config(root: Path) -> Iterator[None]:
    config = root / "mise.toml"
    original = config.read_text()
    if original.count(LOCKED_CONFIG) != 1:
        raise RuntimeError(
            "mise.toml must contain exactly one locked tool configuration"
        )
    config.write_text(original.replace(LOCKED_CONFIG, UNLOCKED_CONFIG, 1))
    try:
        yield
    finally:
        current = config.read_text()
        if current.count(UNLOCKED_CONFIG) != 1:
            config.write_text(original)
            raise RuntimeError("failed to restore locked tool configuration safely")
        config.write_text(current.replace(UNLOCKED_CONFIG, LOCKED_CONFIG, 1))


def lock_profiles(root: Path) -> None:
    for profile in PROFILES:
        run_mise(
            root,
            "--env",
            profile,
            "lock",
            "--quiet",
            "--platform",
            PLATFORMS,
        )


def refresh_lockfiles(root: Path) -> None:
    with unlocked_tool_config(root):
        lock_profiles(root)


def configured_tools(root: Path, profile: str) -> tuple[str, ...]:
    tools: dict[str, None] = {}
    for config_name in ("mise.toml", f"mise.{profile}.toml"):
        with (root / config_name).open("rb") as config_file:
            for tool in tomllib.load(config_file).get("tools", {}):
                tools[tool] = None
    return tuple(tools)


def update_tools(root: Path) -> None:
    with unlocked_tool_config(root):
        for profile in PROFILES:
            run_mise(
                root,
                "--env",
                profile,
                "upgrade",
                "--bump",
                *configured_tools(root, profile),
            )
        lock_profiles(root)


def update_unsupported_tools(root: Path) -> None:
    with unlocked_tool_config(root):
        for profile, tools in UNSUPPORTED_TOOLS.items():
            run_mise(root, "--env", profile, "upgrade", "--bump", *tools)
        lock_profiles(root)


def check_lockfiles(root: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="mise-lock-check-") as temporary_directory:
        temporary_root = Path(temporary_directory)
        for name in (*CONFIG_FILES, *LOCK_FILES):
            shutil.copy2(root / name, temporary_root / name)
        refresh_lockfiles(temporary_root)
        stale = [
            name
            for name in LOCK_FILES
            if (root / name).read_bytes() != (temporary_root / name).read_bytes()
        ]
    if stale:
        formatted = "\n".join(f"  - {name}" for name in stale)
        raise SystemExit(
            "mise lockfiles are stale or not reproducible on the canonical Linux runner:\n"
            f"{formatted}\n"
            "Run `python3 mise.lock.py refresh` on Linux or dispatch the Repository updates workflow."
        )
    print("mise lockfiles are reproducible")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Update and verify repository mise lockfiles"
    )
    parser.add_argument(
        "action", choices=("check", "refresh", "update", "update-unsupported")
    )
    arguments = parser.parse_args()
    if arguments.action == "check":
        check_lockfiles(ROOT)
    elif arguments.action == "refresh":
        refresh_lockfiles(ROOT)
    elif arguments.action == "update-unsupported":
        update_unsupported_tools(ROOT)
    else:
        update_tools(ROOT)


if __name__ == "__main__":
    main()
