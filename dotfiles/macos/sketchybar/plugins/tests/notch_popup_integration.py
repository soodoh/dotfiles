#!/usr/bin/env python3
"""Opt-in test against a running MacBook bar; moves/restores the pointer.

Run: python3 dotfiles/macos/sketchybar/plugins/tests/notch_popup_integration.py
Requires existing input-monitoring permission; never prompts for it or bootstraps.
Unlike the fast mocked tests, this checks actual mouse delivery/window layering.
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


def query(name):
    return json.loads(subprocess.check_output(["sketchybar", "--query", name]))


def wait_for_popup(expected):
    for _ in range(40):
        actual = query("notch.stats")["popup"]["drawing"]
        if actual == expected:
            return
        time.sleep(0.05)
    raise AssertionError(f"Popup expected {expected}, got {actual}")


mouse_source = """
import CoreGraphics
import Foundation
if !CGPreflightPostEventAccess() { fputs("Input permission required\\n", stderr); exit(1) }
let mode=CommandLine.arguments[1]
if mode == "windows" {
  let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as! [[String:Any]]
  let filtered=windows.compactMap { w -> [String:Any]? in
    guard let b=w[kCGWindowBounds as String] as? [String:Double] else { return nil }
    return ["owner":w[kCGWindowOwnerName as String] ?? "", "layer":w[kCGWindowLayer as String] ?? 0, "bounds":b]
  }
  let data=try! JSONSerialization.data(withJSONObject:filtered)
  print(String(decoding:data,as:UTF8.self))
  exit(0)
}
if mode == "location" {
  let p=CGEvent(source:nil)!.location
  print("\\(p.x) \\(p.y)")
  exit(0)
}
let p=CGPoint(x:Double(CommandLine.arguments[2])!,y:Double(CommandLine.arguments[3])!)
func move(_ point:CGPoint) {
  CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)!.post(tap:.cghidEventTap)
}
move(p)
Thread.sleep(forTimeInterval:0.2)
if mode == "click" {
  for type in [CGEventType.leftMouseDown,.leftMouseUp] {
    CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:p,mouseButton:.left)!.post(tap:.cghidEventTap)
  }
}
"""

assert shutil.which("sketchybar"), "SketchyBar must already be installed/running"
bar = query("bar")
assert "notch.stats" in bar["items"], "Connect a notched display and reload the config"
with tempfile.TemporaryDirectory(prefix="sketchybar-popup-test-") as tmp:
    source = Path(tmp) / "mouse.swift"
    binary = Path(tmp) / "mouse"
    source.write_text(mouse_source)
    subprocess.run(["xcrun", "swiftc", str(source), "-o", str(binary)], check=True)
    original = subprocess.check_output([str(binary), "location"], text=True).split()

    def mouse(mode, x, y):
        if mode == "hover":
            # Reveal the native menu at this display's top edge, then leave its
            # region so it can auto-hide before checking SketchyBar's hover.
            subprocess.run([str(binary), "move", str(x), str(display["frame"]["y"])], check=True)
            time.sleep(1.2)
            subprocess.run([str(binary), "move", str(x), str(y + 350)], check=True)
            time.sleep(1.2)
            mode = "move"
        subprocess.run([str(binary), mode, str(x), str(y)], check=True)

    try:
        host = query("notch.stats")
        key, rect = next((k, r) for k, r in host["bounding_rects"].items() if r["origin"][0] > -9000)
        x = rect["origin"][0] + rect["size"][0] / 2
        y = rect["origin"][1] + rect["size"][1] / 2
        subprocess.run(["sketchybar", "--set", "notch.stats", "popup.drawing=off"], check=True)
        wait_for_popup("off")
        # Native menus keep precedence; guards only restack SketchyBar content
        # above its own opaque background, not above the revealed native menu.
        assert bar["topmost"] == "off", "SketchyBar covers native menu headers"
        # Click otherwise inert bar areas without obscuring the content windows.
        displays = query("displays")
        display = next(d for d in displays if f"display-{d['arrangement-id']}" == key)
        for monitor in displays:
            guard = query(f"bar.guard.{monitor['arrangement-id']}")
            guard_rect = guard["bounding_rects"][f"display-{monitor['arrangement-id']}"]
            assert guard_rect["origin"][0] == monitor["frame"]["x"], "Guard does not start at its display edge"
            assert guard_rect["size"][0] <= monitor["frame"]["w"], "Guard intercepts adjacent-display application clicks"
        targets = ["notch.clock", "notch.volume", "notch.ai_usage.providers", "background", "left-edge", "right-edge"]
        for initially_open in (False, True):
            for target in targets:
                if initially_open:
                    mouse("move", x, y)
                    wait_for_popup("on")
                if target == "background":
                    tx = display["frame"]["x"] + 500
                elif target == "left-edge":
                    tx = display["frame"]["x"] + 5
                elif target == "right-edge":
                    tx = display["frame"]["x"] + display["frame"]["w"] - 5
                else:
                    target_rect = query(target)["bounding_rects"][key]
                    tx = target_rect["origin"][0] + target_rect["size"][0] / 2
                mouse("click", tx, y)
                time.sleep(0.2)
                wait_for_popup("off")
                current = query("bar")
                windows = json.loads(subprocess.check_output([str(binary), "windows"]))
                assert current["hidden"] == "off" and current["drawing"] == "on", "Outside click hides the bar"
                clock_rect = query("notch.clock")["bounding_rects"][key]
                clock_index = next(i for i, w in enumerate(windows) if w["owner"] == "sketchybar" and w["bounds"]["X"] == clock_rect["origin"][0] and w["bounds"]["Y"] == clock_rect["origin"][1] and w["bounds"]["Width"] == clock_rect["size"][0])
                background_index = next(i for i, w in enumerate(windows) if w["owner"] == "sketchybar" and w["bounds"]["Width"] == display["frame"]["w"] and w["bounds"]["X"] == display["frame"]["x"] and w["bounds"]["Y"] == clock_rect["origin"][1])
                assert clock_index < background_index, "Outside click raises the opaque bar background above its content windows"
                print(f"Outside click {target}, popup initially {'open' if initially_open else 'closed'}: content remains above background")
        for cycle in range(6):
            # Hover opens without a click after the native menu has hidden.
            # The popup remains open while traversing its combined hover region.
            mouse("hover", x, y)
            wait_for_popup("on")
            cpu = query("notch.cpu")
            ram = query("notch.ram")
            for metric in (cpu, ram):
                assert metric["icon"]["font"] == metric["label"]["font"], "Popup typography differs between columns"
                assert metric["icon"]["width"] + metric["label"]["width"] == metric["geometry"]["width"], "Popup columns do not fill the row"
                assert metric["label"]["align"] == "right", "Popup values are not aligned"
                assert metric["icon"]["padding_left"] == metric["label"]["padding_right"], "Popup gutters are asymmetric"
            assert cpu["label"]["width"] == ram["label"]["width"], "CPU/RAM value columns differ"
            row = cpu["bounding_rects"][key]
            assert row["origin"][0] > -9000, "Popup contents not rendered"
            assert abs(row["origin"][0] + row["size"][0] / 2 - x) <= 2, "Popup not centered beneath stats button"
            mouse("move", x, row["origin"][1] + row["size"][1] / 2)
            wait_for_popup("on")
            subprocess.run(["sketchybar", "--trigger", "notch_usage_change"], check=True)
            time.sleep(0.2)
            wait_for_popup("on")
            mouse("click", x, y)
            wait_for_popup("on")
            mouse("move", x + rect["size"][0], y)
            wait_for_popup("off")
            assert query("bar")["drawing"] == "on", "Bar disappeared"
            print(f"Cycle {cycle + 1}: hover-open, popup traversal, reflow, inert click, and hover-exit pass")

        mouse("move", x, y)
        wait_for_popup("on")
        mouse("move", x, y + 350)
        wait_for_popup("off")
        print("Moving away dismisses the popup")

        # Exercise real CoreText sizing + the rendered scroll viewport, not just
        # mocked properties. Keep updater scripts from replacing the test text.
        provider = query("notch.ai_usage.providers")
        refresh_updates = query("ai_usage.refresh")["scripting"]["updates"]
        plugin_dir = Path(__file__).resolve().parents[1]
        env = dict(os.environ, CONFIG_DIR=str(plugin_dir.parent))

        def reflow():
            subprocess.run(
                ["/bin/bash", "-c", 'source "$CONFIG_DIR/plugins/notch_layout.sh"; apply_notch_layout'],
                env=env, check=True,
            )

        def set_usage(text):
            subprocess.run(["sketchybar", "--set", "notch.ai_usage.providers", "drawing=on", f"label={text}"], check=True)
            reflow()

        try:
            subprocess.run(["sketchybar", "--set", "ai_usage.refresh", "updates=off"], check=True)
            long_text = "󰀄 100% (7d) ·  100% (30d) · " * 8
            set_usage(long_text)
            scrolling = query("notch.ai_usage.providers")
            assert scrolling["label"]["value"] == long_text, "Scroll drops part of the provider data"
            assert scrolling["label"]["font"].endswith(":9.00"), "Overflow should scroll at 9pt"
            assert scrolling["geometry"]["scroll_texts"] == "on", "Overflow did not enable periodic scrolling"
            viewport = scrolling["bounding_rects"][key]
            for item in ("notch.volume", "notch.battery"):
                status = query(item)
                status_rect = status["bounding_rects"][key]
                assert status["geometry"]["position"] == "right", "Overflow displaced sound/battery"
                assert status_rect["origin"][0] > -9000, "Sound/battery no longer rendered"
                assert viewport["origin"][0] + viewport["size"][0] <= status_rect["origin"][0], "Scrolling usage overlaps sound/battery"
            print("Long provider usage: bounded 9pt periodic scroll; sound/battery remain visible")

            # Content recovery must remove max_chars as well as stop scrolling.
            short_text = "󰀄 12% ·  18%"
            set_usage(short_text)
            recovered = query("notch.ai_usage.providers")
            assert recovered["geometry"]["scroll_texts"] == "off", "Short usage still scrolls"
            assert recovered["label"]["font"].endswith(":12.00"), "Short usage did not recover full font size"
            measurements = json.loads(subprocess.check_output(
                ["/bin/bash", "-c", 'source "$CONFIG_DIR/plugins/notch_layout.sh"; notch_usage_measurements "$TEST_USAGE" 9999'],
                env=dict(env, TEST_USAGE=short_text),
            ))
            full_width = next(m["width"] for m in measurements if m["size"] == 12)
            label = recovered["label"]
            expected = full_width + label["padding_left"] + label["padding_right"]
            assert abs(recovered["bounding_rects"][key]["size"][0] - expected) <= 1, "Recovery left the provider label capped"
            print("Short provider usage: full 12pt text restored without scrolling")
        finally:
            try:
                subprocess.run(["sketchybar", "--set", "notch.ai_usage.providers",
                                f"drawing={provider['geometry']['drawing']}", f"label={provider['label']['value']}"], check=True)
                reflow()
            finally:
                # A detector/query failure must not leave normal refresh paused.
                subprocess.run(["sketchybar", "--set", "ai_usage.refresh", f"updates={refresh_updates}"], check=True)
    finally:
        subprocess.run(["sketchybar", "--set", "notch.stats", "popup.drawing=off"], check=False)
        mouse("move", *original)
