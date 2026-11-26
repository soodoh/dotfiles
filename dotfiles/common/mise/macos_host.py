"""Shared macOS host and read-only launchd primitives for workstation maintenance."""

import fcntl
import os
import re
import shlex
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

LAUNCHCTL = "/bin/launchctl"
LSOF = "/usr/sbin/lsof"
REPO = Path(__file__).resolve().parents[3]


def probe(*args):
    return subprocess.run(args, check=False, capture_output=True, text=True, timeout=15)


def checked(result):
    if result.returncode:
        raise ValueError(
            f"{shlex.join(result.args)}: {result.stderr.strip() or f'exited {result.returncode}'}"
        )
    return result.stdout


def wait_for(done, description, *, timeout=10):
    deadline = time.monotonic() + timeout
    while not done():
        if time.monotonic() >= deadline:
            raise ValueError(f"timed out waiting for {description}")
        time.sleep(0.2)


def require_local_terminal():
    if (
        not sys.stdin.isatty()
        or any(
            os.environ.get(var) for var in ("SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY")
        )
        or os.stat("/dev/console").st_uid != os.getuid()
        or os.getuid() == 0
    ):
        raise ValueError(
            "run cleanup interactively at the Mac, not over SSH or with sudo"
        )


@contextmanager
def maintenance_lock():
    directory = Path.home() / ".local/state/dotfiles"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "cleanup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("another cleanup is already running") from None
        yield


@dataclass(frozen=True)
class LaunchdJob:
    domain: str
    label: str
    plist: Path
    programs: tuple[Path, ...]

    @property
    def target(self):
        return f"{self.domain}/{self.label}"

    def details(self):
        result = probe(LAUNCHCTL, "print", self.target)
        if result.returncode and "Could not find service" in result.stderr:
            return ""
        details = checked(result)
        path = re.search(r"^\s*path = (.+)$", details, flags=re.MULTILINE)
        if (
            not path
            or Path(path[1]).resolve() != self.plist.resolve()
            or not self.plist.is_file()
        ):
            raise ValueError(
                f"{self.target} is not loaded from {self.plist}; refusing to cycle it"
            )
        return details

    @property
    def bootout_args(self):
        return ("bootout", "--wait", self.target)

    @property
    def bootstrap_args(self):
        return ("bootstrap", self.domain, str(self.plist))
