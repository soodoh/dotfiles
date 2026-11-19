"""Behavior of tab labeling against fake Herdr state; never contacts a live server."""

import os
import tempfile
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


if __name__ == "__main__":
    unittest.main()
