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


def protected(path, *, directory=False, optional=False):
    """Refuse symlinks and paths that could be changed without root."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        if optional:
            return False
        raise
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (
        not kind(info.st_mode)
        or info.st_uid != 0
        or info.st_mode & 0o022
        or os.access(path, os.W_OK)
    ):
        raise ValueError(
            f"{path} is not a protected root-owned {'directory' if directory else 'file'}"
        )
    return True


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").digest()


def validate_plist(contents):
    config = plistlib.loads(contents)
    if config != {
        "Label": LABEL,
        "ProgramArguments": [str(DAEMON)],
        "RunAtLoad": True,
        "KeepAlive": True,
    }:
        raise ValueError("the system plist must run only the protected daemon binary")
    return config


def live_version(cli):
    result = host.probe(str(cli), "version", "--json", "--daemon")
    return None if result.returncode else json.loads(result.stdout).get("daemonLong")


def disabled(job):
    output = host.checked(host.probe(*launch("print-disabled", job.domain)))
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

    def verify(self, job):
        host.wait_for(
            lambda: (
                re.search(r"^\s*pid = \d+$", job.details(), re.MULTILINE)
                and live_version(self.cli) == self.version
            ),
            f"{job.target} to report {self.version}",
            timeout=25,
        )


def load_candidate():
    prefix = Path(host.checked(host.probe("brew", "--prefix")).strip())
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
        host.checked(host.probe(str(source), "--version")),
        re.MULTILINE,
    )
    if not version:
        raise ValueError(f"cannot read the version of {source}")
    cli = prefix / "bin/tailscale"
    if (
        json.loads(host.checked(host.probe(str(cli), "version", "--json")))["long"]
        != version[1]
    ):
        raise ValueError("the Homebrew CLI and candidate daemon versions differ")
    plist = SOURCE_PLIST.read_bytes()
    validate_plist(plist)
    return Candidate(prefix, source, binary, plist, version[1])


@dataclass(frozen=True)
class Deployment:
    job: host.LaunchdJob
    binary_changed: bool
    binary_exists: bool
    plist_exists: bool
    loaded: bool
    disabled: bool

    def staging(self):
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
                    str(DAEMON_DIR),
                )
            )
        if self.binary_changed:
            commands += [(TEE, str(NEXT)), ("/bin/chmod", "0755", str(NEXT))]
            if self.binary_exists:
                commands.append(install(DAEMON, PREVIOUS))
        if not self.plist_exists:
            commands += [
                (TEE, str(STAGED_PLIST)),
                ("/bin/chmod", "0644", str(STAGED_PLIST)),
            ]
        return commands

    def commands(self):
        commands = [
            *self.staging(),
            launch(*self.job.bootout_args),
            launch(*self.job.bootstrap_args),
        ]
        if self.disabled:
            commands += [
                launch("enable", self.job.target),
                launch("disable", self.job.target),
            ]
        if not self.plist_exists:
            commands += [install(STAGED_PLIST, PLIST, "0644"), remove(PLIST)]
        if self.binary_changed:
            commands += [move(NEXT, DAEMON), self.undo_binary()]
        return commands

    def undo_binary(self):
        return move(PREVIOUS, DAEMON) if self.binary_exists else remove(DAEMON)

    def stage(self, candidate):
        # Root only receives bytes read by the caller; it never follows a user-writable source path.
        inputs = {
            (TEE, str(NEXT)): candidate.binary,
            (TEE, str(STAGED_PLIST)): candidate.plist,
        }
        for command in self.staging():
            root(command, inputs.get(command))
        if self.binary_changed and not (
            protected(NEXT) and digest(NEXT) == candidate.binary_hash
        ):
            raise ValueError(
                "staged daemon differs from the approved binary; no services stopped"
            )
        if not self.plist_exists and not (
            protected(STAGED_PLIST)
            and digest(STAGED_PLIST) == hashlib.sha256(candidate.plist).digest()
        ):
            raise ValueError(
                "staged plist differs from the approved plist; no services stopped"
            )

    def switch(self, verify):
        undo = []

        def change(command, reverse):
            undo.append(reverse)
            root(command)

        def restore_old():
            if not self.job.details():
                root(launch(*self.job.bootstrap_args))

        def stop_new():
            if self.job.details():
                root(launch(*self.job.bootout_args))

        try:
            if self.loaded:
                change(launch(*self.job.bootout_args), restore_old)
            if self.binary_changed:
                change(move(NEXT, DAEMON), lambda: root(self.undo_binary()))
            if not self.plist_exists:
                change(
                    install(STAGED_PLIST, PLIST, "0644"), lambda: root(remove(PLIST))
                )
            if self.disabled:
                change(
                    launch("enable", self.job.target),
                    lambda: root(launch("disable", self.job.target)),
                )
            change(launch(*self.job.bootstrap_args), stop_new)
            verify()
        except (Exception, KeyboardInterrupt) as failure:
            print(
                "Deployment failed; restoring the previous managed service configuration.",
                file=sys.stderr,
                flush=True,
            )
            try:
                for action in reversed(undo):
                    action()
            except (Exception, KeyboardInterrupt) as recovery:
                raise ValueError(
                    f"{failure}; rollback also failed: {recovery}"
                ) from recovery
            raise


def inspect(candidate):
    for parent in reversed(DAEMON_DIR.parents):
        protected(parent, directory=True)
    protected(DAEMON_DIR, directory=True, optional=True)
    protected(PLIST.parent, directory=True)
    binary_exists = protected(DAEMON, optional=True)
    plist_exists = protected(PLIST, optional=True)
    for temporary in (NEXT, PREVIOUS, STAGED_PLIST):
        protected(temporary, optional=True)
    if plist_exists:
        validate_plist(PLIST.read_bytes())
    job = host.LaunchdJob("system", LABEL, PLIST, (DAEMON,))
    loaded = bool(job.details())
    is_disabled = disabled(job)
    if loaded and (not binary_exists or is_disabled):
        raise ValueError(
            "the system daemon cannot be safely restored; review its binary and launchd state"
        )
    return Deployment(
        job,
        not binary_exists or digest(DAEMON) != candidate.binary_hash,
        binary_exists,
        plist_exists,
        loaded,
        is_disabled,
    )


def confirm(message):
    if input(message + " [y/N] ").strip().lower() not in {"y", "yes"}:
        raise ValueError("cancelled; no services changed")


def deploy(*, refresh=False):
    if refresh and not PLIST.exists():
        print(
            "No protected Tailscale service to refresh; use tailscale:deploy for first-time setup."
        )
        return
    candidate = load_candidate()
    plan = inspect(candidate)
    live = live_version(candidate.cli)
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
        host.require_local_terminal()
    except ValueError:
        if not refresh:
            raise
        print(
            "Tailscale update available; run tailscale:deploy locally to apply it.",
            file=sys.stderr,
        )
        return
    print(f"Deploy {candidate.version} from {candidate.source}\n  to {DAEMON}")
    print(
        "Tailnet connections can briefly disconnect. Existing node state and proxy settings are kept."
    )
    confirm("Deploy the root Tailscale daemon?")
    authorize(plan.commands())
    plan.stage(candidate)
    plan.switch(lambda: candidate.verify(plan.job))
    print(f"System Tailscale daemon {candidate.version} is running from {DAEMON}.")


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
