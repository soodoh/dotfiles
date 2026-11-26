"""Install and refresh the protected macOS Tailscale daemon."""

import hashlib
import json
import os
import plistlib
import re
import signal
import stat
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import macos_host as host

LABEL = "dev.dotfiles.tailscaled"
DAEMON_DIR = Path("/Library/Application Support/dotfiles-tailscale")
DAEMON = DAEMON_DIR / "tailscaled"
NEXT = DAEMON_DIR / "tailscaled.next"
PREVIOUS = DAEMON_DIR / "tailscaled.previous"
PLIST = Path(f"/Library/LaunchDaemons/{LABEL}.plist")
STAGED_PLIST = DAEMON_DIR / PLIST.name
SOURCE_PLIST = host.REPO / "dotfiles/macos/tailscale" / PLIST.name
INSTALL = "/usr/bin/install"
TEE = "/usr/bin/tee"
SUDO = "/usr/bin/sudo"


def authorize(commands):
    subprocess.run((SUDO, "-v"), check=True)
    for command in dict.fromkeys(commands):
        subprocess.run(
            (SUDO, "-n", "-l", "--", *command), check=True, stdout=subprocess.DEVNULL
        )


def root(command, data=None):
    subprocess.run(
        (SUDO, *command),
        input=data,
        stdout=subprocess.DEVNULL if data is not None else None,
        timeout=120,
        check=True,
    )


def confirm(message):
    if input(message + " [y/N] ").strip().lower() not in {"y", "yes"}:
        raise ValueError("cancelled; no services changed")


def launch(*args):
    return (host.LAUNCHCTL, *args)


def install(source, target, mode="0755"):
    return (
        INSTALL,
        "-S",
        "-o",
        "root",
        "-g",
        "wheel",
        "-m",
        mode,
        str(source),
        str(target),
    )


def remove(path):
    return ("/bin/rm", "-f", str(path))


def move(source, dest):
    return ("/bin/mv", "-f", str(source), str(dest))


@dataclass(frozen=True)
class Paths:
    daemon_dir: Path = DAEMON_DIR
    plist: Path = PLIST
    source_plist: Path = SOURCE_PLIST
    protected_parents: tuple[Path, ...] | None = None

    @property
    def daemon(self) -> Path:
        return self.daemon_dir / "tailscaled"

    @property
    def next(self) -> Path:
        return self.daemon_dir / "tailscaled.next"

    @property
    def previous(self) -> Path:
        return self.daemon_dir / "tailscaled.previous"

    @property
    def staged_plist(self) -> Path:
        return self.daemon_dir / self.plist.name

    @property
    def parents_to_check(self) -> tuple[Path, ...]:
        if self.protected_parents is not None:
            return self.protected_parents
        return tuple(reversed(self.daemon_dir.parents))


@dataclass(frozen=True)
class Host:
    paths: Paths = Paths()
    probe: Callable[..., subprocess.CompletedProcess[str]] = host.probe
    authorize: Callable[[list[tuple[str, ...]]], None] = authorize
    root: Callable[[tuple[str, ...], bytes | None], None] = root
    require_local_terminal: Callable[[], None] = host.require_local_terminal
    confirm: Callable[[str], None] = confirm
    wait_for: Callable[..., None] = host.wait_for
    owner_uid: int = 0
    check_writable: bool = True


DEFAULT_HOST = Host()


def protected(
    path: Path,
    *,
    directory: bool = False,
    optional: bool = False,
    env: Host = DEFAULT_HOST,
) -> bool:
    """Refuse symlinks and paths that could be changed without root."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        if optional:
            return False
        raise
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    writable = env.check_writable and os.access(path, os.W_OK)
    if (
        not kind(info.st_mode)
        or info.st_uid != env.owner_uid
        or info.st_mode & 0o022
        or writable
    ):
        raise ValueError(
            f"{path} is not a protected root-owned {'directory' if directory else 'file'}"
        )
    return True


def digest(path: Path) -> bytes:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").digest()


def validate_plist(contents: bytes, *, daemon_path: Path = DAEMON) -> dict:
    config = plistlib.loads(contents)
    if config != {
        "Label": LABEL,
        "ProgramArguments": [str(daemon_path)],
        "RunAtLoad": True,
        "KeepAlive": True,
    }:
        raise ValueError("the system plist must run only the protected daemon binary")
    return config


def live_version(cli: Path, *, env: Host = DEFAULT_HOST):
    result = env.probe(str(cli), "version", "--json", "--daemon")
    return None if result.returncode else json.loads(result.stdout).get("daemonLong")


def disabled(job: host.LaunchdJob, *, env: Host = DEFAULT_HOST) -> bool:
    output = host.checked(env.probe(*launch("print-disabled", job.domain)))
    return bool(
        re.search(
            rf'^\s*"{re.escape(job.label)}"\s*=>\s*disabled\s*$', output, re.MULTILINE
        )
    )


@dataclass(frozen=True)
class Candidate:
    prefix: Path
    source: Path
    binary: bytes
    plist: bytes
    version: str

    @property
    def cli(self):
        return self.prefix / "bin/tailscale"

    @property
    def binary_hash(self):
        return hashlib.sha256(self.binary).digest()

    def verify(self, job: host.LaunchdJob, *, env: Host = DEFAULT_HOST):
        env.wait_for(
            lambda: (
                job.pid(probe_fn=env.probe) is not None
                and live_version(self.cli, env=env) == self.version
            ),
            f"{job.target} to report {self.version}",
            timeout=25,
        )


def load_candidate(*, env: Host = DEFAULT_HOST) -> Candidate:
    prefix = Path(host.checked(env.probe("brew", "--prefix")).strip())
    source = (prefix / "opt/tailscale/bin/tailscaled").resolve(strict=True)
    relative = source.relative_to(prefix.resolve() / "Cellar/tailscale")
    if (
        not prefix.is_absolute()
        or relative.parts[1:] != ("bin", "tailscaled")
        or not source.is_file()
    ):
        raise ValueError(f"not an installed Homebrew Tailscale daemon: {source}")
    binary = source.read_bytes()
    version = re.search(
        r"^\s*long version:\s*(\S+)\s*$",
        host.checked(env.probe(str(source), "--version")),
        re.MULTILINE,
    )
    if not version:
        raise ValueError(f"cannot read the version of {source}")
    cli = prefix / "bin/tailscale"
    if (
        json.loads(host.checked(env.probe(str(cli), "version", "--json")))["long"]
        != version[1]
    ):
        raise ValueError("the Homebrew CLI and candidate daemon versions differ")
    plist = env.paths.source_plist.read_bytes()
    validate_plist(plist, daemon_path=env.paths.daemon)
    return Candidate(prefix, source, binary, plist, version[1])


@dataclass(frozen=True)
class Step:
    command: tuple[str, ...]
    undo: tuple[str, ...]
    undo_when: str = "always"


@dataclass(frozen=True)
class Deployment:
    job: host.LaunchdJob
    binary_changed: bool
    binary_exists: bool
    plist_exists: bool
    loaded: bool
    disabled: bool
    paths: Paths = Paths()

    def staging(self) -> list[tuple[str, ...]]:
        commands = []
        if self.binary_changed or not self.plist_exists:
            commands.append(
                (
                    INSTALL,
                    "-d",
                    "-o",
                    "root",
                    "-g",
                    "wheel",
                    "-m",
                    "0755",
                    str(self.paths.daemon_dir),
                )
            )
        if self.binary_changed:
            commands += [
                (TEE, str(self.paths.next)),
                ("/bin/chmod", "0755", str(self.paths.next)),
            ]
            if self.binary_exists:
                commands.append(install(self.paths.daemon, self.paths.previous))
        if not self.plist_exists:
            commands += [
                (TEE, str(self.paths.staged_plist)),
                ("/bin/chmod", "0644", str(self.paths.staged_plist)),
            ]
        return commands

    def undo_binary(self) -> tuple[str, ...]:
        return (
            move(self.paths.previous, self.paths.daemon)
            if self.binary_exists
            else remove(self.paths.daemon)
        )

    def steps(self) -> list[Step]:
        plan: list[Step] = []
        if self.loaded:
            plan.append(
                Step(
                    launch(*self.job.bootout_args),
                    launch(*self.job.bootstrap_args),
                    undo_when="if_unloaded",
                )
            )
        if self.binary_changed:
            plan.append(
                Step(move(self.paths.next, self.paths.daemon), self.undo_binary())
            )
        if not self.plist_exists:
            plan.append(
                Step(
                    install(self.paths.staged_plist, self.paths.plist, "0644"),
                    remove(self.paths.plist),
                )
            )
        if self.disabled:
            plan.append(
                Step(
                    launch("enable", self.job.target),
                    launch("disable", self.job.target),
                )
            )
        plan.append(
            Step(
                launch(*self.job.bootstrap_args),
                launch(*self.job.bootout_args),
                undo_when="if_loaded",
            )
        )
        return plan

    def commands(self) -> list[tuple[str, ...]]:
        return [
            *self.staging(),
            *(command for step in self.steps() for command in (step.command, step.undo)),
        ]

    def stage(self, candidate: Candidate, *, env: Host = DEFAULT_HOST):
        # Root only receives bytes read by the caller; it never follows a user-writable source path.
        inputs = {
            (TEE, str(self.paths.next)): candidate.binary,
            (TEE, str(self.paths.staged_plist)): candidate.plist,
        }
        for command in self.staging():
            env.root(command, inputs.get(command))
        if self.binary_changed and not (
            protected(self.paths.next, env=env)
            and digest(self.paths.next) == candidate.binary_hash
        ):
            raise ValueError(
                "staged daemon differs from the approved binary; no services stopped"
            )
        if not self.plist_exists and not (
            protected(self.paths.staged_plist, env=env)
            and digest(self.paths.staged_plist)
            == hashlib.sha256(candidate.plist).digest()
        ):
            raise ValueError(
                "staged plist differs from the approved plist; no services stopped"
            )

    def switch(self, verify, *, env: Host = DEFAULT_HOST):
        completed: list[Step] = []

        def should_undo(step: Step) -> bool:
            if step.undo_when == "if_unloaded":
                return not self.job.details(probe_fn=env.probe)
            if step.undo_when == "if_loaded":
                return bool(self.job.details(probe_fn=env.probe))
            return True

        try:
            for step in self.steps():
                completed.append(step)
                env.root(step.command, None)
            verify()
        except (Exception, KeyboardInterrupt) as failure:
            print(
                "Deployment failed; restoring the previous managed service configuration.",
                file=sys.stderr,
                flush=True,
            )
            try:
                for step in reversed(completed):
                    if should_undo(step):
                        env.root(step.undo, None)
            except (Exception, KeyboardInterrupt) as recovery:
                raise ValueError(
                    f"{failure}; rollback also failed: {recovery}"
                ) from recovery
            raise


def inspect(candidate: Candidate, *, env: Host = DEFAULT_HOST) -> Deployment:
    paths = env.paths
    for parent in paths.parents_to_check:
        protected(parent, directory=True, env=env)
    protected(paths.daemon_dir, directory=True, optional=True, env=env)
    protected(paths.plist.parent, directory=True, env=env)
    binary_exists = protected(paths.daemon, optional=True, env=env)
    plist_exists = protected(paths.plist, optional=True, env=env)
    for temporary in (paths.next, paths.previous, paths.staged_plist):
        protected(temporary, optional=True, env=env)
    if plist_exists:
        validate_plist(paths.plist.read_bytes(), daemon_path=paths.daemon)
    job = host.LaunchdJob("system", LABEL, paths.plist)
    loaded = bool(job.details(probe_fn=env.probe))
    is_disabled = disabled(job, env=env)
    if loaded and (not binary_exists or is_disabled):
        raise ValueError(
            "the system daemon cannot be safely restored; review its binary and launchd state"
        )
    return Deployment(
        job,
        not binary_exists or digest(paths.daemon) != candidate.binary_hash,
        binary_exists,
        plist_exists,
        loaded,
        is_disabled,
        paths=paths,
    )


def deploy(*, refresh: bool = False, env: Host = DEFAULT_HOST):
    if refresh and not env.paths.plist.exists():
        print(
            "No protected Tailscale service to refresh; use tailscale:deploy for first-time setup."
        )
        return
    candidate = load_candidate(env=env)
    plan = inspect(candidate, env=env)
    live = live_version(candidate.cli, env=env)
    if refresh and (not plan.loaded or not live or not plan.binary_changed):
        print(
            "Tailscale refresh skipped: no running managed daemon with a changed binary."
        )
        return
    if live and not plan.loaded:
        raise ValueError(
            "another Tailscale daemon is running; stop it through its service manager before deploying"
        )
    if live == candidate.version and plan.loaded and not plan.binary_changed:
        print(f"System Tailscale daemon is already on {candidate.version}.")
        return
    try:
        env.require_local_terminal()
    except ValueError:
        if not refresh:
            raise
        print(
            "Tailscale update available; run tailscale:deploy locally to apply it.",
            file=sys.stderr,
        )
        return
    print(f"Deploy {candidate.version} from {candidate.source}\n  to {env.paths.daemon}")
    print(
        "Tailnet connections can briefly disconnect. Existing node state and proxy settings are kept."
    )
    env.confirm("Deploy the root Tailscale daemon?")
    env.authorize(plan.commands())
    plan.stage(candidate, env=env)
    plan.switch(lambda: candidate.verify(plan.job, env=env), env=env)
    print(
        f"System Tailscale daemon {candidate.version} is running from {env.paths.daemon}."
    )


def main():
    if sys.argv[1:] not in ([], ["--refresh"]):
        print("usage: tailscale_macos.py [--refresh]", file=sys.stderr)
        return 2
    refresh = bool(sys.argv[1:])
    if sys.platform != "darwin" or os.environ.get("MISE_ENV") not in {
        "personal-macos",
        "work-macos",
    }:
        print(
            "Choose personal-macos or work-macos on the Mac before maintaining Tailscale.",
            file=sys.stderr,
        )
        return 2

    def interrupt(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGHUP, interrupt)
    signal.signal(signal.SIGTERM, interrupt)
    try:
        if not refresh:
            host.require_local_terminal()
        with host.maintenance_lock():
            deploy(refresh=refresh)
    except (
        EOFError,
        KeyboardInterrupt,
        OSError,
        ValueError,
        KeyError,
        subprocess.SubprocessError,
    ) as exc:
        print(f"Tailscale maintenance stopped: {exc or 'interrupted'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
