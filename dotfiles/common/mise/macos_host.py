"""Shared macOS host and read-only launchd primitives for workstation maintenance."""

import fcntl
import os
import re
import shlex
import signal
import sys
import time
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cleanup_host import ProcessHost

LAUNCHCTL = "/bin/launchctl"
REPO = Path(__file__).resolve().parents[3]


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


def require_local_terminal(*, environ: Mapping[str, str] | None = None):
    env = os.environ if environ is None else environ
    if (
        not sys.stdin.isatty()
        or any(env.get(var) for var in ("SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"))
        or os.stat("/dev/console").st_uid != os.getuid()
        or os.getuid() == 0
    ):
        raise ValueError(
            "run workstation maintenance interactively at the Mac, not over SSH or with sudo"
        )


@contextmanager
def maintenance_lock():
    directory = Path.home() / ".local/state/dotfiles"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "cleanup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError(
                "another workstation maintenance operation is already running"
            ) from None
        yield


@contextmanager
def interrupt_on_hangup():
    def interrupt(*_):
        raise KeyboardInterrupt

    previous: list[tuple[signal.Signals, Any]] = []
    try:
        for sig in (signal.SIGHUP, signal.SIGTERM):
            previous.append((sig, signal.signal(sig, interrupt)))
        yield
    finally:
        for sig, handler in previous:
            signal.signal(sig, handler)


@dataclass(frozen=True)
class MacOSHost(ProcessHost):
    local_terminal_check: Callable[..., None] = require_local_terminal
    maintenance_lock: Callable[[], AbstractContextManager[None]] = maintenance_lock
    wait_for: Callable[..., None] = wait_for

    def check_local_terminal(self) -> None:
        self.local_terminal_check(environ=self.environ)


DEFAULT_MACOS_HOST = MacOSHost()


@dataclass(frozen=True)
class LaunchdJob:
    domain: str
    label: str
    plist: Path

    @property
    def target(self):
        return f"{self.domain}/{self.label}"

    def details(self, *, probe_fn=None):
        result = (probe_fn or DEFAULT_MACOS_HOST.probe)(LAUNCHCTL, "print", self.target)
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

    def pid(self, *, probe_fn=None) -> int | None:
        match = re.search(
            r"^\s*pid = (\d+)$", self.details(probe_fn=probe_fn), re.MULTILINE
        )
        return int(match[1]) if match else None

    @property
    def bootout_args(self):
        return ("bootout", "--wait", self.target)

    @property
    def bootstrap_args(self):
        return ("bootstrap", self.domain, str(self.plist))
