#!/bin/bash
set -euo pipefail

# Exercise live-test cleanup and window selection without touching the bar.
python3 - "$(dirname "$0")/notch_popup_integration.py" <<'PY'
import ast
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

source = ast.parse(Path(sys.argv[1]).read_text())
cleanup = next(
    node.finalbody for node in ast.walk(source)
    if isinstance(node, ast.Try) and any(
        isinstance(part, ast.Name) and part.id == "refresh_updates"
        for statement in node.finalbody for part in ast.walk(statement)
    )
)
cleanup_code = compile(ast.Module(body=cleanup, type_ignores=[]), "usage-cleanup", "exec")
mouse_source = next(
    ast.literal_eval(node.value) for node in source.body
    if isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == "mouse_source"
        for target in node.targets
    )
)


class IntegrationSafetyTests(unittest.TestCase):
    def test_restores_updates_even_if_provider_restore_or_reflow_fails(self):
        for updates in ("on", "off"):
            for failure in (None, "provider", "reflow"):
                with self.subTest(updates=updates, failure=failure):
                    run = Mock()
                    reflow = Mock()
                    if failure == "provider":
                        run.side_effect = [RuntimeError("restore failed"), None]
                    elif failure == "reflow":
                        reflow.side_effect = RuntimeError("detector failed")
                    scope = {
                        "subprocess": SimpleNamespace(run=run),
                        "reflow": reflow,
                        "provider": {"geometry": {"drawing": "on"}, "label": {"value": "usage"}},
                        "refresh_updates": updates,
                    }
                    if failure:
                        with self.assertRaises(RuntimeError):
                            exec(cleanup_code, scope)
                    else:
                        exec(cleanup_code, scope)
                    run.assert_any_call(
                        ["sketchybar", "--set", "ai_usage.refresh", f"updates={updates}"],
                        check=True,
                    )

    def test_hover_reveals_menu_at_selected_display_top_then_leaves_it(self):
        mouse = next(node for node in ast.walk(source) if isinstance(node, ast.FunctionDef) and node.name == "mouse")
        for top in (-200, 0, 1080):
            with self.subTest(top=top):
                run = Mock()
                scope = {
                    "subprocess": SimpleNamespace(run=run),
                    "time": SimpleNamespace(sleep=Mock()),
                    "binary": "/fixture/mouse",
                    "display": {"frame": {"y": top}},
                }
                exec(compile(ast.Module(body=[mouse], type_ignores=[]), "mouse-helper", "exec"), scope)
                scope["mouse"]("hover", -80, top + 20)
                self.assertEqual(run.call_args_list[0].args[0], ["/fixture/mouse", "move", "-80", str(top)])
                self.assertEqual(run.call_args_list[1].args[0][-1], str(top + 370))
                self.assertEqual(run.call_args_list[2].args[0], ["/fixture/mouse", "move", "-80", str(top + 20)])

    @unittest.skipUnless(sys.platform == "darwin" and shutil.which("xcrun"), "macOS window API")
    def test_window_enumerator_retains_left_and_below_primary_windows(self):
        # Inject deterministic windows at the OS boundary; execute the real
        # Swift selection code, never post a mouse event or require permission.
        fixture = """let windows: [[String: Any]] = [
          [kCGWindowOwnerName as String: "sketchybar", kCGWindowLayer as String: 20,
           kCGWindowBounds as String: ["X": -143.0, "Y": 0.0, "Width": 123.0, "Height": 40.0]],
          [kCGWindowOwnerName as String: "sketchybar", kCGWindowLayer as String: 20,
           kCGWindowBounds as String: ["X": 1369.0, "Y": 1080.0, "Width": 123.0, "Height": 40.0]]
        ]"""
        probe = re.sub(r"(?m)^  let windows=CGWindowListCopyWindowInfo.*$", "  " + fixture, mouse_source)
        probe = re.sub(r"(?m)^if !CGPreflightPostEventAccess.*$", "", probe)
        with tempfile.TemporaryDirectory(prefix="popup-window-fixture-") as tmp:
            swift = Path(tmp) / "windows.swift"
            binary = Path(tmp) / "windows"
            swift.write_text(probe)
            subprocess.run(["xcrun", "swiftc", str(swift), "-o", str(binary)], check=True)
            windows = json.loads(subprocess.check_output([str(binary), "windows"]))
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0]["bounds"]["X"], -143)
        self.assertEqual(windows[1]["bounds"]["Y"], 1080)


unittest.main(argv=[sys.argv[0]])
PY
