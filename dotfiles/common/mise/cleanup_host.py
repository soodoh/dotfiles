"""POSIX-safe command runner and base host seam for workstation cleanup."""

import os
import subprocess
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass


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
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
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


@dataclass(frozen=True)
class ProcessHost:
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run
    environ: Mapping[str, str] | None = None

    def env_get(self, key: str) -> str | None:
        source = os.environ if self.environ is None else self.environ
        return source.get(key)

    def probe(self, *args: str) -> subprocess.CompletedProcess[str]:
        kwargs: dict[str, object] = {
            "check": False,
            "capture_output": True,
            "text": True,
            "timeout": 15,
        }
        if self.environ is not None:
            kwargs["env"] = dict(self.environ)
        return self.run(args, **kwargs)


@dataclass(frozen=True)
class CleanupHost(ProcessHost):
    def command(
        self,
        *args: str,
        show: bool = False,
        stdout_only: bool = False,
    ) -> str:
        return run(
            *args,
            show=show,
            stdout_only=stdout_only,
            runner=self.run,
            environ=self.environ,
        )


DEFAULT_CLEANUP_HOST = CleanupHost()
