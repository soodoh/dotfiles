"""Preflight an explicit workstation cleanup, then let the native managers apply it."""

import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

import cleanup_macos as macos

MISE_PRUNE = ("mise", "prune")
MISE_CACHE_PRUNE = ("mise", "cache", "prune")
MISE_PACKAGES = ("mise", "bootstrap", "packages", "prune", "--manager")
BREW_CLEANUP = ("brew", "cleanup")
BREW_PREFIX = Path(os.environ.get("MISE_SYSTEM_BREW_PREFIX") or "/opt/homebrew")
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


@dataclass(frozen=True)
class Blocker:
    message: str
    pid: int | None = None


def open_file_blockers(targets: list[Path], open_files: str) -> list[Blocker]:
    roots = {path for target in targets for path in (target, target.resolve())}
    pid, name = 0, "?"
    matches: set[tuple[Path, int, str]] = set()
    for item in open_files.split("\0"):
        field = item.lstrip("\n")
        if field.startswith("p"):
            pid, name = int(field[1:]), "?"
        elif field.startswith("c"):
            name = field[1:]
        elif field.startswith("n/"):
            path = Path(field[1:])
            matches.update(
                (root, pid, name) for root in roots.intersection((path, *path.parents))
            )
    return [
        Blocker(f"{root} is open in {name} (PID {pid})", pid or None)
        for root, pid, name in sorted(matches)
    ]


def brew_plan(show: bool) -> tuple[list[tuple[str, ...]], list[Path]]:
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
        targets = package_targets(manager, output, BREW_PREFIX)
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


@dataclass
class Plan:
    steps: list[tuple[str, ...]]
    targets: list[Path]
    references: list[str]
    processes: list[Blocker]


def preflight(*, show: bool, darwin: bool) -> Plan:
    preview = run(*MISE_PRUNE, "--dry-run", show=show)
    processes = []
    for line in preview.splitlines():
        if " is kept: still running" in line:
            match = re.search(r"still running as pid (\d+)", line)
            processes.append(Blocker(line, int(match[1]) if match else None))
    catalog = json.loads(run("mise", "ls", "--prunable", "--json", stdout_only=True))
    installs = [
        Path(item["install_path"]) for rows in catalog.values() for item in rows
    ]
    steps, paths = brew_plan(show=show) if darwin else ([], [])
    targets = installs + paths
    if darwin and targets:
        processes.extend(open_file_blockers(targets, run(macos.LSOF, "-nP", "-F0pcn")))
    return Plan(steps, targets, pipx_blockers(installs), processes)


def report(heading, issues):
    if issues:
        print(heading, file=sys.stderr)
        print("\n".join(dict.fromkeys(issues)), file=sys.stderr)


def prune(plan):
    if plan.references or plan.processes:
        report(
            "Cleanup blocked; no packages were pruned:",
            [*plan.references, *(item.message for item in plan.processes)],
        )
        return 1
    run(*MISE_PRUNE, "--yes", show=True)
    run(*MISE_CACHE_PRUNE, show=True)
    for step in plan.steps:
        run(*step, show=True)
    return 0


def maintenance_plan(plan, profile):
    blockers = {item.pid for item in plan.processes if item.pid}
    tree = macos.process_tree()
    changes = macos.service_changes(profile, BREW_PREFIX, blockers, tree)
    fish = macos.blocking_fish(blockers, BREW_PREFIX)
    before, after = [], []
    covered = set(fish)
    for change in changes:
        if change.blocking:
            covered.update(change.pids)
    for session in macos.stale_herdr():
        pids = session.pids(tree) if blockers else set()
        if pids & blockers:
            before.append(session)
            covered.update(pids)
        else:
            after.append(session)
    unknown = [item.message for item in plan.processes if item.pid not in covered]
    return changes, before, after, fish, unknown


def show_maintenance(changes, before, after, fish):
    for change in changes:
        action = "Pause for prune" if change.blocking else "Refresh after prune"
        print(f"{action}: {change.job.target} — {change.reason}")
    for action, sessions in (
        ("Pause for prune", before),
        ("Refresh after prune", after),
    ):
        for session in sessions:
            print(f"{action}: Herdr session {session.name}")
    for pid, identity in fish.items():
        print(f"Close blocking Fish shell on {identity.split()[1]} (PID {pid})")
    if not (changes or before or after or fish):
        print("No managed services or sessions need to be stopped or restarted.")


def macos_cleanup(plan, profile):
    if plan.references:
        report("Cleanup blocked by retained environments:", plan.references)
        return 1
    changes, before, after, fish, unknown = maintenance_plan(plan, profile)
    show_maintenance(changes, before, after, fish)
    if unknown:
        report(
            "Cleanup blocked before stopping anything; close these processes first:",
            unknown,
        )
        return 1
    jobs = [change.job for change in changes if change.blocking]
    refresh = [change.job for change in changes if not change.blocking]
    programs = [program for change in changes for program in change.job.programs]
    programs.extend(session.binary for session in (*before, *after))
    if fish:
        programs.append(BREW_PREFIX / "bin/fish")
    macos.check_replacements(programs, plan.targets)

    if changes or before or after or fish:
        print(
            "Save terminal work and stop important Docker workloads first. Live pane jobs can be lost."
        )
        if input(
            "Interrupt these sessions/services and prune? [y/N] "
        ).strip().lower() not in {"y", "yes"}:
            print("Cleanup cancelled.")
            return 1
    with macos.paused(jobs, before, fish, BREW_PREFIX):
        final = preflight(show=False, darwin=True)
        macos.check_replacements(programs, final.targets)
        if prune(final):
            return 1
        if final.targets:
            remaining = preflight(show=False, darwin=True)
            if remaining.targets or remaining.references or remaining.processes:
                report(
                    "Cleanup incomplete; the following removals or blockers remain:",
                    [
                        *map(str, remaining.targets),
                        *remaining.references,
                        *(item.message for item in remaining.processes),
                    ],
                )
                return 1
    if refresh or after:
        # These processes did not need to be offline while packages were pruned.
        with macos.paused(refresh, after, {}, BREW_PREFIX):
            pass
    print("Pruning verified; requested service restarts finished.")
    return 0


def cleanup(*, apply: bool, worker: bool = False) -> int:
    darwin = sys.platform == "darwin"
    profile = os.environ.get("MISE_ENV")
    if darwin and profile not in {"personal-macos", "work-macos"}:
        raise ValueError(
            "select personal-macos or work-macos before reviewing or pruning Homebrew"
        )
    if apply and darwin:
        macos.require_local_terminal()
        if macos.needs_handoff():
            if worker:
                raise ValueError(
                    "maintenance terminal is not independent of Fish or Herdr"
                )
            macos.open_handoff(profile, BREW_PREFIX)
            return 0
        with macos.maintenance_lock():
            return macos_cleanup(preflight(show=False, darwin=True), profile)

    plan = preflight(show=not apply, darwin=darwin)
    if apply:
        return prune(plan)
    run(*MISE_CACHE_PRUNE, "--dry-run", show=True)
    if darwin:
        changes, before, after, fish, unknown = maintenance_plan(plan, profile)
        show_maintenance(changes, before, after, fish)
    else:
        unknown = [item.message for item in plan.processes]
    report("Retained environments blocking cleanup:", plan.references)
    report("Running processes that need manual attention:", unknown)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args not in (["apply"], ["plan"], ["worker"]):
        print("usage: cleanup.py apply|plan", file=sys.stderr)
        return 2
    mode = args[0]
    if mode != "plan" and sys.platform == "darwin":

        def interrupt(*_):
            raise KeyboardInterrupt

        signal.signal(signal.SIGHUP, interrupt)
        signal.signal(signal.SIGTERM, interrupt)
    try:
        return cleanup(apply=mode != "plan", worker=mode == "worker")
    except (KeyboardInterrupt, EOFError):
        print("Cleanup interrupted.", file=sys.stderr)
    except subprocess.CalledProcessError as exc:
        print(
            f"Cleanup stopped: {shlex.join(exc.cmd)} exited {exc.returncode}",
            file=sys.stderr,
        )
    except (KeyError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"Cleanup stopped: {exc}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
