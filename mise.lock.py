import argparse
import os
import re
import shutil
import stat
import subprocess
import tempfile
import tomllib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from mise_resolution import (
    LockRecords,
    ToolRequest,
    platform_artifact,
    read_tool_declarations,
    resolve_profile_declarations,
    validate_http_lock_urls,
)

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
PROFILE_LOCKS = {
    "personal-macos": "mise.personal-macos.lock",
    "work-macos": "mise.work-macos.lock",
}
UNSUPPORTED_TOOLS = {
    "personal-macos": ("http:gcloud",),
    "work-macos": ("http:twg",),
}
PLATFORMS = "linux-x64,linux-arm64,macos-x64,macos-arm64"
# Atuin no longer publishes Intel macOS binaries; its other targets remain required.
UNAVAILABLE_ARCHIVES = {"aqua:atuinsh/atuin": {"macos-x64"}}
LOCKED_CONFIG = "[tool_config]\nlocked = true"
UNLOCKED_CONFIG = "[tool_config]\nlocked = false"
MISE_CONFIG_ENVIRONMENT = {
    "MISE_CONFIG_DIR",
    "MISE_CONFIG_FILE",
    "MISE_DEFAULT_CONFIG_FILENAME",
    "MISE_ENV",
    "MISE_GLOBAL_CONFIG_FILE",
    "MISE_OVERRIDE_CONFIG_FILENAMES",
    "MISE_SYSTEM_CONFIG_FILE",
    "MISE_TRUSTED_CONFIG_PATHS",
}


def mise_environment(root: Path) -> dict[str, str]:
    environment = os.environ.copy()
    for name in MISE_CONFIG_ENVIRONMENT:
        environment.pop(name, None)
    # Keep workstation tools/profiles out of staged generation, but retain the
    # shared settings-only config so gh authentication still works without Fish.
    environment["MISE_CONFIG_DIR"] = str(root / ".mise-global")
    environment["MISE_GLOBAL_CONFIG_FILE"] = str(
        ROOT / "dotfiles/common/mise/config.toml"
    )
    environment["MISE_ENV"] = ""
    environment["MISE_SAFE"] = "1"
    environment["MISE_TRUSTED_CONFIG_PATHS"] = str(root)
    environment["MISE_YES"] = "1"
    return environment


def run_mise(root: Path, *arguments: str) -> None:
    mise = shutil.which("mise")
    if mise is None:
        raise RuntimeError("mise must be available to refresh lockfiles")
    subprocess.run(
        [mise, "--cd", str(root), *arguments],
        cwd=root,
        env=mise_environment(root),
        check=True,
    )


def set_tool_locking(root: Path, *, locked: bool) -> None:
    config = root / "mise.toml"
    original = config.read_text()
    expected = UNLOCKED_CONFIG if locked else LOCKED_CONFIG
    replacement = LOCKED_CONFIG if locked else UNLOCKED_CONFIG
    if original.count(expected) != 1:
        state = "unlocked" if locked else "locked"
        raise RuntimeError(
            f"mise.toml must contain exactly one {state} tool configuration"
        )
    config.write_text(original.replace(expected, replacement, 1))


@contextmanager
def staged_repository(root: Path):
    with tempfile.TemporaryDirectory(prefix="mise-lock-stage-") as directory:
        stage = Path(directory)
        for name in (*CONFIG_FILES, *LOCK_FILES):
            source = root / name
            if source.exists():
                shutil.copy2(source, stage / name)
        yield stage


def generate_profile_lockfiles(root: Path, profile: str) -> dict[str, bytes]:
    profile_lock = PROFILE_LOCKS[profile]
    with tempfile.TemporaryDirectory(prefix=f"mise-lock-{profile}-") as directory:
        generation_root = Path(directory)
        for name in ("mise.toml", f"mise.{profile}.toml", "mise.lock", profile_lock):
            source = root / name
            if source.exists():
                shutil.copy2(source, generation_root / name)
        set_tool_locking(generation_root, locked=False)
        run_mise(
            generation_root,
            "--env",
            profile,
            "lock",
            "--quiet",
            "--platform",
            PLATFORMS,
        )
        return {
            "mise.lock": (generation_root / "mise.lock").read_bytes(),
            profile_lock: (generation_root / profile_lock).read_bytes(),
        }


def merge_profile_lockfiles(
    results: dict[str, dict[str, bytes]],
) -> dict[str, bytes]:
    personal_shared = results["personal-macos"]["mise.lock"]
    work_shared = results["work-macos"]["mise.lock"]
    if personal_shared != work_shared:
        raise RuntimeError(
            "personal-macos and work-macos generated different shared mise.lock files"
        )
    return {
        "mise.lock": personal_shared,
        "mise.personal-macos.lock": results["personal-macos"][
            "mise.personal-macos.lock"
        ],
        "mise.work-macos.lock": results["work-macos"]["mise.work-macos.lock"],
    }


def generate_lockfiles(root: Path) -> dict[str, bytes]:
    with ThreadPoolExecutor(max_workers=len(PROFILES)) as executor:
        futures = {
            profile: executor.submit(generate_profile_lockfiles, root, profile)
            for profile in PROFILES
        }
        results = {profile: futures[profile].result() for profile in PROFILES}
    candidates = merge_profile_lockfiles(results)
    validate_toml_candidates(candidates)
    return candidates


def validate_toml_candidates(candidates: dict[str, bytes]) -> None:
    for name, content in candidates.items():
        try:
            tomllib.loads(content.decode())
        except (UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
            raise RuntimeError(f"generated {name} is not valid TOML") from error


def plan_changes(
    root: Path, candidates: dict[str, bytes], names: tuple[str, ...]
) -> tuple[str, ...]:
    return tuple(
        name
        for name in names
        if not (root / name).exists() or (root / name).read_bytes() != candidates[name]
    )


def atomic_replace(path: Path, content: bytes) -> None:
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=f".{path.name}.", delete=False
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, path)
        temporary_name = None
    finally:
        if temporary_name is not None:
            Path(temporary_name).unlink(missing_ok=True)


def publish_candidates(
    root: Path, candidates: dict[str, bytes], names: tuple[str, ...]
) -> tuple[str, ...]:
    selected = {name: candidates[name] for name in names}
    validate_toml_candidates(selected)
    changed = plan_changes(root, candidates, names)
    for name in changed:
        atomic_replace(root / name, candidates[name])
    return changed


def refresh_lockfiles(root: Path) -> None:
    candidates = generate_lockfiles(root)
    publish_candidates(root, candidates, LOCK_FILES)


def configured_tools(root: Path, profile: str) -> tuple[str, ...]:
    tools: dict[str, None] = {}
    for config_name in ("mise.toml", f"mise.{profile}.toml"):
        with (root / config_name).open("rb") as config_file:
            for tool in tomllib.load(config_file).get("tools", {}):
                tools[tool] = None
    return tuple(tools)


def finalize_staged_update(root: Path, stage: Path) -> None:
    set_tool_locking(stage, locked=True)
    lock_candidates = generate_lockfiles(stage)
    candidates = {
        **{name: (stage / name).read_bytes() for name in CONFIG_FILES},
        **lock_candidates,
    }
    publish_candidates(root, candidates, (*CONFIG_FILES, *LOCK_FILES))


def update_tools(root: Path) -> None:
    with staged_repository(root) as stage:
        set_tool_locking(stage, locked=False)
        for profile in PROFILES:
            run_mise(
                stage,
                "--env",
                profile,
                "upgrade",
                "--bump",
                *configured_tools(stage, profile),
            )
        finalize_staged_update(root, stage)


def update_unsupported_tools(root: Path) -> None:
    with staged_repository(root) as stage:
        set_tool_locking(stage, locked=False)
        for profile, tools in UNSUPPORTED_TOOLS.items():
            run_mise(stage, "--env", profile, "upgrade", "--bump", *tools)
        finalize_staged_update(root, stage)


def read_validation_input(root: Path, name: str) -> dict:
    try:
        with (root / name).open("rb") as stream:
            return tomllib.load(stream)
    except (OSError, ValueError) as error:
        raise ValueError(f"{name}: {error}") from error


def validate_archive_entries(
    name: str, tools: dict[str, list[dict]],
    declarations: dict[str, list[ToolRequest]],
    matches: dict[tuple[str, str], list[ToolRequest]],
) -> None:
    for tool, entries in tools.items():
        for entry in entries:
            backend, version = entry["backend"], entry["version"]
            context = f"{name}: {tool}@{version}"
            # For a locked version, require the platforms of its matched requests.
            # Unreferenced entries retain tool-wide scope; private runtimes have
            # no direct declarations and must cover every repository target.
            archive_backend = backend.split(":", 1)[0] in {"aqua", "github", "http"}
            if archive_backend or backend in {
                "core:node", "core:python", "core:ruby", "core:go", "core:bun",
            }:
                requests = matches.get((tool, version), declarations.get(tool))
                for platform in PLATFORMS.split(","):
                    if requests is not None and not any(
                        request.supports_os(platform.split("-", 1)[0]) for request in requests
                    ):
                        continue
                    artifact = platform_artifact(entry, platform)
                    if artifact is None and platform in UNAVAILABLE_ARCHIVES.get(tool, set()):
                        continue
                    if not isinstance(artifact, dict):
                        raise TypeError(f"{context}: missing {platform} archive")
                    location = f"{context}: {platform}"
                    url = artifact.get("url")
                    if not isinstance(url, str) or urlsplit(url).scheme != "https" or not urlsplit(url).netloc:
                        raise ValueError(f"{location}: url must be an absolute HTTPS URL")
                    checksum = artifact.get("checksum")
                    if not isinstance(checksum, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", checksum):
                        raise ValueError(f"{location}: checksum must be a SHA-256 digest")
                    if "provenance" in artifact and (
                        not isinstance(artifact["provenance"], str) or not artifact["provenance"]
                    ):
                        raise ValueError(f"{location}: provenance must be a nonempty string")


def check_lockfiles(root: Path) -> None:
    # Validity is independent of today's upstream metadata. Refreshing all
    # artifacts here made unrelated PRs fail when Python published another
    # standalone build for an already-pinned version.
    try:
        configs = {name: read_validation_input(root, name) for name in CONFIG_FILES}
        if configs["mise.toml"].get("tool_config", {}).get("locked") is not True:
            raise ValueError("mise.toml: tool_config.locked must be true for lock validation")
        declarations = {
            name: read_tool_declarations(config.get("tools", {}), name)
            for name, config in configs.items()
        }
        records = {
            name: LockRecords(name, read_validation_input(root, name))
            for name in LOCK_FILES
        }
        locks = {name: lock.checked_tools() for name, lock in records.items()}
        matches = {name: {} for name in LOCK_FILES}
        with staged_repository(root) as stage:
            for profile in (None, *PROFILES):
                resolution = resolve_profile_declarations(
                    stage, configs, declarations, profile=profile, locks=locks
                )
                for match in resolution.matches:
                    requests = matches[match.lock_name].setdefault(
                        (match.tool, match.version), []
                    )
                    if match.request not in requests:
                        requests.append(match.request)
        platforms = PLATFORMS.split(",")
        for name, tools in locks.items():
            source = name.replace(".lock", ".toml")
            validate_archive_entries(name, tools, declarations[source], matches[name])
            # Native resolution checks HTTP options but ignores declared URLs.
            for (tool, version), requests in matches[name].items():
                if tool.startswith("http:"):
                    entries = records[name].matching(tool, version)
                    for request in requests:
                        validate_http_lock_urls(
                            source, tool, request, version, entries, platforms
                        )
    except (ValueError, TypeError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(
            f"mise lock validation failed:\n{error}\n"
            "After intentional tool changes, run `python3 mise.lock.py refresh` on Linux "
            "and commit the updated locks."
        ) from error
    print("mise locks match configuration and contain required download metadata")


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
