"""Verify custom reporter loading and lifecycle behavior in disposable homes."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = Path(__file__).resolve().parent
NODE = shutil.which("node")
PI = str(Path(sys.argv.pop(1)).resolve()) if len(sys.argv) > 1 else None


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="agent-state-pi-test-")
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name).resolve()
        self.agent = self.home / ".pi/agent"
        self.agent.mkdir(parents=True)
        (self.agent / "pi-extensions").symlink_to(ROOT / "pi-extensions")
        extensions = self.agent / "extensions"
        extensions.mkdir()
        (extensions / "unrelated.ts").write_text("export default function () {}\n")
        self.env = {
            "HOME": str(self.home),
            "PATH": "/usr/bin:/bin",
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "XDG_CACHE_HOME": str(self.home / ".cache"),
            "TMPDIR": str(self.home),
            "PI_CODING_AGENT_DIR": str(self.agent),
            "PI_OFFLINE": "1",
            "PI_SKIP_VERSION_CHECK": "1",
            "JITI_FS_CACHE": "false",
        }

    def run_host(self, mode, profile="personal"):
        self.assertIsNotNone(PI, 'Pass "$(mise which pi)" for actual-host tests')
        self.assertIsNotNone(NODE)
        program = "subagents-liveness-host.test.mjs" if mode.startswith("producer-") else "integration-host.test.mjs"
        result = subprocess.run(
            [NODE, str(PACKAGE / program), PI, mode, profile],
            env=self.env,
            cwd=self.home,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_profiles_load_package_once_with_or_without_legacy_copy(self):
        legacy_copies = [self.agent / f"extensions/{name}.ts" for name in ("herdr-agent-state", "moshi-hooks")]
        sentinel = 'throw new Error("legacy notification hook must not load");\n'
        for legacy in (False, True):
            if legacy:
                for copy in legacy_copies:
                    copy.write_text(sentinel)
            for profile in ("personal", "work"):
                with self.subTest(legacy=legacy, profile=profile):
                    self.run_host("load", profile)
            if legacy:
                for copy in legacy_copies:
                    self.assertEqual(copy.read_text(), sentinel)

    def test_lifecycle_and_prompt_behavior(self):
        # Profile and legacy-copy coverage belongs to loading, not every event case.
        for mode in ("outside", "popup", "rpc", "json", "print", "child", "tui"):
            with self.subTest(mode=mode):
                self.run_host(mode)

    def test_full_upstream_registers_and_disposes_in_either_extension_order(self):
        for mode in ("producer-first", "producer-last"):
            with self.subTest(mode=mode):
                self.run_host(mode)


if __name__ == "__main__":
    unittest.main()
