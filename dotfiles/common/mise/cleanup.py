"""Preflight an explicit workstation cleanup, then let the native managers apply it."""

import json
import os
import re
import shlex
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

MISE_PRUNE = ("mise", "prune")
MISE_CACHE_PRUNE = ("mise", "cache", "prune")
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


@dataclass(frozen=True)
class Blocker:
    message: str
    pid: int | None = None


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
    plan = Plan([], installs, pipx_blockers(installs), processes)
    if darwin:
        import cleanup_macos as macos

        macos.extend_plan(plan, show=show, run_command=run, blocker_factory=Blocker)
    return plan


def report(heading, issues):
    if issues:
        print(heading, file=sys.stderr)
        print("\n".join(dict.fromkeys(issues)), file=sys.stderr)


def prune(plan: Plan) -> int:
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


def worker_command() -> tuple[str, ...]:
    return (sys.executable, str(Path(__file__).resolve()), "worker")


def cleanup(*, apply: bool, worker: bool = False) -> int:
    darwin = sys.platform == "darwin"
    profile = os.environ.get("MISE_ENV")
    if darwin and profile not in {"personal-macos", "work-macos"}:
        raise ValueError(
            "select personal-macos or work-macos before reviewing or pruning Homebrew"
        )
    if apply and darwin:
        import cleanup_macos as macos

        return macos.run_cleanup(
            profile,
            worker=worker,
            worker_command=worker_command(),
            preflight=lambda show=False: preflight(show=show, darwin=True),
            prune=prune,
            report=report,
        )

    plan = preflight(show=not apply, darwin=darwin)
    if apply:
        return prune(plan)
    run(*MISE_CACHE_PRUNE, "--dry-run", show=True)
    if darwin:
        import cleanup_macos as macos

        unknown = macos.preview_cleanup(plan, profile, report=report)
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
