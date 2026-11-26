"""Preflight an explicit workstation cleanup, then let the native managers apply it."""

import json
import os
import re
import shlex
import signal
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

MISE_PRUNE = ("mise", "prune")
MISE_CACHE_PRUNE = ("mise", "cache", "prune")


def cleanup_env(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    base = dict(os.environ if environ is None else environ)
    base.update(
        NO_COLOR="1",
        MISE_QUIET="0",
        MISE_LOG_LEVEL="info",
        HOMEBREW_NO_AUTO_UPDATE="1",
        # Mise's formula plan owns orphan removal. Don't let native cleanup add
        # an independent uninstall pass on top of that plan.
        HOMEBREW_NO_AUTOREMOVE="1",
    )
    return base


def run(
    *command: str,
    show: bool = False,
    stdout_only: bool = False,
    runner=subprocess.run,
    environ: Mapping[str, str] | None = None,
) -> str:
    result = runner(
        command,
        env=cleanup_env(environ),
        capture_output=True,
        text=True,
        check=False,
    )
    if show or result.returncode:
        print(result.stdout, end="", flush=True)
        print(result.stderr, end="", file=sys.stderr, flush=True)
    result.check_returncode()
    return result.stdout if stdout_only else result.stdout + result.stderr


def _command_context(runner, macos_host):
    effective_runner = (
        runner
        if runner is not None
        else (macos_host.run if macos_host is not None else subprocess.run)
    )
    effective_environ = macos_host.environ if macos_host is not None else None
    return effective_runner, effective_environ


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


def preflight(
    *,
    show: bool,
    darwin: bool,
    runner=None,
    macos_host=None,
) -> Plan:
    effective_runner, effective_environ = _command_context(runner, macos_host)
    preview = run(
        *MISE_PRUNE,
        "--dry-run",
        show=show,
        runner=effective_runner,
        environ=effective_environ,
    )
    processes = []
    for line in preview.splitlines():
        if " is kept: still running" in line:
            match = re.search(r"still running as pid (\d+)", line)
            processes.append(Blocker(line, int(match[1]) if match else None))
    catalog = json.loads(
        run(
            "mise",
            "ls",
            "--prunable",
            "--json",
            stdout_only=True,
            runner=effective_runner,
            environ=effective_environ,
        )
    )
    installs = [
        Path(item["install_path"]) for rows in catalog.values() for item in rows
    ]
    steps: list[tuple[str, ...]] = []
    targets = list(installs)
    if darwin:
        import cleanup_macos as macos

        env = macos.DEFAULT_HOST if macos_host is None else macos_host
        additions = macos.plan_additions(targets, show=show, env=env)
        steps.extend(additions.steps)
        targets.extend(additions.targets)
        processes.extend(
            Blocker(message, pid) for message, pid in additions.blockers
        )
    return Plan(steps, targets, pipx_blockers(installs), processes)


def report(heading, issues):
    if issues:
        print(heading, file=sys.stderr)
        print("\n".join(dict.fromkeys(issues)), file=sys.stderr)


def prune(plan: Plan, *, runner=None, macos_host=None) -> int:
    if plan.references or plan.processes:
        report(
            "Cleanup blocked; no packages were pruned:",
            [*plan.references, *(item.message for item in plan.processes)],
        )
        return 1
    effective_runner, effective_environ = _command_context(runner, macos_host)
    run(*MISE_PRUNE, "--yes", show=True, runner=effective_runner, environ=effective_environ)
    run(*MISE_CACHE_PRUNE, show=True, runner=effective_runner, environ=effective_environ)
    for step in plan.steps:
        run(*step, show=True, runner=effective_runner, environ=effective_environ)
    return 0


def worker_command() -> tuple[str, ...]:
    return (sys.executable, str(Path(__file__).resolve()), "worker")


def _apply_macos(
    profile: str,
    *,
    worker: bool,
    runner,
    macos_host,
) -> int:
    import cleanup_macos as macos

    env = macos.DEFAULT_HOST if macos_host is None else macos_host
    if macos.handoff_if_needed(
        profile, worker=worker, worker_command=worker_command(), env=env
    ):
        return 0
    with env.maintenance_lock():
        plan = preflight(show=False, darwin=True, runner=runner, macos_host=env)
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
                "Save terminal work and stop important Docker workloads first. Live pane jobs can be lost."
            )
            if not env.confirm(
                "Interrupt these sessions/services and prune? [y/N] "
            ):
                print("Cleanup cancelled.")
                return 1

        with maintenance.paused_for_prune():
            final = preflight(
                show=False, darwin=True, runner=runner, macos_host=env
            )
            maintenance.check_replacements(final.targets)
            if prune(final, runner=runner, macos_host=env):
                return 1
            if final.targets:
                remaining = preflight(
                    show=False, darwin=True, runner=runner, macos_host=env
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
    runner=None,
    macos_host=None,
) -> int:
    is_darwin = sys.platform == "darwin" if darwin is None else darwin
    selected_profile = (
        (
            macos_host.env_get("MISE_ENV")
            if macos_host is not None
            else os.environ.get("MISE_ENV")
        )
        if profile is None
        else profile
    )
    if is_darwin and selected_profile not in {"personal-macos", "work-macos"}:
        raise ValueError(
            "select personal-macos or work-macos before reviewing or pruning Homebrew"
        )
    if apply and is_darwin:
        assert selected_profile is not None
        return _apply_macos(
            selected_profile, worker=worker, runner=runner, macos_host=macos_host
        )

    plan = preflight(
        show=not apply, darwin=is_darwin, runner=runner, macos_host=macos_host
    )
    if apply:
        return prune(plan, runner=runner, macos_host=macos_host)
    effective_runner, effective_environ = _command_context(runner, macos_host)
    run(
        *MISE_CACHE_PRUNE,
        "--dry-run",
        show=True,
        runner=effective_runner,
        environ=effective_environ,
    )
    if is_darwin:
        import cleanup_macos as macos

        assert selected_profile is not None
        env = macos.DEFAULT_HOST if macos_host is None else macos_host
        maintenance = macos.plan_maintenance(plan.processes, selected_profile, env=env)
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
