"""Refresh committed TWG skills from the mise-pinned CLI; never run workstation setup."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROVENANCE = "twg-skills.json"


def pinned_version(root: Path) -> str:
    config = tomllib.loads((root / "mise.work-macos.toml").read_text())
    return config["tools"]["http:twg"]["version"]


def is_twg(name: str) -> bool:
    return name == "twg" or name.startswith("twg-")


def skill_directories(catalog: Path) -> list[Path]:
    directories = sorted(path for path in catalog.iterdir() if is_twg(path.name))
    for path in directories:
        if path.is_symlink() or not path.is_dir():
            raise ValueError(f"TWG skill must be an ordinary directory: {path}")
    return directories


def snapshot(catalog: Path, version: str) -> dict:
    directories = skill_directories(catalog)
    if not directories or not any(path.name == "twg" for path in directories):
        raise ValueError("TWG export is missing its root skill")
    digest = hashlib.sha256()
    for directory in directories:
        skill = directory / "SKILL.md"
        if skill.is_symlink() or not skill.is_file():
            raise ValueError(f"Missing or unsafe skill file: {skill}")
        content = skill.read_text()
        header = content.split("---", 2)
        if (
            not content.startswith("---\n")
            or len(header) != 3
            or not re.search(
                rf"^name:\s*{re.escape(directory.name)}\s*$", header[1], re.MULTILINE
            )
        ):
            raise ValueError(f"Missing or mismatched skill frontmatter: {skill}")
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"TWG export contains a symlink: {path}")
            if path.is_file():
                relative = path.relative_to(catalog).as_posix().encode()
                content = path.read_bytes()
                digest.update(len(relative).to_bytes(8, "big") + relative)
                digest.update(len(content).to_bytes(8, "big") + content)
    return {
        "schema": 1,
        "version": version,
        "skills": [path.name for path in directories],
        "sha256": digest.hexdigest(),
    }


def check(root: Path) -> None:
    agents = root / "dotfiles/work/agents"
    recorded = json.loads((agents / PROVENANCE).read_text())
    if recorded != snapshot(agents / "skills", pinned_version(root)):
        raise ValueError(
            "TWG skill snapshot does not match its pinned version or recorded contents; "
            "run mise --env work-macos run update:twg-skills"
        )


def refresh(root: Path, executable: str | None = None) -> bool:
    agents = root / "dotfiles/work/agents"
    catalog = agents / "skills"
    version = pinned_version(root)
    try:
        check(root)
    except (FileNotFoundError, ValueError):
        pass
    else:
        return False
    executable = executable or shutil.which("twg")
    if not executable:
        raise ValueError(
            "Install the pinned CLI first: mise --env work-macos install http:twg"
        )
    executable = str(Path(executable).resolve())
    # Isolate both the working directory and HOME. No workstation credentials,
    # proxy settings, setup, login, upgrade, or scheduled upkeep reach the exporter.
    with tempfile.TemporaryDirectory(prefix="twg-skills-") as temporary:
        stage = Path(temporary)
        home = stage / "home"
        home.mkdir()
        environment = {
            "HOME": str(home),
            "XDG_CONFIG_HOME": str(home / ".config"),
            "PATH": os.defpath,
            "CI": "1",
            "NO_COLOR": "1",
            "TWG_AGENT_DEFAULTS": "1",
        }

        def run(*arguments: str) -> str:
            return subprocess.run(
                [executable, *arguments],
                cwd=stage,
                env=environment,
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            ).stdout.strip()

        actual = run("--version")
        if actual != version:
            raise ValueError(
                f"TWG version mismatch: expected {version}, found {actual}"
            )
        run("skills", "install", "--local", "--yes", "--no-prune")
        exported = stage / ".agents/skills"
        # Validate before deleting install metadata or touching the live catalog.
        snapshot(exported, version)
        for directory in skill_directories(exported):
            metadata = directory / ".twg-install.json"
            installed = json.loads(metadata.read_text())
            if installed["installedVersion"] != version:
                raise ValueError(f"Exported skill version mismatch: {directory.name}")
            metadata.unlink()  # Contains absolute paths and wall-clock timestamps.
        provenance = snapshot(exported, version)
        previous = skill_directories(catalog)
        # Prepare every byte before moving existing skills. Publish with same-
        # filesystem renames and restore the prior snapshot on ordinary I/O errors.
        with tempfile.TemporaryDirectory(
            prefix=".twg-skills-", dir=agents
        ) as publication:
            publication = Path(publication)
            prepared = publication / "new"
            shutil.copytree(exported, prepared)
            backup = publication / "previous"
            backup.mkdir()
            record = publication / PROVENANCE
            record.write_text(json.dumps(provenance, indent=2) + "\n")
            saved = []
            published = []
            try:
                for directory in previous:
                    directory.rename(backup / directory.name)
                    saved.append(directory.name)
                for directory in skill_directories(prepared):
                    directory.rename(catalog / directory.name)
                    published.append(directory.name)
                record.replace(agents / PROVENANCE)
            except OSError:
                for name in published:
                    shutil.rmtree(catalog / name)
                for name in saved:
                    (backup / name).rename(catalog / name)
                raise
    check(root)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "refresh"))
    action = parser.parse_args().action
    try:
        if action == "check":
            check(ROOT)
            print("TWG skills match the pinned CLI and recorded snapshot")
        else:
            changed = refresh(ROOT)
            print(
                "TWG skills refreshed"
                if changed
                else "TWG skills already match the pinned CLI"
            )
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"TWG skills: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
