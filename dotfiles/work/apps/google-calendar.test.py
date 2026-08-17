#!/usr/bin/env python3
import plistlib
from pathlib import Path

app = Path(__file__).with_name("Google Calendar.app")
with (app / "Contents/Info.plist").open("rb") as handle:
    info = plistlib.load(handle)

assert info["CFBundleIdentifier"] == "dev.soodoh.google-calendar"
assert info["CFBundleExecutable"] == "google-calendar"
assert (app / "Contents/MacOS/google-calendar").stat().st_mode & 0o111
assert (app / "Contents/Resources/ApplicationIcon.icns").is_file()
