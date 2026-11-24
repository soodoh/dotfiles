"""One-time cutover from the Homebrew Tailscale services."""

import grp
import os
import plistlib
import stat
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import tailscale_macos as ts

LEGACY = "homebrew.mxcl.tailscale"
CHOWN = "/usr/sbin/chown"
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


@contextmanager
def parent_directory(path):
    # Traverse without symlinks, then pin the parent as cwd for the privileged
    # relative operation. chown -h must not follow the final entry, either.
    fd = os.open(path.anchor, DIR_FLAGS)
    previous = os.open(".", DIR_FLAGS)
    try:
        for component in path.parent.parts[1:]:
            child = os.open(component, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        os.fchdir(fd)
        yield fd
    finally:
        os.fchdir(previous)
        os.close(previous)
        os.close(fd)


def identity(info):
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_uid,
        info.st_gid,
        info.st_nlink,
    )


@dataclass(frozen=True)
class Repair:
    path: Path
    observed: os.stat_result

    def run(self, operation):
        with parent_directory(self.path) as parent:
            current = os.stat(self.path.name, dir_fd=parent, follow_symlinks=False)
            if identity(current) != identity(self.observed):
                raise ValueError(
                    f"{self.path} changed after inspection; try the migration again"
                )
            operation((CHOWN, "-h", str(os.getuid()), f"./{self.path.name}"))


def repairs(prefix, *, admin_gid):
    prefix = prefix.resolve(strict=True)
    cellar = prefix / "Cellar/tailscale"
    if cellar.resolve(strict=True) != cellar:
        raise ValueError(f"unexpected symlink in Tailscale Cellar path: {cellar}")
    found = []

    def check(path, kind):
        try:
            info = path.lstat()
        except FileNotFoundError:
            return
        if not kind(info.st_mode):
            raise ValueError(f"unexpected file type at {path}")
        if info.st_uid != 0:
            return
        symlink = stat.S_ISLNK(info.st_mode)
        if info.st_gid != admin_gid or (
            not symlink and not info.st_mode & stat.S_ISVTX
        ):
            raise ValueError(f"unrecognized root ownership at {path}; not changing it")
        if not stat.S_ISDIR(info.st_mode) and info.st_nlink != 1:
            raise ValueError(f"multiple links to {path}; not changing its ownership")
        if symlink:
            target = path.resolve(strict=True)
            if target.parent != cellar or not target.is_dir():
                raise ValueError(
                    f"{path} does not link to a Tailscale keg; not changing it"
                )
        found.append(Repair(path, info))

    for keg in sorted(cellar.iterdir()):
        if not keg.name[0].isdigit():
            continue
        check(keg, stat.S_ISDIR)
        for directory in (keg / "bin", keg / "sbin"):
            check(directory, stat.S_ISDIR)
        check(keg / "bin/tailscaled", stat.S_ISREG)
    for link in (prefix / "opt/tailscale", prefix / "var/homebrew/linked/tailscale"):
        check(link, stat.S_ISLNK)
    if found and (prefix / "Cellar").stat().st_uid != os.getuid():
        raise ValueError(
            "this account does not own Homebrew's Cellar; not changing keg ownership"
        )
    return found


@dataclass(frozen=True)
class LegacyService:
    job: ts.macos.Job
    installed: bool
    loaded: bool
    disabled: bool

    @property
    def system(self):
        return self.job.domain == "system"

    @property
    def disable(self):
        return self.installed and not self.disabled

    def commands(self):
        if not self.system:
            return []
        commands = []
        if self.disable:
            commands += [
                ts.launch("disable", self.job.target),
                ts.launch("enable", self.job.target),
            ]
        if self.loaded:
            commands += [
                ts.launch(*self.job.bootout_args),
                ts.launch(*self.job.bootstrap_args),
            ]
        if self.installed:
            commands.append(ts.remove(self.job.plist))
        return commands

    def pause(self):
        if self.disable:
            ts.root(ts.launch("disable", self.job.target))
        if self.loaded and self.job.details():
            ts.root(ts.launch(*self.job.bootout_args))

    def restore(self):
        if self.disable:
            ts.root(ts.launch("enable", self.job.target))
        if self.loaded and not self.job.details():
            ts.root(ts.launch(*self.job.bootstrap_args))

    def retire(self):
        if self.system:
            if self.job.details():
                raise ValueError(
                    f"{self.job.target} still registered; not removing its plist"
                )
            if self.installed:
                ts.root(ts.remove(self.job.plist))
        else:
            if self.job.details():
                self.job.stop()
            if self.installed:
                self.job.plist.unlink(missing_ok=True)


def legacy_service(prefix, *, system):
    directory = ts.PLIST.parent if system else Path.home() / "Library/LaunchAgents"
    plist = directory / f"{LEGACY}.plist"
    domain = "system" if system else f"gui/{os.getuid()}"
    job = ts.macos.Job(domain, LEGACY, plist, ())
    loaded = bool(job.details())
    installed = plist.exists() or plist.is_symlink()
    if installed:
        if system:
            ts.protected(plist)
        elif (
            not stat.S_ISREG(plist.lstat().st_mode)
            or plist.lstat().st_uid != os.getuid()
        ):
            raise ValueError(f"unexpected user service file: {plist}")
        config = plistlib.loads(plist.read_bytes())
        executable = str(prefix / "opt/tailscale/bin/tailscaled")
        if (
            config.get("Label") != LEGACY
            or config.get("ProgramArguments") != [executable]
            or config.get("Program", executable) != executable
            or "UserName" in config
        ):
            raise ValueError(f"{plist} is customized; review it before migration")
    disabled = ts.disabled(job) if installed and system else False
    if system and loaded and disabled:
        raise ValueError(
            "the old system daemon is loaded but disabled; review its launchd state"
        )
    return LegacyService(job, installed, loaded, disabled)


def apply(candidate, plan, system, user, ownership, *, deploy):
    commands = system.commands()
    if deploy:
        commands += plan.commands()
    if commands:
        ts.authorize(commands)
    elif ownership:
        subprocess.run((ts.SUDO, "-v"), check=True)
    for repair in ownership:
        repair.run(ts.check_authorized)
    if deploy:
        plan.stage(candidate)

    try:
        system.pause()
        if deploy:
            plan.switch(lambda: candidate.verify(plan.job))
        elif not plan.job.details() or not ts.live_version(candidate.cli):
            raise ValueError(
                "the managed daemon is no longer reachable; retained the previous service files"
            )
    except (Exception, KeyboardInterrupt) as failure:
        try:
            # If the managed job survived a failed rollback, do not start a second daemon.
            if not plan.job.details():
                system.restore()
        except (Exception, KeyboardInterrupt) as recovery:
            raise ValueError(
                f"{failure}; restoring {system.job.target} also failed: {recovery}"
            ) from recovery
        raise

    # Commit only after the separate daemon is verified. Retiring leftovers
    # is retryable and must not roll back a healthy managed daemon.
    system.retire()
    user.retire()
    for repair in ownership:
        repair.run(ts.root)


def migrate():
    candidate = ts.load_candidate()
    plan = ts.inspect(candidate)
    system = legacy_service(candidate.prefix, system=True)
    user = legacy_service(candidate.prefix, system=False)
    if plan.loaded and system.loaded:
        raise ValueError("both system services are loaded; resolve the duplicate first")
    live = ts.live_version(candidate.cli)
    if live and not (plan.loaded or system.loaded):
        raise ValueError(
            "another Tailscale daemon is running; stop it through its owner first"
        )
    deploy = not (plan.loaded and live)
    ownership = repairs(candidate.prefix, admin_gid=grp.getgrnam("admin").gr_gid)
    if not (deploy or system.installed or user.installed or ownership):
        print("Tailscale migration is already complete.")
        return
    if deploy:
        print(
            f"Deploy {candidate.version} outside Homebrew; tailnet connections will briefly disconnect."
        )
    else:
        print("Keep the running managed Tailscale daemon.")
    for service in (system, user):
        if service.installed:
            print(f"Retire {service.job.target} ({service.job.plist}).")
    for repair in ownership:
        print(f"Return {repair.path} to the Homebrew user.")
    ts.confirm("Migrate Tailscale and retire the old setup?")
    apply(candidate, plan, system, user, ownership, deploy=deploy)
    print("Tailscale migration complete. Node state and proxy settings were kept.")


if __name__ == "__main__":
    raise SystemExit(ts.run_local(migrate))
