#!/usr/bin/env python3
"""Print the path of an installed macOS application matching a bundle ID."""

from __future__ import annotations

import argparse

from audit import app_bundle_paths, plist_metadata


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle_id")
    args = parser.parse_args()

    for application in app_bundle_paths():
        bundle_id, _display_name = plist_metadata(application)
        if bundle_id == args.bundle_id:
            print(application)
            return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
