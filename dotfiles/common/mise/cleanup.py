"""Preflight an explicit workstation cleanup, then let the native managers apply it."""

import json
import os
import shlex
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

MISE_PRUNE = ("mise", "prune")
MISE_CACHE_PRUNE = ("mise", "cache", "prune")
MISE_PACKAGES = ("mise", "bootstrap", "packages", "prune", "--manager")
BREW_CLEANUP = ("brew", "cleanup")
ENV = dict(
    os.environ,
    NO_COLOR="1",
    MISE_QUIET="0",
    MISE_LOG_LEVEL="info",
    HOMEBREW_NO_AUTO_UPDATE="1",
    # Mise's formula plan owns orphan removal. Don't let native cleanup add
    # an independent uninstall pass on top of that plan.
    HOMEBREW_NO_AUTOREMOVE="1",
)


def run(*command: str, show: bool = False, stdout_only: bool = False) -> str:
    result = subprocess.run(
        command, env=ENV, capture_output=True, text=True, check=False
    )
    if show or result.returncode:
        print(result.stdout, end="", flush=True)
        print(result.stderr, end="", file=sys.stderr, flush=True)
    result.check_returncode()
    return result.stdout if stdout_only else result.stdout + result.stderr


def pipx_blockers(installs: list[Path]) -> list[str]:
    python_versions = [path for path in installs if path.parent.name == "python"]
    if not python_versions:
        return []
    versions = {path.resolve() for path in python_versions}
    removing = {path.resolve() for path in installs}
    configs = {
        cfg.resolve()
        for root in {path.parent.parent for path in python_versions}
        for cfg in root.glob("pipx-*/*/*/pyvenv.cfg")
    }
    blockers = []
    for cfg in sorted(configs):
        if cfg.parent.parent in removing:
            continue  # This environment is being removed too, including any aliases.
        # Resolve aliases for symlinked interpreters, and check the base
        # interpreter recorded by virtualenvs that copy the executable.
        references = [(cfg.parent / "bin/python").resolve()]
        for line in cfg.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "home":
                references.append(Path(value.strip()).resolve())
        for reference in references:
            if versions.intersection((reference, *reference.parents)):
                blockers.append(f"{cfg.parent.parent} still uses {reference}")
                break
    return blockers


def package_targets(manager: str, output: str, prefix: Path) -> list[Path]:
    root = prefix / ("Cellar" if manager == "brew" else "Caskroom")
    marker = f"remove {manager}:"
    targets = []
    for line in output.splitlines():
        if not line.startswith(marker):
            continue
        name, version = line[len(marker) :].rsplit("@", 1)
        directory = root / name.rsplit("/", 1)[-1] / version
        if not directory.is_dir():
            raise ValueError(f"can't locate the planned removal: {directory}")
        targets.append(directory)
        if manager == "brew-cask":
            with (directory / ".mise-cask.toml").open("rb") as receipt:
                for record in tomllib.load(receipt)["targets"]:
                    targets.append(Path(record["path"]))
    if not targets and f"{manager}: nothing to prune" not in output:
        raise ValueError(f"can't read mise's {manager} prune plan")
    return targets


def brew_cleanup_targets(output: str) -> list[Path]:
    targets = []
    for line in output.splitlines():
        if line.startswith("Would remove: "):
            path, _ = line.removeprefix("Would remove: ").rsplit(" (", 1)
        elif line.startswith(
            ("Would remove (broken link): ", "Would remove (empty directory): ")
        ):
            path = line.split(": ", 1)[1]
        elif line.startswith("Would remove"):
            raise ValueError(f"can't read Brew's cleanup candidate: {line}")
        else:
            continue
        targets.append(Path(path))
    return targets


def open_file_blockers(targets: list[Path], open_files: str) -> list[str]:
    roots = {path for target in targets for path in (target, target.resolve())}
    pid = name = "?"
    matches: set[tuple[Path, str, str]] = set()
    for item in open_files.split("\0"):
        field = item.lstrip("\n")
        if field.startswith("p"):
            pid, name = field[1:], "?"
        elif field.startswith("c"):
            name = field[1:]
        elif field.startswith("n/"):
            path = Path(field[1:])
            matches.update(
                (root, pid, name) for root in roots.intersection((path, *path.parents))
            )
    return [
        f"{root} is open in {name} (PID {pid})" for root, pid, name in sorted(matches)
    ]


def brew_plan(show: bool) -> tuple[list[tuple[str, ...]], list[Path]]:
    prefix = Path(ENV.get("MISE_SYSTEM_BREW_PREFIX") or "/opt/homebrew")
    steps, paths = [], []
    # Check native cleanup first, before mise changes the set of installed kegs.
    if shutil.which("brew"):
        native = brew_cleanup_targets(run(*BREW_CLEANUP, "--dry-run", show=show))
        if native:
            paths.extend(native)
            steps.append(BREW_CLEANUP)
    for manager in ("brew-cask", "brew"):
        command = (*MISE_PACKAGES, manager)
        output = run(*command, "--dry-run", show=show)
        targets = package_targets(manager, output, prefix)
        if targets:
            paths.extend(targets)
            steps.append((*command, "--yes"))
        if not show:
            for line in output.splitlines():
                if "skipped:" in line:
                    print(line, file=sys.stderr)
    if any(not path.is_absolute() for path in paths):
        raise ValueError("Homebrew cleanup preview contained a non-absolute path")
    return steps, paths


def cleanup(*, apply: bool) -> int:
    macos = sys.platform == "darwin"
    if macos and os.environ.get("MISE_ENV") not in {"personal-macos", "work-macos"}:
        raise ValueError(
            "select personal-macos or work-macos before reviewing or pruning Homebrew"
        )

    preview = run(*MISE_PRUNE, "--dry-run", show=not apply)
    blockers = [
        line for line in preview.splitlines() if " is kept: still running" in line
    ]
    catalog = json.loads(run("mise", "ls", "--prunable", "--json", stdout_only=True))
    installs = [
        Path(item["install_path"]) for rows in catalog.values() for item in rows
    ]
    blockers.extend(pipx_blockers(installs))
    steps, paths = brew_plan(show=not apply) if macos else ([], [])
    if macos and (installs or paths):
        blockers.extend(
            open_file_blockers(installs + paths, run("lsof", "-nP", "-F0pcn"))
        )

    if not apply:
        run(*MISE_CACHE_PRUNE, "--dry-run", show=True)
    if blockers:
        print(
            "Warning: cleanup blocked; close the processes or fix the references below first:",
            file=sys.stderr,
        )
        print("\n".join(dict.fromkeys(blockers)), file=sys.stderr)
        return 1 if apply else 0
    if apply:
        run(*MISE_PRUNE, "--yes", show=True)
        run(*MISE_CACHE_PRUNE, show=True)
        for step in steps:
            run(*step, show=True)
    return 0


def main() -> int:
    if sys.argv[1:] not in (["apply"], ["plan"]):
        print("usage: cleanup.py apply|plan", file=sys.stderr)
        return 2
    try:
        return cleanup(apply=sys.argv[1] == "apply")
    except subprocess.CalledProcessError as exc:
        print(
            f"Cleanup stopped: {shlex.join(exc.cmd)} exited {exc.returncode}",
            file=sys.stderr,
        )
    except (KeyError, OSError, ValueError) as exc:
        print(f"Cleanup stopped: {exc}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
