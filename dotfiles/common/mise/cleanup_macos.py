"""Local macOS maintenance for the explicit cleanup task."""

import json
import os
import re
import shlex
import signal
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import macos_host as host

LSOF = host.LSOF

# Wait even if mise itself fails before starting the Python worker, and leave
# successful runs with nonfatal warnings readable without trying to parse them.
HANDOFF_SCRIPT = (
    '"$@"; status=$?; '
    'if [ "$status" -eq 0 ]; then printf "\\nCleanup finished. Review any warnings above.\\n"; '
    'else printf "\\nCleanup incomplete (exit %s). Review the output above.\\n" "$status"; fi; '
    'printf "Press Enter to close this window. "; IFS= read -r reply; exit "$status"'
)


def needs_handoff():
    if any(os.environ.get(var) for var in ("HERDR_ENV", "HERDR_SOCKET_PATH")):
        return True
    pid = os.getppid()
    while pid > 1:
        info = host.checked(
            host.probe("/bin/ps", "-p", str(pid), "-o", "ppid=,comm=")
        ).split(maxsplit=1)
        if not info:
            break
        parent, name = info
        if Path(name.strip()).name.lstrip("-") in {"fish", "herdr"}:
            return True
        pid = int(parent)
    return False


def open_handoff(profile, prefix):
    # Do not start the normal login shell: Fish would attach to Herdr again.
    # A separate Ghostty instance also lets the original window close safely.
    path = f"{Path.home() / '.local/bin'}:{prefix / 'bin'}:{prefix / 'sbin'}:/usr/bin:/bin:/usr/sbin:/sbin"
    command = shlex.join(
        (
            "/usr/bin/env",
            "-u",
            "HERDR_ENV",
            "-u",
            "HERDR_SOCKET_PATH",
            "-u",
            "HERDR_PANE_ID",
            "-u",
            "HERDR_BIN_PATH",
            f"PATH={path}",
            f"MISE_SYSTEM_BREW_PREFIX={prefix}",
            "MISE_EXEC_AUTO_INSTALL=false",
            "/bin/sh",
            "-c",
            HANDOFF_SCRIPT,
            "cleanup-handoff",
            "mise",
            "--cd",
            str(host.REPO),
            "--env",
            profile,
            "exec",
            "--",
            sys.executable,
            str(Path(__file__).with_name("cleanup.py").resolve()),
            "worker",
        )
    )
    subprocess.run(
        (
            "/usr/bin/open",
            "-n",
            "-b",
            "com.mitchellh.ghostty",
            "--args",
            "--initial-window=true",
            "--window-save-state=never",
            "--shell-integration=none",
            "--fullscreen=false",
            "--maximize=false",
            "--wait-after-command=false",
            "--quit-after-last-window-closed=true",
            f"--initial-command=shell:{command}",
        ),
        check=True,
    )
    print(
        "Cleanup handed off to Ghostty; it has not finished. Read the result in that window."
    )


def run_in_session(profile, prefix, *, worker, action):
    host.require_local_terminal()
    if needs_handoff():
        if worker:
            raise ValueError("maintenance terminal is not independent of Fish or Herdr")
        open_handoff(profile, prefix)
        return 0
    with host.maintenance_lock():
        return action()


@dataclass(frozen=True)
class UserAgentJob(host.LaunchdJob):
    def __post_init__(self):
        if not self.domain.startswith("gui/"):
            raise ValueError(
                f"workstation cleanup only manages user LaunchAgents, not {self.target}"
            )

    def _mutate(self, action, *args):
        subprocess.run((host.LAUNCHCTL, action, *args), check=True, timeout=90)

    def stop(self):
        self._mutate(*self.bootout_args)

    def restore(self):
        if not self.details():
            self._mutate(*self.bootstrap_args)
        elif self.label == "dev.mise.colima-default":
            # A failed bootout can leave the wrapper up even after the VM stopped.
            self._mutate("kickstart", "-k", self.target)
        host.wait_for(
            lambda: re.search(r"^\s*pid = \d+$", self.details(), re.MULTILINE),
            self.target,
            timeout=20,
        )


def jobs(profile, prefix):
    home = Path.home()
    bin_dir = prefix / "bin"
    applications = (
        home / "Applications" if profile == "work-macos" else Path("/Applications")
    )
    agents = (
        ("aerospace", (applications / "AeroSpace.app/Contents/MacOS/AeroSpace",)),
        ("sketchybar", (bin_dir / "sketchybar",)),
        ("borders", (bin_dir / "borders",)),
        ("colima-default", (bin_dir / "colima", bin_dir / "limactl")),
        ("moshi-hook", (prefix / "opt/moshi-hook/bin/moshi-hook",)),
    )
    if profile == "work-macos":
        agents += (
            ("cli-proxy-pac", (Path(sys.executable),)),
            ("tailscale-control-proxy", (bin_dir / "gost",)),
        )
    gui = f"gui/{os.getuid()}"
    return [
        UserAgentJob(
            gui,
            f"dev.mise.{name}",
            home / f"Library/LaunchAgents/dev.mise.{name}.plist",
            programs,
        )
        for name, programs in agents
    ]


@dataclass(frozen=True)
class Change:
    job: UserAgentJob
    pids: set[int]
    blocking: bool
    reason: str


def process_tree():
    result = host.checked(host.probe("/bin/ps", "-axo", "pid=,ppid=,comm="))
    return {
        int(pid): (int(parent), Path(name).name.lstrip("-"))
        for line in result.splitlines()
        for pid, parent, name in [line.split(maxsplit=2)]
    }


def descendants(pids, tree):
    pids = set(pids)
    while (
        children := {pid for pid, (parent, _) in tree.items() if parent in pids} - pids
    ):
        pids.update(children)
    return pids


def colima_pids(tree, prefix):
    # Lima and Colima can reparent helpers to launchd, outside the wrapper's tree.
    vm_dir = Path.home() / ".colima/_lima"
    running = {vm["name"] for vm in lima_instances(prefix) if vm["status"] != "Stopped"}
    if "colima" not in running:
        return set()
    candidates = [
        pid for pid, (_, name) in tree.items() if name in {"colima", "limactl"}
    ]
    if not candidates:
        return set()
    output = host.probe(
        "/bin/ps", "-p", ",".join(map(str, candidates)), "-o", "pid=,command="
    )
    pids = set()
    for line in output.stdout.splitlines():
        pid, command = line.split(maxsplit=1)
        if (
            f"{vm_dir}/colima/" in command
            or (running == {"colima"} and f"{vm_dir}/_networks/" in command)
            or re.search(r"\bcolima daemon start default(?:\s|$)", command)
        ):
            pids.add(int(pid))
    return pids


def stale_programs(pids, programs):
    if not pids or not programs:
        return []
    result = host.probe(
        host.LSOF,
        "-nP",
        "-a",
        "-d",
        "txt",
        "-p",
        ",".join(map(str, sorted(pids))),
        "-F0fin",
    )
    if result.returncode and result.stderr:
        host.checked(result)
    running = set()
    inode = None
    for item in result.stdout.split("\0"):
        field = item.lstrip("\n")
        if field.startswith("f"):
            inode = None
        elif field.startswith("i"):
            inode = field[1:]
        elif field.startswith("n/"):
            running.add((Path(field[1:]), inode))
    outdated = []
    for program in programs:
        current = program.resolve()
        if not current.is_file():
            continue
        ino = str(current.stat().st_ino)
        if any(
            path.name == current.name and (path != current or (node and node != ino))
            for path, node in running
        ):
            outdated.append(current.name)
    return outdated


def service_changes(profile, prefix, blockers, tree):
    changes = []
    for job in jobs(profile, prefix):
        match = re.search(r"^\s*pid = (\d+)$", job.details(), re.MULTILINE)
        if not match:
            continue  # Do not start stopped or unloaded jobs.
        pids = descendants({int(match[1])}, tree)
        if job.label == "dev.mise.colima-default":
            pids.update(descendants(colima_pids(tree, prefix), tree))
        if pids & blockers:
            changes.append(Change(job, pids, True, "holds a planned removal target"))
        elif stale := stale_programs(pids, job.programs):
            changes.append(
                Change(job, pids, False, "stale executable: " + ", ".join(stale))
            )
    return changes


def check_replacements(programs, targets):
    roots = {path for target in targets for path in (target, target.resolve())}
    for program in programs:
        binary = program.resolve()
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError(
                f"no retained replacement for {program}: no executable file at {binary}; "
                "install or relink the selected version first"
            )
        if removal := next(
            (path for path in (binary, *binary.parents) if path in roots), None
        ):
            raise ValueError(
                f"no retained replacement for {program}: {binary} is covered by planned "
                f"removal: {removal}; correct the removal plan or link a retained version first"
            )


def lima_instances(prefix):
    lima_home = Path.home() / ".colima/_lima"
    listing = host.checked(
        host.probe(
            "/usr/bin/env",
            f"LIMA_HOME={lima_home}",
            str(prefix / "bin/limactl"),
            "list",
            "--json",
        )
    )
    return [json.loads(line) for line in listing.splitlines()]


def stop_colima(prefix):
    # Do not cut power to the VM by unloading the job first, and never force stop.
    for vm in lima_instances(prefix):
        if vm["name"] == "colima" and vm["status"] != "Stopped":
            subprocess.run(
                (
                    "mise",
                    "exec",
                    "--",
                    str(prefix / "bin/colima"),
                    "stop",
                    "--profile",
                    "default",
                ),
                timeout=180,
                check=True,
            )
            break


def fish_identity(pid):
    result = host.probe("/bin/ps", "-p", str(pid), "-o", "uid=,tty=,lstart=,comm=")
    if result.returncode == 1 and not result.stderr:
        return None  # Process exited.
    identity = host.checked(result).strip()
    uid, tty, *_, name = identity.split(maxsplit=7)
    if (
        uid == str(os.getuid())
        and tty != "??"
        and Path(name).name.lstrip("-") == "fish"
    ):
        return identity
    return None


def blocking_fish(pids, prefix):
    fish = {}
    for pid in sorted(pids):
        if not (identity := fish_identity(pid)):
            continue
        result = host.probe(host.LSOF, "-nP", "-a", "-d", "txt", "-p", str(pid), "-Fn")
        if any(
            line.endswith("/bin/fish") and line.startswith(f"n{prefix}/Cellar/fish/")
            for line in result.stdout.splitlines()
        ):
            fish[pid] = identity
    return fish


def close_fish(fish):
    # Only signal the same confirmed, same-user processes that blocked the plan.
    for pid, identity in fish.items():
        if fish_identity(pid) == identity:
            try:
                os.kill(pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
    host.wait_for(
        lambda: all(fish_identity(pid) != ident for pid, ident in fish.items()),
        "old Fish shells to exit",
    )


@dataclass(frozen=True)
class Herdr:
    binary: Path
    name: str
    socket: str

    def pids(self, tree):
        candidates = [pid for pid, (_, name) in tree.items() if name == "herdr"]
        if not candidates:
            return set()
        result = host.probe(
            host.LSOF,
            "-nP",
            "-a",
            "-U",
            "-p",
            ",".join(map(str, candidates)),
            "-F0pn",
        )
        owners = set()
        pid = None
        for item in result.stdout.split("\0"):
            field = item.lstrip("\n")
            if field.startswith("p"):
                pid = int(field[1:])
            elif pid and field == f"n{self.socket}":
                owners.add(pid)
        return descendants(owners, tree)

    @property
    def command(self):
        # In a pane, the inherited socket would otherwise override the session.
        base = (
            "/usr/bin/env",
            "-u",
            "HERDR_SOCKET_PATH",
            "-u",
            "HERDR_ENV",
            str(self.binary),
        )
        return base if self.name == "default" else (*base, "--session", self.name)

    def status(self):
        return json.loads(host.checked(host.probe(*self.command, "status", "--json")))[
            "server"
        ]

    def stop(self):
        host.checked(host.probe(*self.command, "server", "stop"))
        host.wait_for(
            lambda: not self.status()["running"], f"Herdr {self.name} to exit"
        )

    def restore(self):
        if self.status()["running"]:
            return
        server = subprocess.Popen(
            (*self.command, "server"),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        host.wait_for(
            lambda: self.status()["running"] or server.poll() is not None,
            f"Herdr {self.name} to start",
        )
        if not self.status()["running"]:
            raise ValueError(f"Herdr {self.name} failed to start; see the Herdr logs")


def stale_herdr():
    binary = Path(host.checked(host.probe("mise", "which", "herdr")).strip())
    sessions = json.loads(
        host.checked(host.probe(str(binary), "session", "list", "--json"))
    )["sessions"]
    result = []
    for row in sessions:
        if row["running"]:
            session = Herdr(binary, row["name"], row["socket_path"])
            status = session.status()
            if status.get("server_binary_stale") or status.get("restart_needed"):
                result.append(session)
    return result


@contextmanager
def paused(jobs, sessions, fish, prefix):
    # Record intent before the operation: an interrupted command can still have
    # stopped a job. Restore every attempted job, even if another restore fails.
    attempted_jobs, attempted_sessions = [], []
    failures = []
    try:
        for session in sessions:
            attempted_sessions.append(session)
            session.stop()
        close_fish(fish)
        for job in reversed(jobs):
            print(f"Stopping {job.label}", flush=True)
            if job.label == "dev.mise.colima-default":
                stop_colima(prefix)
            attempted_jobs.append(job)
            job.stop()
        yield
    finally:
        original = sys.exception()
        for item in [*reversed(attempted_jobs), *attempted_sessions]:
            name = (
                item.label
                if isinstance(item, host.LaunchdJob)
                else f"Herdr {item.name}"
            )
            try:
                print(f"Restoring {name}", flush=True)
                item.restore()
            except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
                failures.append(f"{name}: {exc}")
        if failures:
            context = f"\nEarlier failure: {original}" if original else ""
            raise ValueError(
                "could not restore all services:\n" + "\n".join(failures) + context
            )


@dataclass(frozen=True)
class MaintenancePlan:
    changes: tuple[Change, ...]
    before: tuple[Herdr, ...]
    after: tuple[Herdr, ...]
    fish: dict[int, str]
    unknown: tuple[str, ...]
    prefix: Path

    @property
    def has_actions(self) -> bool:
        return bool(self.changes or self.before or self.after or self.fish)

    @property
    def programs(self) -> list[Path]:
        programs = [
            program for change in self.changes for program in change.job.programs
        ]
        programs.extend(session.binary for session in (*self.before, *self.after))
        if self.fish:
            programs.append(self.prefix / "bin/fish")
        return programs

    def summary_lines(self) -> list[str]:
        lines = []
        for change in self.changes:
            action = "Pause for prune" if change.blocking else "Refresh after prune"
            lines.append(f"{action}: {change.job.target} — {change.reason}")
        for action, sessions in (
            ("Pause for prune", self.before),
            ("Refresh after prune", self.after),
        ):
            for session in sessions:
                lines.append(f"{action}: Herdr session {session.name}")
        for pid, identity in self.fish.items():
            lines.append(
                f"Close blocking Fish shell on {identity.split()[1]} (PID {pid})"
            )
        if not lines:
            lines.append(
                "No managed services or sessions need to be stopped or restarted."
            )
        return lines

    def check_replacements(self, targets: list[Path]) -> None:
        check_replacements(self.programs, targets)

    def run(self, action) -> int:
        blocking_jobs = [change.job for change in self.changes if change.blocking]
        refresh_jobs = [change.job for change in self.changes if not change.blocking]
        with paused(blocking_jobs, self.before, self.fish, self.prefix):
            status = action()
            if status:
                return status
        if refresh_jobs or self.after:
            # These processes did not need to be offline while packages were pruned.
            with paused(refresh_jobs, self.after, {}, self.prefix):
                pass
        return 0


def plan_maintenance(processes, profile, prefix) -> MaintenancePlan:
    blockers = {item.pid for item in processes if item.pid}
    tree = process_tree()
    changes = tuple(service_changes(profile, prefix, blockers, tree))
    fish = blocking_fish(blockers, prefix)
    before, after = [], []
    covered = set(fish)
    for change in changes:
        if change.blocking:
            covered.update(change.pids)
    for session in stale_herdr():
        pids = session.pids(tree) if blockers else set()
        if pids & blockers:
            before.append(session)
            covered.update(pids)
        else:
            after.append(session)
    unknown = tuple(item.message for item in processes if item.pid not in covered)
    return MaintenancePlan(changes, tuple(before), tuple(after), fish, unknown, prefix)
