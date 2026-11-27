"""Behavior of tab labeling against fake Herdr state; never contacts a live server."""

import json
import os
import socket
import tempfile
import threading
import unittest
from pathlib import Path

import icons

SHELL = icons.ICONS["shell"]
NEOVIM = icons.ICONS["neovim"]
PI = icons.ICONS["pi"]


def process(pid, argv0, name=None):
    return {"pid": pid, "argv0": argv0, "name": name or argv0}


def info(*processes, leader=None):
    return {
        "foreground_process_group_id": leader or processes[0]["pid"],
        "foreground_processes": list(processes),
    }


class ClassifyTests(unittest.TestCase):
    def test_agent_tool_commands_do_not_replace_the_agent(self):
        # Pi runs Node under its own argv0 and spawns tools into its process group.
        tool = process(20, "bash")
        agent = process(10, "pi", name="node")
        self.assertEqual(icons.classify(info(tool, agent, leader=10)), PI)

    def test_login_and_versioned_names_resolve(self):
        self.assertEqual(icons.classify(info(process(1, "-fish"))), SHELL)
        python = icons.classify(info(process(1, "/usr/bin/Python3.13")))
        self.assertEqual(python, icons.ICONS["python"])

    def test_unknown_programs_and_idle_panes(self):
        self.assertEqual(
            icons.classify(info(process(1, "watch"))), icons.ICONS["other"]
        )
        self.assertEqual(icons.classify({"foreground_processes": []}), SHELL)


class LabelTests(unittest.TestCase):
    def test_idle_shells_are_hidden_beside_running_programs(self):
        self.assertEqual(icons.tab_icons([NEOVIM, SHELL, PI, NEOVIM]), [NEOVIM, PI])
        self.assertEqual(icons.tab_icons([SHELL, SHELL]), [SHELL])

    def test_labels_replace_icons_and_keep_user_text(self):
        self.assertEqual(icons.compose_label("3", [NEOVIM]), NEOVIM)
        named = icons.compose_label(f"{SHELL} api server", [NEOVIM, PI])
        self.assertEqual(named, f"{NEOVIM} {PI} api server")
        # Relabeling an already managed label must not accumulate icons.
        self.assertEqual(icons.compose_label(named, [NEOVIM, PI]), named)


class FakeApi:
    def __init__(self, tabs, panes):
        self.tabs = tabs  # tab_id -> label
        self.panes = panes  # pane_id -> (tab_id, x, process_info)
        self.renames = []

    def snapshot(self):
        layouts = {}
        for pane_id, (tab_id, x, _) in self.panes.items():
            layouts.setdefault(tab_id, []).append(
                {"pane_id": pane_id, "rect": {"x": x, "y": 0}}
            )
        return {
            "tabs": [{"tab_id": t, "label": label} for t, label in self.tabs.items()],
            "layouts": [{"tab_id": t, "panes": p} for t, p in layouts.items()],
            "panes": [{"pane_id": p, "tab_id": v[0]} for p, v in self.panes.items()],
        }

    def process_info(self, pane_id):
        if pane_id not in self.panes:
            raise icons.ApiError("pane_not_found")
        return self.panes[pane_id][2]

    def rename_tab(self, tab_id, label):
        self.renames.append((tab_id, label))
        self.tabs[tab_id] = label


class LabelerTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.api = FakeApi(
            {"w:t1": "1", "w:t2": "2"},
            {
                "w:p2": ("w:t1", 40, info(process(2, "pi", name="node"))),
                "w:p1": ("w:t1", 0, info(process(1, "nvim"))),
                "w:p3": ("w:t2", 0, info(process(3, "fish"))),
            },
        )
        self.labeler = icons.Labeler(self.api, clock=lambda: self.now)

    def advance(self, seconds):
        self.now += seconds
        self.labeler.flush()

    def test_changes_are_debounced_and_rechecked_for_late_execs(self):
        self.labeler.refresh({icons.ALL_TABS})
        self.assertEqual(
            sorted(self.api.renames), [("w:t1", f"{NEOVIM} {PI}"), ("w:t2", SHELL)]
        )
        self.api.renames.clear()
        # Fish retitles before forking: the first check still sees the shell.
        self.labeler.observe({"data": {"pane": {"tab_id": "w:t2"}}})
        self.advance(icons.DEBOUNCE_SECONDS / 2)
        self.assertEqual(self.api.renames, [])
        self.advance(icons.DEBOUNCE_SECONDS)
        self.assertEqual(self.api.renames, [])
        self.api.panes["w:p3"] = ("w:t2", 0, info(process(4, "nvim")))
        self.advance(icons.RECHECK_SECONDS)
        self.assertEqual(self.api.renames, [("w:t2", NEOVIM)])
        self.assertIsNone(self.labeler.timeout())

    def test_events_without_a_tab_use_the_known_pane_location(self):
        self.labeler.refresh({icons.ALL_TABS})
        self.api.renames.clear()
        del self.api.panes["w:p2"]
        self.labeler.observe({"data": {"pane_id": "w:p2", "workspace_id": "w"}})
        self.advance(icons.RECHECK_SECONDS)
        self.assertEqual(self.api.renames, [("w:t1", NEOVIM)])


class ElectionTests(unittest.TestCase):
    def test_one_watcher_per_server(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            first = icons.elect(state, "/run/herdr.sock", 0)
            self.addCleanup(os.close, first)
            self.assertIsNone(icons.elect(state, "/run/herdr.sock", 0))
            other = icons.elect(state, "/run/other.sock", 0)
            self.assertIsNotNone(other)
            os.close(other)


class FakeHerdrSocketServer:
    """Minimal local AF_UNIX Herdr server exercising Api and watch() end-to-end."""

    def __init__(self, socket_path, tabs, panes, *, split_ack=False, mode="normal"):
        self.socket_path = str(socket_path)
        self.tabs = dict(tabs)
        self.panes = dict(panes)
        self.split_ack = split_ack
        self.mode = mode
        self.lock = threading.Lock()
        self.subscriptions = []
        self.renames = []
        self.errors = []
        self.rename_event = threading.Event()
        self.stream_ready = threading.Event()
        self.stream_conn = None
        self.closed = threading.Event()
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(self.socket_path)
        self.server.listen(16)
        self.server.settimeout(0.2)
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def close(self):
        self.closed.set()
        with self.lock:
            stream_conn = self.stream_conn
            self.stream_conn = None
        if stream_conn is not None:
            try:
                stream_conn.close()
            except OSError:
                pass
        try:
            self.server.close()
        except OSError:
            pass
        self.thread.join(timeout=2)

    def send_event_chunked(self, envelope):
        payload = (json.dumps(envelope) + "\n").encode()
        midpoint = len(payload) // 2
        with self.lock:
            conn = self.stream_conn
        assert conn is not None
        conn.sendall(payload[:midpoint])
        conn.sendall(payload[midpoint:])

    def close_stream(self):
        with self.lock:
            conn = self.stream_conn
            self.stream_conn = None
        if conn is not None:
            conn.shutdown(socket.SHUT_WR)
            conn.close()

    def _serve(self):
        while not self.closed.is_set():
            try:
                conn, _ = self.server.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        handed_off = False
        try:
            with conn.makefile("r", encoding="utf-8") as reader:
                line = reader.readline()
            if not line:
                return
            req = json.loads(line)
            method = req["method"]
            params = req.get("params", {})

            if self.mode == "eof":
                return
            if self.mode == "error":
                reply = {"error": {"code": "boom", "message": "server failed"}}
                conn.sendall((json.dumps(reply) + "\n").encode())
                return

            if method == "events.subscribe":
                with self.lock:
                    self.subscriptions.append(params["subscriptions"])
                ack = (json.dumps({"result": {"subscribed": True}}) + "\n").encode()
                if self.split_ack:
                    conn.sendall(ack[:10])
                    conn.sendall(ack[10:])
                else:
                    conn.sendall(ack)
                with self.lock:
                    self.stream_conn = conn
                handed_off = True
                self.stream_ready.set()
                return

            with self.lock:
                if method == "session.snapshot":
                    layouts = {}
                    for pane_id, (tab_id, x, _) in self.panes.items():
                        layouts.setdefault(tab_id, []).append(
                            {"pane_id": pane_id, "rect": {"x": x, "y": 0}}
                        )
                    result = {
                        "snapshot": {
                            "tabs": [
                                {"tab_id": t, "label": label}
                                for t, label in self.tabs.items()
                            ],
                            "layouts": [
                                {"tab_id": t, "panes": p} for t, p in layouts.items()
                            ],
                            "panes": [
                                {"pane_id": p, "tab_id": v[0]}
                                for p, v in self.panes.items()
                            ],
                        }
                    }
                elif method == "pane.process_info":
                    pane_id = params["pane_id"]
                    if pane_id not in self.panes:
                        conn.sendall(
                            (
                                json.dumps(
                                    {
                                        "error": {
                                            "code": "not_found",
                                            "message": pane_id,
                                        }
                                    }
                                )
                                + "\n"
                            ).encode()
                        )
                        return
                    result = {"process_info": self.panes[pane_id][2]}
                elif method == "tab.rename":
                    tab_id, label = params["tab_id"], params["label"]
                    self.tabs[tab_id] = label
                    self.renames.append((tab_id, label))
                    self.rename_event.set()
                    result = {"ok": True}
                else:
                    raise AssertionError(f"unexpected method: {method}")
            conn.sendall((json.dumps({"result": result}) + "\n").encode())
        except OSError:
            pass
        except Exception as exc:  # noqa: BLE001
            with self.lock:
                self.errors.append(exc)
        finally:
            if not handed_off:
                try:
                    conn.close()
                except OSError:
                    pass


class _ChunkedSocket:
    """Force watch() to reassemble frames across multiple recv() calls."""

    def __init__(self, inner, chunk_size=7):
        self._inner = inner
        self._chunk_size = chunk_size

    def recv(self, bufsize, *args):
        return self._inner.recv(min(bufsize, self._chunk_size), *args)

    def __enter__(self):
        self._inner.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb):
        return self._inner.__exit__(exc_type, exc, tb)

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _ChunkedApi(icons.Api):
    def connect(self):
        return _ChunkedSocket(super().connect())


class SocketWatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="hi-")
        self.addCleanup(temporary.cleanup)
        self.socket_path = Path(temporary.name) / "s"

    def test_watch_subscribes_handles_chunked_frames_renames_and_exits_on_eof(self):
        server = FakeHerdrSocketServer(
            self.socket_path,
            {"w:t1": "1"},
            {"w:p1": ("w:t1", 0, info(process(1, "fish")))},
            split_ack=True,
        ).start()
        self.addCleanup(server.close)

        api = _ChunkedApi(str(self.socket_path))
        labeler = icons.Labeler(api)
        errors = []

        def run_watcher():
            try:
                icons.watch(api, labeler)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        watcher = threading.Thread(target=run_watcher, daemon=True)
        watcher.start()

        self.assertTrue(server.stream_ready.wait(timeout=2))
        self.assertTrue(server.rename_event.wait(timeout=2))
        self.assertEqual(server.renames, [("w:t1", SHELL)])
        self.assertEqual(
            server.subscriptions,
            [[{"type": event} for event in icons.EVENTS]],
        )

        # Mutate the pane process and deliver the event split across socket chunks.
        server.rename_event.clear()
        with server.lock:
            server.panes["w:p1"] = ("w:t1", 0, info(process(2, "nvim")))
        server.send_event_chunked({"data": {"pane": {"tab_id": "w:t1"}}})

        self.assertTrue(server.rename_event.wait(timeout=2))
        self.assertEqual(server.renames, [("w:t1", SHELL), ("w:t1", NEOVIM)])

        # Closing the event stream makes watch() exit cleanly.
        server.close_stream()
        watcher.join(timeout=2)
        self.assertFalse(watcher.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(server.errors, [])

    def test_api_and_watch_raise_on_rpc_error_and_premature_eof(self):
        error_server = FakeHerdrSocketServer(
            self.socket_path, {}, {}, mode="error"
        ).start()
        self.addCleanup(error_server.close)
        api = icons.Api(str(self.socket_path))
        with self.assertRaisesRegex(icons.ApiError, "boom: server failed"):
            api.snapshot()
        error_server.close()
        self.socket_path.unlink(missing_ok=True)

        eof_server = FakeHerdrSocketServer(self.socket_path, {}, {}, mode="eof").start()
        self.addCleanup(eof_server.close)
        with self.assertRaisesRegex(icons.ApiError, "without a response"):
            api.snapshot()
        with self.assertRaisesRegex(icons.ApiError, "before acknowledging"):
            icons.watch(api, icons.Labeler(api))


if __name__ == "__main__":
    unittest.main()
