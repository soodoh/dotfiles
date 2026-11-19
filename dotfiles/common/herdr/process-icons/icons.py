"""Label Herdr tabs with Nerd Font icons for the processes running in their panes."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import select
import socket
import sys
import time
from pathlib import Path

# Nerd Fonts 3.x code points; every glyph exists in FiraCode Nerd Font Mono 3.5.0.
ICONS = {
    "neovim": "\uf36f",  # nf-linux-neovim
    "pi": "\U000f03ff",  # nf-md-pi
    "browser": "\U000f059f",  # nf-md-web
    "git": "\U000f02a2",  # nf-md-git
    "ssh": "\U000f08c0",  # nf-md-ssh
    "docker": "\U000f0868",  # nf-md-docker
    "azure": "\U000f0805",  # nf-md-microsoft_azure
    "kubernetes": "\U000f10fe",  # nf-md-kubernetes
    "monitor": "\U000f0a07",  # nf-md-monitor_dashboard
    "python": "\U000f0320",  # nf-md-language_python
    "bun": "\ue76f",  # nf-dev-bun
    "node": "\ue719",  # nf-dev-nodejs
    "shell": "\uea85",  # nf-cod-terminal
    "other": "\U000f070e",  # nf-md-run
}
EXECUTABLES = {
    "neovim": ("nvim", "vim", "vi", "view", "vimdiff"),
    "pi": ("pi",),
    "browser": ("terminal-browser",),
    "git": ("git", "lazygit", "tig", "gitui"),
    "ssh": ("ssh", "mosh", "mosh-client", "autossh"),
    "docker": ("docker", "docker-compose", "colima", "lima", "limactl", "podman"),
    "azure": ("az",),
    "kubernetes": ("kubectl", "k9s", "helm"),
    "monitor": ("btop", "htop", "top", "btm", "gotop"),
    "python": ("python", "python3", "ipython", "uv", "uvx", "pip", "pip3"),
    "bun": ("bun", "bunx"),
    "node": ("node", "npm", "npx", "yarn", "pnpm", "corepack", "tsx"),
    "shell": ("fish", "bash", "zsh", "sh", "dash", "ksh", "tcsh", "nu"),
}
ICON_BY_EXECUTABLE = {
    name: ICONS[kind] for kind, names in EXECUTABLES.items() for name in names
}
MANAGED_ICONS = frozenset(ICONS.values())

DEBOUNCE_SECONDS = 0.15
# Fish retitles a pane just before it forks a command, and version-manager
# wrappers can exec into the real program later, so check each change twice.
RECHECK_SECONDS = 1.0
REQUEST_TIMEOUT_SECONDS = 3.0
STARTUP_ELECTION_SECONDS = 5.0
EVENTS = (
    "pane.created",
    "pane.updated",
    "pane.closed",
    "pane.moved",
    "pane.exited",
    "pane.agent_detected",
    "layout.updated",
    "tab.created",
    "tab.renamed",
)
ALL_TABS = "*"


def executable_names(process):
    """Names a process may be known by: its argv0 (e.g. pi under node), then its image."""
    names = []
    for value in (process.get("argv0"), process.get("name")):
        if isinstance(value, str) and value:
            # Login shells prefix argv0 with "-"; versioned interpreters add suffixes.
            base = os.path.basename(value).lstrip("-").lower()
            names.append(base)
            if base.startswith("python"):
                names.append("python")
    return names


def classify(process_info):
    """Return one icon for a pane, preferring the foreground process-group leader."""
    processes = process_info.get("foreground_processes") or []
    leader = process_info.get("foreground_process_group_id")
    # Agents run tool commands inside their own group; the leader is the program
    # the user launched.
    processes = sorted(processes, key=lambda process: process.get("pid") != leader)
    if not processes:
        return ICONS["shell"]
    for name in executable_names(processes[0]):
        if name in ICON_BY_EXECUTABLE:
            return ICON_BY_EXECUTABLE[name]
    return ICONS["other"]


def tab_icons(pane_icons):
    """Distinct pane icons in layout order; idle shells only when nothing else runs."""
    distinct = list(dict.fromkeys(pane_icons))
    busy = [icon for icon in distinct if icon != ICONS["shell"]]
    return busy or distinct


def user_text(label):
    """Text the user typed after any managed icons; Herdr's positional default is dropped."""
    words = label.split(" ")
    while words and (words[0] in MANAGED_ICONS or not words[0]):
        words.pop(0)
    text = " ".join(words).strip()
    # Herdr labels unnamed tabs with their 1-based position.
    return "" if text.isdecimal() else text


def compose_label(current, icons):
    return " ".join([*icons, user_text(current)]).strip()


def affected_tabs(envelope, pane_tabs):
    """Tabs whose labels an event can change; ALL_TABS when the tab is unknown."""
    data = envelope.get("data") or {}
    tabs = []
    for container in ("pane", "layout", "tab"):
        value = data.get(container)
        if isinstance(value, dict) and value.get("tab_id"):
            tabs.append(value["tab_id"])
    for key in ("tab_id", "previous_tab_id"):
        if data.get(key):
            tabs.append(data[key])
    if not tabs and data.get("pane_id"):
        tabs.append(pane_tabs.get(data["pane_id"], ALL_TABS))
    return tabs or [ALL_TABS]


class ApiError(RuntimeError):
    pass


class Api:
    """One request per connection, as Herdr's socket server expects."""

    def __init__(self, socket_path):
        self.socket_path = socket_path

    def connect(self):
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(REQUEST_TIMEOUT_SECONDS)
        connection.connect(self.socket_path)
        return connection

    def call(self, method, params):
        with self.connect() as connection:
            send(connection, method, params)
            with connection.makefile("r", encoding="utf-8") as reader:
                return response(reader.readline())

    def snapshot(self):
        return self.call("session.snapshot", {})["snapshot"]

    def process_info(self, pane_id):
        return self.call("pane.process_info", {"pane_id": pane_id})["process_info"]

    def rename_tab(self, tab_id, label):
        self.call("tab.rename", {"tab_id": tab_id, "label": label})


def send(connection, method, params):
    request = {"id": f"process-icons:{method}", "method": method, "params": params}
    connection.sendall((json.dumps(request) + "\n").encode())


def response(line):
    if not line:
        raise ApiError("Herdr closed the connection without a response")
    message = json.loads(line)
    if "error" in message:
        error = message["error"]
        raise ApiError(f"{error.get('code')}: {error.get('message')}")
    return message["result"]


class Labeler:
    """Coalesces events per tab and renames only tabs whose computed label changed."""

    def __init__(self, api, clock=time.monotonic):
        self.api = api
        self.clock = clock
        self.pane_tabs = {}
        self.soon = {}
        self.later = {}

    def observe(self, envelope):
        now = self.clock()
        for tab in affected_tabs(envelope, self.pane_tabs):
            self.soon.setdefault(tab, now + DEBOUNCE_SECONDS)
            self.later[tab] = now + RECHECK_SECONDS

    def timeout(self):
        deadlines = [*self.soon.values(), *self.later.values()]
        return max(0.0, min(deadlines) - self.clock()) if deadlines else None

    def flush(self):
        now = self.clock()
        due = set()
        for pending in (self.soon, self.later):
            for tab, deadline in list(pending.items()):
                if deadline <= now:
                    due.add(tab)
                    del pending[tab]
        if due:
            self.refresh(due)

    def refresh(self, tabs):
        snapshot = self.api.snapshot()
        self.pane_tabs = {pane["pane_id"]: pane["tab_id"] for pane in snapshot["panes"]}
        layouts = {layout["tab_id"]: layout for layout in snapshot["layouts"]}
        for tab in snapshot["tabs"]:
            if ALL_TABS not in tabs and tab["tab_id"] not in tabs:
                continue
            layout = layouts.get(tab["tab_id"])
            if layout is None:
                continue
            # Read left-to-right, then top-to-bottom within a column.
            panes = sorted(
                layout["panes"], key=lambda pane: (pane["rect"]["x"], pane["rect"]["y"])
            )
            pane_icons = []
            for pane in panes:
                try:
                    pane_icons.append(classify(self.api.process_info(pane["pane_id"])))
                except (ApiError, OSError):
                    continue  # The pane closed mid-refresh; its own event follows.
            icons = tab_icons(pane_icons)
            label = compose_label(tab["label"], icons)
            if icons and label != tab["label"]:
                try:
                    self.api.rename_tab(tab["tab_id"], label)
                except ApiError:
                    continue  # The tab closed mid-refresh.


def elect(state_dir, socket_path, wait_seconds):
    """Hold a per-server lock so exactly one watcher labels a session's tabs."""
    digest = hashlib.sha256(socket_path.encode()).hexdigest()[:12]
    state_dir.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(
        state_dir / f"watcher-{digest}.lock", os.O_RDWR | os.O_CREAT, 0o600
    )
    # A previous server's watcher exits once its event stream closes.
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return descriptor
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(descriptor)
                return None
            time.sleep(0.05)


def watch(api, labeler):
    with api.connect() as stream:
        send(
            stream, "events.subscribe", {"subscriptions": [{"type": e} for e in EVENTS]}
        )
        stream.settimeout(None)
        buffer = b""
        # Read the acknowledgement before the initial pass so no event is missed.
        while b"\n" not in buffer:
            chunk = stream.recv(65536)
            if not chunk:
                raise ApiError("Herdr closed the event stream before acknowledging it")
            buffer += chunk
        line, buffer = buffer.split(b"\n", 1)
        response(line.decode())
        labeler.refresh({ALL_TABS})
        while True:
            lines = buffer.split(b"\n")
            buffer = lines.pop()
            for line in lines:
                if line.strip():
                    labeler.observe(json.loads(line))
            labeler.flush()
            readable, _, _ = select.select([stream], [], [], labeler.timeout())
            if readable:
                chunk = stream.recv(65536)
                if not chunk:
                    return  # The server stopped; a later hook elects a new watcher.
                buffer += chunk


def main():
    if sys.argv[1:] != ["watch"]:
        sys.exit("usage: icons.py watch")
    socket_path = os.environ["HERDR_SOCKET_PATH"]
    state_dir = Path(os.environ["HERDR_PLUGIN_STATE_DIR"])
    startup = os.environ.get("HERDR_PLUGIN_EVENT") == "startup"
    lock = elect(state_dir, socket_path, STARTUP_ELECTION_SECONDS if startup else 0)
    if lock is None:
        return
    api = Api(socket_path)
    watch(api, Labeler(api))


if __name__ == "__main__":
    try:
        main()
    except (ApiError, KeyError, OSError, ValueError) as error:
        sys.exit(f"process-icons: {error}")
