"""Preflight an explicit workstation cleanup, then let the native managers apply it."""

import contextlib
import json
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from cleanup_host import DEFAULT_CLEANUP_HOST, Blocker, CleanupHost

if TYPE_CHECKING:
    import cleanup_macos as macos

MISE_PRUNE = ("mise", "prune")
MISE_CACHE_PRUNE = ("mise", "cache", "prune")


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


def parse_mise_blocker(line: str) -> Blocker:
    _, marker, detail = line.partition("is kept: still running")
    scope = detail if marker else line
    pids = tuple(dict.fromkeys(int(pid) for pid in re.findall(r"\bpid (\d+)\b", scope)))
    more_match = re.search(r"\band (\d+) more\b", scope)
    more_count = int(more_match[1]) if more_match else 0
    mise_tool: tuple[str, str] | None = None
    reason: str | None = None
    match = re.match(r"^\s*mise\s+(\S+)\s+is kept: still running\b", line)
    if match:
        spec = match[1]
        if "@" in spec:
            tool, version = spec.rsplit("@", 1)
            if tool and version:
                mise_tool = (tool, version)
                reason = spec
    return Blocker(
        message=line,
        pids=pids,
        reason=reason,
        mise_tool=mise_tool,
        more_count=more_count,
    )


@dataclass
class Plan:
    steps: list[tuple[str, ...]]
    targets: list[Path]
    references: list[str]
    processes: list[Blocker]


def _resolve_hosts(
    darwin: bool, host: CleanupHost | None
) -> tuple[CleanupHost, "macos.Host | None"]:
    if not darwin:
        return (DEFAULT_CLEANUP_HOST if host is None else host), None
    import cleanup_macos as macos

    if host is None:
        return macos.DEFAULT_HOST, macos.DEFAULT_HOST
    if not isinstance(host, macos.Host):
        raise TypeError("macOS cleanup requires a cleanup_macos.Host instance")
    return host, host


def _preflight_resolved(
    *,
    show: bool,
    effective_host: CleanupHost,
    macos_host: "macos.Host | None",
) -> Plan:
    preview = effective_host.command(*MISE_PRUNE, "--dry-run", show=show)
    processes = [
        parse_mise_blocker(line)
        for line in preview.splitlines()
        if " is kept: still running" in line
    ]
    catalog = json.loads(
        effective_host.command(
            "mise",
            "ls",
            "--prunable",
            "--json",
            stdout_only=True,
        )
    )
    installs = [
        Path(item["install_path"]) for rows in catalog.values() for item in rows
    ]
    steps: list[tuple[str, ...]] = []
    targets = list(installs)
    if macos_host is not None:
        import cleanup_macos as macos

        additions = macos.plan_additions(targets, show=show, env=macos_host)
        steps.extend(additions.steps)
        targets.extend(additions.targets)
        processes.extend(
            Blocker(
                message=item.message,
                pids=(item.pid,) if item.pid else (),
                reason=item.target,
            )
            for item in additions.blockers
        )
    return Plan(steps, targets, pipx_blockers(installs), processes)


def preflight(
    *,
    show: bool,
    darwin: bool,
    host: CleanupHost | None = None,
) -> Plan:
    effective_host, macos_host = _resolve_hosts(darwin, host)
    return _preflight_resolved(
        show=show, effective_host=effective_host, macos_host=macos_host
    )


def report(heading, issues):
    if issues:
        print(heading, file=sys.stderr)
        print("\n".join(dict.fromkeys(issues)), file=sys.stderr)


def prune(plan: Plan, *, host: CleanupHost | None = None) -> int:
    if plan.references or plan.processes:
        report(
            "Cleanup blocked; no packages were pruned:",
            [*plan.references, *(item.message for item in plan.processes)],
        )
        return 1
    effective_host = DEFAULT_CLEANUP_HOST if host is None else host
    effective_host.command(*MISE_PRUNE, "--yes", show=True)
    effective_host.command(*MISE_CACHE_PRUNE, show=True)
    for step in plan.steps:
        effective_host.command(*step, show=True)
    return 0


def worker_command() -> tuple[str, ...]:
    return (sys.executable, str(Path(__file__).resolve()), "worker")


def _apply_macos(
    profile: str,
    *,
    worker: bool,
    env: "macos.Host",
) -> int:
    import cleanup_macos as macos

    if macos.handoff_if_needed(
        profile, worker=worker, worker_command=worker_command(), env=env
    ):
        return 0
    with env.maintenance_lock():
        plan = _preflight_resolved(show=False, effective_host=env, macos_host=env)
        if plan.references:
            report("Cleanup blocked by retained environments:", plan.references)
            return 1
        maintenance = macos.plan_maintenance(plan.processes, profile, env=env)
        for line in maintenance.summary_lines():
            print(line)
        if maintenance.unknown:
            report(
                "Cleanup blocked before stopping anything; close these processes first:",
                maintenance.unknown,
            )
            return 1
        maintenance.check_replacements(plan.targets)

        if maintenance.has_actions:
            print(
                "Save open work and stop important Docker workloads first. "
                "Terminated processes and live pane jobs can be lost."
            )
            if not env.confirm(
                "Interrupt these processes/sessions/services and prune? [y/N] "
            ):
                print("Cleanup cancelled.")
                return 1

        with maintenance.paused_for_prune():
            final = _preflight_resolved(show=False, effective_host=env, macos_host=env)
            maintenance.check_replacements(final.targets)
            if prune(final, host=env):
                return 1
            if final.targets:
                remaining = _preflight_resolved(
                    show=False, effective_host=env, macos_host=env
                )
                if (
                    remaining.targets
                    or remaining.references
                    or remaining.processes
                ):
                    report(
                        "Cleanup incomplete; the following removals or blockers remain:",
                        [
                            *map(str, remaining.targets),
                            *remaining.references,
                            *(item.message for item in remaining.processes),
                        ],
                    )
                    return 1
        maintenance.refresh_deferred()
        print("Pruning verified; requested service restarts finished.")
        return 0


def cleanup(
    *,
    apply: bool,
    worker: bool = False,
    darwin: bool | None = None,
    profile: str | None = None,
    host: CleanupHost | None = None,
) -> int:
    is_darwin = sys.platform == "darwin" if darwin is None else darwin
    effective_host, macos_host = _resolve_hosts(is_darwin, host)
    selected_profile = (
        effective_host.env_get("MISE_ENV") if profile is None else profile
    )
    if macos_host is not None and selected_profile not in {
        "personal-macos",
        "work-macos",
    }:
        raise ValueError(
            "select personal-macos or work-macos before reviewing or pruning Homebrew"
        )
    if apply and macos_host is not None:
        assert selected_profile is not None
        return _apply_macos(selected_profile, worker=worker, env=macos_host)

    plan = _preflight_resolved(
        show=not apply, effective_host=effective_host, macos_host=macos_host
    )
    if apply:
        return prune(plan, host=effective_host)
    effective_host.command(*MISE_CACHE_PRUNE, "--dry-run", show=True)
    if macos_host is not None:
        import cleanup_macos as macos

        assert selected_profile is not None
        maintenance = macos.plan_maintenance(
            plan.processes, selected_profile, env=macos_host
        )
        for line in maintenance.summary_lines():
            print(line)
        try:
            maintenance.check_replacements(plan.targets)
        except ValueError as exc:
            report("Service replacements blocking cleanup:", [str(exc)])
        unknown = list(maintenance.unknown)
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
    guard: contextlib.AbstractContextManager[None] = contextlib.nullcontext()
    if mode != "plan" and sys.platform == "darwin":
        import macos_host

        guard = macos_host.interrupt_on_hangup()
    try:
        with guard:
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
