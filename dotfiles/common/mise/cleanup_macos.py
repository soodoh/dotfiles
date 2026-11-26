"""Local macOS maintenance for the explicit cleanup task."""

import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tomllib
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from pathlib import Path

import cleanup
import macos_host as host

LSOF = "/usr/sbin/lsof"
MISE_PACKAGES = ("mise", "bootstrap", "packages", "prune", "--manager")
BREW_CLEANUP = ("brew", "cleanup")
BREW_PREFIX = Path(os.environ.get("MISE_SYSTEM_BREW_PREFIX") or "/opt/homebrew")

# Wait even if mise itself fails before starting the Python worker, and leave
# successful runs with nonfatal warnings readable without trying to parse them.
HANDOFF_SCRIPT = (
    '"$@"; status=$?; '
    'if [ "$status" -eq 0 ]; then printf "\\nCleanup finished. Review any warnings above.\\n"; '
    'else printf "\\nCleanup incomplete (exit %s). Review the output above.\\n" "$status"; fi; '
    'printf "Press Enter to close this window. "; IFS= read -r reply; exit "$status"'
)


def _confirm(prompt: str) -> bool:
    return input(prompt).strip().lower() in {"y", "yes"}


@dataclass(frozen=True)
class Host:
    brew_prefix: Path = BREW_PREFIX
    probe: Callable[..., subprocess.CompletedProcess[str]] = host.probe
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run
    popen: Callable[..., subprocess.Popen] = subprocess.Popen
    which: Callable[[str], str | None] = shutil.which
    kill: Callable[[int, int], None] = os.kill
    require_local_terminal: Callable[[], None] = host.require_local_terminal
    maintenance_lock: Callable[[], AbstractContextManager[None]] = (
        host.maintenance_lock
    )
    wait_for: Callable[..., None] = host.wait_for
    confirm: Callable[[str], bool] = _confirm
    ppid: Callable[[], int] = os.getppid
    uid: Callable[[], int] = os.getuid
    home: Callable[[], Path] = Path.home
    environ: Mapping[str, str] | None = None

    def env_get(self, key: str) -> str | None:
        source = os.environ if self.environ is None else self.environ
        return source.get(key)

    def command(self, *args: str, show: bool = False) -> str:
        return cleanup.run(
            *args,
            show=show,
            runner=self.run,
            environ=self.environ,
        )


DEFAULT_HOST = Host()


@dataclass(frozen=True)
class OpenFileEntry:
    pid: int
    command: str
    fd: str | None
    inode: str | None
    name: str


@dataclass(frozen=True)
class PlanAdditions:
    steps: tuple[tuple[str, ...], ...]
    targets: tuple[Path, ...]
    blockers: tuple[tuple[str, int | None], ...]


def parse_lsof(output: str) -> list[OpenFileEntry]:
    """Parse null-delimited `lsof -F0...` records into structured entries."""
    entries: list[OpenFileEntry] = []
    pid: int | None = None
    command = "?"
    fd: str | None = None
    inode: str | None = None
    for item in output.split("\0"):
        field = item.lstrip("\n")
        if not field:
            continue
        tag, value = field[0], field[1:]
        if tag == "p":
            pid, command, fd, inode = int(value), "?", None, None
        elif tag == "c":
            command = value
        elif tag == "f":
            fd, inode = value, None
        elif tag == "i":
            inode = value
        elif tag == "n" and pid is not None:
            entries.append(OpenFileEntry(pid, command, fd, inode, value))
    return entries


def package_targets(manager: str, output: str, prefix: Path) -> list[Path]:
    root = prefix / ("Cellar" if manager == "brew" else "Caskroom")
    marker = f"remove {manager}:"
    targets = []
    for line in output.splitlines():
        if not line.startswith(marker):
            continue
        name, version = line[len(marker) :].rsplit("@", 1)
        directory = root / name.rsplit("/", 1)[-1] / version
        if not directory.is_dir():
            raise ValueError(f"can't locate the planned removal: {directory}")
        targets.append(directory)
        if manager == "brew-cask":
            with (directory / ".mise-cask.toml").open("rb") as receipt:
                for record in tomllib.load(receipt)["targets"]:
                    targets.append(Path(record["path"]))
    if not targets and f"{manager}: nothing to prune" not in output:
        raise ValueError(f"can't read mise's {manager} prune plan")
    return targets


def brew_cleanup_targets(output: str) -> list[Path]:
    targets = []
    for line in output.splitlines():
        if line.startswith("Would remove: "):
            path, _ = line.removeprefix("Would remove: ").rsplit(" (", 1)
        elif line.startswith(
            ("Would remove (broken link): ", "Would remove (empty directory): ")
        ):
            path = line.split(": ", 1)[1]
        elif line.startswith("Would remove"):
            raise ValueError(f"can't read Brew's cleanup candidate: {line}")
        else:
            continue
        targets.append(Path(path))
    return targets


def open_file_blockers(
    targets: Sequence[Path], open_files: str
) -> list[tuple[str, int | None]]:
    roots = {path for target in targets for path in (target, target.resolve())}
    matches: set[tuple[Path, int, str]] = set()
    for entry in parse_lsof(open_files):
        if not entry.name.startswith("/"):
            continue
        path = Path(entry.name)
        matches.update(
            (root, entry.pid, entry.command)
            for root in roots.intersection((path, *path.parents))
        )
    return [
        (f"{root} is open in {name} (PID {pid})", pid or None)
        for root, pid, name in sorted(matches)
    ]


def brew_plan(
    show: bool, *, env: Host = DEFAULT_HOST
) -> tuple[list[tuple[str, ...]], list[Path]]:
    steps, paths = [], []
    # Check native cleanup first, before mise changes the set of installed kegs.
    if env.which("brew"):
        native = brew_cleanup_targets(env.command(*BREW_CLEANUP, "--dry-run", show=show))
        if native:
            paths.extend(native)
            steps.append(BREW_CLEANUP)
    for manager in ("brew-cask", "brew"):
        command = (*MISE_PACKAGES, manager)
        output = env.command(*command, "--dry-run", show=show)
        targets = package_targets(manager, output, env.brew_prefix)
        if targets:
            paths.extend(targets)
            steps.append((*command, "--yes"))
        if not show:
            for line in output.splitlines():
                if "skipped:" in line:
                    print(line, file=sys.stderr)
    if any(not path.is_absolute() for path in paths):
        raise ValueError("Homebrew cleanup preview contained a non-absolute path")
    return steps, paths


def plan_additions(
    existing_targets: Sequence[Path], *, show: bool, env: Host = DEFAULT_HOST
) -> PlanAdditions:
    steps, paths = brew_plan(show, env=env)
    all_targets = [*existing_targets, *paths]
    blockers = (
        open_file_blockers(all_targets, env.command(LSOF, "-nP", "-F0pcn"))
        if all_targets
        else []
    )
    return PlanAdditions(tuple(steps), tuple(paths), tuple(blockers))


def needs_handoff(*, env: Host = DEFAULT_HOST) -> bool:
    if any(env.env_get(var) for var in ("HERDR_ENV", "HERDR_SOCKET_PATH")):
        return True
    pid = env.ppid()
    while pid > 1:
        info = host.checked(
            env.probe("/bin/ps", "-p", str(pid), "-o", "ppid=,comm=")
        ).split(maxsplit=1)
        if not info:
            break
        parent, name = info
        if Path(name.strip()).name.lstrip("-") in {"fish", "herdr"}:
            return True
        pid = int(parent)
    return False


def open_handoff(
    profile: str, worker_command: Sequence[str], *, env: Host = DEFAULT_HOST
) -> None:
    # Do not start the normal login shell: Fish would attach to Herdr again.
    # A separate Ghostty instance also lets the original window close safely.
    prefix = env.brew_prefix
    path = f"{env.home() / '.local/bin'}:{prefix / 'bin'}:{prefix / 'sbin'}:/usr/bin:/bin:/usr/sbin:/sbin"
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
            *worker_command,
        )
    )
    env.run(
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


def handoff_if_needed(
    profile: str,
    *,
    worker: bool,
    worker_command: Sequence[str],
    env: Host = DEFAULT_HOST,
) -> bool:
    env.require_local_terminal()
    if needs_handoff(env=env):
        if worker:
            raise ValueError("maintenance terminal is not independent of Fish or Herdr")
        open_handoff(profile, worker_command, env=env)
        return True
    return False


@dataclass(frozen=True)
class UserAgentJob(host.LaunchdJob):
    programs: tuple[Path, ...] = ()

    def __post_init__(self):
        if not self.domain.startswith("gui/"):
            raise ValueError(
                f"workstation cleanup only manages user LaunchAgents, not {self.target}"
            )

    def _mutate(self, action, *args, env: Host = DEFAULT_HOST):
        env.run((host.LAUNCHCTL, action, *args), check=True, timeout=90)

    def stop(self, *, env: Host = DEFAULT_HOST):
        self._mutate(*self.bootout_args, env=env)

    def restore(self, *, env: Host = DEFAULT_HOST):
        if not self.details(probe_fn=env.probe):
            self._mutate(*self.bootstrap_args, env=env)
        elif self.label == "dev.mise.colima-default":
            # A failed bootout can leave the wrapper up even after the VM stopped.
            self._mutate("kickstart", "-k", self.target, env=env)
        env.wait_for(
            lambda: self.pid(probe_fn=env.probe) is not None, self.target, timeout=20
        )


def jobs(profile: str, *, env: Host = DEFAULT_HOST) -> list[UserAgentJob]:
    home = env.home()
    prefix = env.brew_prefix
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
    gui = f"gui/{env.uid()}"
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


def process_tree(*, env: Host = DEFAULT_HOST) -> dict[int, tuple[int, str]]:
    result = host.checked(env.probe("/bin/ps", "-axo", "pid=,ppid=,comm="))
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


def colima_pids(tree, *, env: Host = DEFAULT_HOST):
    # Lima and Colima can reparent helpers to launchd, outside the wrapper's tree.
    vm_dir = env.home() / ".colima/_lima"
    running = {vm["name"] for vm in lima_instances(env=env) if vm["status"] != "Stopped"}
    if "colima" not in running:
        return set()
    candidates = [
        pid for pid, (_, name) in tree.items() if name in {"colima", "limactl"}
    ]
    if not candidates:
        return set()
    output = env.probe(
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


def stale_programs(pids, programs, *, env: Host = DEFAULT_HOST):
    if not pids or not programs:
        return []
    result = env.probe(
        LSOF,
        "-nP",
        "-a",
        "-d",
        "txt",
        "-p",
        ",".join(map(str, sorted(pids))),
        "-F0pfin",
    )
    if result.returncode and result.stderr:
        host.checked(result)
    running = {
        (Path(entry.name), entry.inode)
        for entry in parse_lsof(result.stdout)
        if entry.name.startswith("/")
    }
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


def service_changes(profile, blockers, tree, *, env: Host = DEFAULT_HOST):
    changes = []
    for job in jobs(profile, env=env):
        pid = job.pid(probe_fn=env.probe)
        if pid is None:
            continue  # Do not start stopped or unloaded jobs.
        pids = descendants({pid}, tree)
        if job.label == "dev.mise.colima-default":
            pids.update(descendants(colima_pids(tree, env=env), tree))
        if pids & blockers:
            changes.append(Change(job, pids, True, "holds a planned removal target"))
        elif stale := stale_programs(pids, job.programs, env=env):
            changes.append(
                Change(job, pids, False, "stale executable: " + ", ".join(stale))
            )
    return changes


def check_replacements(programs: Sequence[Path], targets: Sequence[Path]) -> None:
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


def lima_instances(*, env: Host = DEFAULT_HOST):
    lima_home = env.home() / ".colima/_lima"
    listing = host.checked(
        env.probe(
            "/usr/bin/env",
            f"LIMA_HOME={lima_home}",
            str(env.brew_prefix / "bin/limactl"),
            "list",
            "--json",
        )
    )
    return [json.loads(line) for line in listing.splitlines()]


def stop_colima(*, env: Host = DEFAULT_HOST):
    # Do not cut power to the VM by unloading the job first, and never force stop.
    for vm in lima_instances(env=env):
        if vm["name"] == "colima" and vm["status"] != "Stopped":
            env.run(
                (
                    "mise",
                    "exec",
                    "--",
                    str(env.brew_prefix / "bin/colima"),
                    "stop",
                    "--profile",
                    "default",
                ),
                timeout=180,
                check=True,
            )
            break


def fish_identity(pid: int, *, env: Host = DEFAULT_HOST) -> str | None:
    result = env.probe("/bin/ps", "-p", str(pid), "-o", "uid=,tty=,lstart=,comm=")
    if result.returncode == 1 and not result.stderr:
        return None  # Process exited.
    identity = host.checked(result).strip()
    uid, tty, *_, name = identity.split(maxsplit=7)
    if (
        uid == str(env.uid())
        and tty != "??"
        and Path(name).name.lstrip("-") == "fish"
    ):
        return identity
    return None


def blocking_fish(pids, *, env: Host = DEFAULT_HOST) -> dict[int, str]:
    fish = {}
    for pid in sorted(pids):
        if not (identity := fish_identity(pid, env=env)):
            continue
        result = env.probe(LSOF, "-nP", "-a", "-d", "txt", "-p", str(pid), "-F0pn")
        if any(
            entry.name.endswith("/bin/fish")
            and entry.name.startswith(f"{env.brew_prefix}/Cellar/fish/")
            for entry in parse_lsof(result.stdout)
        ):
            fish[pid] = identity
    return fish


def close_fish(fish: Mapping[int, str], *, env: Host = DEFAULT_HOST) -> None:
    # Only signal the same confirmed, same-user processes that blocked the plan.
    for pid, identity in fish.items():
        if fish_identity(pid, env=env) == identity:
            try:
                env.kill(pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
    env.wait_for(
        lambda: all(
            fish_identity(pid, env=env) != ident for pid, ident in fish.items()
        ),
        "old Fish shells to exit",
    )


@dataclass(frozen=True)
class Herdr:
    binary: Path
    name: str
    socket: str

    def pids(self, tree, *, env: Host = DEFAULT_HOST):
        candidates = [pid for pid, (_, name) in tree.items() if name == "herdr"]
        if not candidates:
            return set()
        result = env.probe(
            LSOF,
            "-nP",
            "-a",
            "-U",
            "-p",
            ",".join(map(str, candidates)),
            "-F0pn",
        )
        owners = {
            entry.pid for entry in parse_lsof(result.stdout) if entry.name == self.socket
        }
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

    def status(self, *, env: Host = DEFAULT_HOST):
        return json.loads(host.checked(env.probe(*self.command, "status", "--json")))[
            "server"
        ]

    def stop(self, *, env: Host = DEFAULT_HOST):
        host.checked(env.probe(*self.command, "server", "stop"))
        env.wait_for(
            lambda: not self.status(env=env)["running"], f"Herdr {self.name} to exit"
        )

    def restore(self, *, env: Host = DEFAULT_HOST):
        if self.status(env=env)["running"]:
            return
        server = env.popen(
            (*self.command, "server"),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        env.wait_for(
            lambda: self.status(env=env)["running"] or server.poll() is not None,
            f"Herdr {self.name} to start",
        )
        if not self.status(env=env)["running"]:
            raise ValueError(f"Herdr {self.name} failed to start; see the Herdr logs")


def stale_herdr(*, env: Host = DEFAULT_HOST) -> list[Herdr]:
    binary = Path(host.checked(env.probe("mise", "which", "herdr")).strip())
    sessions = json.loads(
        host.checked(env.probe(str(binary), "session", "list", "--json"))
    )["sessions"]
    result = []
    for row in sessions:
        if row["running"]:
            session = Herdr(binary, row["name"], row["socket_path"])
            status = session.status(env=env)
            if status.get("server_binary_stale") or status.get("restart_needed"):
                result.append(session)
    return result


@contextmanager
def paused(jobs_to_pause, sessions, fish, *, env: Host = DEFAULT_HOST):
    # Record intent before the operation: an interrupted command can still have
    # stopped a job. Restore every attempted job, even if another restore fails.
    attempted_jobs, attempted_sessions = [], []
    failures = []
    try:
        for session in sessions:
            attempted_sessions.append(session)
            session.stop(env=env)
        close_fish(fish, env=env)
        for job in reversed(jobs_to_pause):
            print(f"Stopping {job.label}", flush=True)
            if job.label == "dev.mise.colima-default":
                stop_colima(env=env)
            attempted_jobs.append(job)
            job.stop(env=env)
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
                item.restore(env=env)
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
    env: Host = DEFAULT_HOST

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
            programs.append(self.env.brew_prefix / "bin/fish")
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

    def check_replacements(self, targets: Sequence[Path]) -> None:
        check_replacements(self.programs, targets)

    @contextmanager
    def paused_for_prune(self):
        blocking_jobs = [change.job for change in self.changes if change.blocking]
        with paused(blocking_jobs, self.before, self.fish, env=self.env):
            yield

    def refresh_deferred(self) -> None:
        refresh_jobs = [change.job for change in self.changes if not change.blocking]
        if refresh_jobs or self.after:
            # These processes did not need to be offline while packages were pruned.
            with paused(refresh_jobs, self.after, {}, env=self.env):
                pass


def plan_maintenance(
    processes, profile: str, *, env: Host = DEFAULT_HOST
) -> MaintenancePlan:
    blockers = {item.pid for item in processes if item.pid}
    tree = process_tree(env=env)
    changes = tuple(service_changes(profile, blockers, tree, env=env))
    fish = blocking_fish(blockers, env=env)
    before, after = [], []
    covered = set(fish)
    for change in changes:
        if change.blocking:
            covered.update(change.pids)
    for session in stale_herdr(env=env):
        pids = session.pids(tree, env=env) if blockers else set()
        if pids & blockers:
            before.append(session)
            covered.update(pids)
        else:
            after.append(session)
    unknown = tuple(item.message for item in processes if item.pid not in covered)
    return MaintenancePlan(changes, tuple(before), tuple(after), fish, unknown, env)
