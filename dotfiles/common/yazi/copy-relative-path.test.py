"""Exercise Ctrl+Y in real Yazi PTYs without touching the user's clipboard/state."""

import contextlib
import fcntl
import os
import pty
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
import tomllib
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
YAZI = shutil.which("yazi")
YA = shutil.which("ya")


class CopyRelativePathTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(YAZI and YA, "yazi and ya must be on PATH")
        self.temp = tempfile.TemporaryDirectory(prefix="yazi-copy-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.clipboard = self.root / "clipboard"
        self.config = self.root / "config"
        shutil.copytree(HERE, self.config)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # Yazi tries pbcopy first on Unix, including Linux. Never reach a real
        # clipboard backend; OSC52 output is also contained in our private PTY.
        pbcopy = self.bin / "pbcopy"
        pbcopy.write_text('#!/bin/sh\n/bin/cat > "$COPY_PATH_TEST_CLIPBOARD"\n')
        pbcopy.chmod(0o755)
        self.launch = self.root / "launch"
        self.launch.mkdir()

    def git(self, *args):
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        env.update({"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})
        return subprocess.run(
            ["git", *map(str, args)], check=True, capture_output=True, text=True,
            env=env, timeout=10,
        ).stdout

    def repository(self):
        repo = self.root / "project with spaces"
        self.git("init", "--quiet", repo)
        return repo

    @contextlib.contextmanager
    def session(self, entry, launch=None):
        launch = launch or self.launch
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("YAZI", "GIT_", "SSH_")) and key != "NVIM"}
        env.update({
            "HOME": str(self.root), "PWD": str(launch),
            "XDG_CONFIG_HOME": str(self.root / "xdg-config"),
            "XDG_CACHE_HOME": str(self.root / "cache"),
            "XDG_STATE_HOME": str(self.root / "state"),
            "XDG_DATA_HOME": str(self.root / "data"),
            "YAZI_CONFIG_HOME": str(self.config),
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "TERM": "xterm-256color", "SHELL": "/bin/sh",
            "COPY_PATH_TEST_CLIPBOARD": str(self.clipboard),
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
        })
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(launch)
            os.execve(YAZI, [YAZI, "--client-id", str(os.getpid()), str(entry)], env)
        self.pid, self.fd, self.env = pid, fd, env
        self.screen = bytearray()
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        try:
            self.drain(1)
            yield
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            os.close(fd)

    def drain(self, duration):
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            if select.select([self.fd], [], [], max(0, deadline - time.monotonic()))[0]:
                try:
                    data = os.read(self.fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                self.screen.extend(data)

    def emit(self, *args):
        subprocess.run([YA, "emit-to", str(self.pid), *map(str, args)],
                       env=self.env, check=True, capture_output=True, timeout=5)
        self.drain(0.2)

    def assert_copy(self, expected):
        deadline = time.monotonic() + 5
        actual = None
        while time.monotonic() < deadline:
            os.write(self.fd, b"\x19")  # Ctrl+Y, through the committed keymap
            self.drain(0.2)
            if self.clipboard.exists():
                actual = self.clipboard.read_text()
                if actual == expected:
                    return
        self.fail(f"expected clipboard {expected!r}, got {actual!r}; PTY: {bytes(self.screen[-4000:])!r}")

    def test_git_root_from_nested_directory_and_multiple_selection(self):
        repo = self.repository()
        nested = repo / "src"
        nested.mkdir()
        first = nested / "a space 'quoted'.txt"
        second = nested / "z-λ.txt"
        first.touch()
        second.touch()
        with self.session(first, launch=nested):
            self.assert_copy("src/a space 'quoted'.txt")
            self.emit("toggle_all", "--state=on")
            self.assert_copy("src/a space 'quoted'.txt\nsrc/z-λ.txt")

    def test_linked_worktree_uses_its_own_root(self):
        repo = self.repository()
        self.git("-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "fixture")
        worktree = self.root / "linked worktree"
        self.git("-C", repo, "worktree", "add", "--quiet", "--detach", worktree)
        target = worktree / "nested" / "file.txt"
        target.parent.mkdir()
        target.touch()
        with self.session(target):
            self.assert_copy("nested/file.txt")

    def test_symlinked_subdirectory_still_uses_the_git_root(self):
        repo = self.repository()
        nested = repo / "deep" / "nested"
        nested.mkdir(parents=True)
        (nested / "file.txt").touch()
        alias = repo / "alias"
        alias.symlink_to(nested, target_is_directory=True)
        with self.session(alias / "file.txt", launch=alias):
            self.assert_copy("alias/file.txt")

    def test_non_git_base_stays_at_launch_directory_after_navigation(self):
        target = self.launch / "nested" / "file.txt"
        target.parent.mkdir()
        target.touch()
        outside = self.root / "elsewhere" / "other.txt"
        outside.parent.mkdir()
        outside.touch()
        with self.session(target):
            self.assert_copy("nested/file.txt")
            self.emit("reveal", outside)
            self.assert_copy("../elsewhere/other.txt")

    def test_browsing_into_another_repository_changes_the_base(self):
        repo = self.repository()
        target = repo / "file.txt"
        target.touch()
        initial = self.launch / "start.txt"
        initial.touch()
        with self.session(initial):
            self.assert_copy("start.txt")
            self.emit("reveal", target)
            self.assert_copy("file.txt")

    def test_empty_directory_leaves_clipboard_unchanged(self):
        self.clipboard.write_text("unchanged")
        with self.session(self.launch):
            os.write(self.fd, b"\x19")
            self.drain(0.5)
            self.assertEqual(self.clipboard.read_text(), "unchanged")

    def test_neovim_delegates_ctrl_y_to_shared_yazi_action(self):
        config = tomllib.loads((HERE / "keymap.toml").read_text())
        bindings = [item for item in config["mgr"]["prepend_keymap"] if item["on"] == "<C-y>"]
        self.assertEqual([item["run"] for item in bindings], ["plugin copy-relative-path"])
        result = subprocess.run([
            "nvim", "--headless", "-u", "NONE", "-i", "NONE",
            (
                "+lua package.loaded.yazi = { setup = function(opts) "
                "assert(opts.keymaps.copy_relative_path_to_selected_files == false); "
                "assert(opts.integrations == nil); assert(opts.open_for_directories) end }; "
                "dofile('dotfiles/common/nvim/lua/plugins/productivity/yazi.lua')[1].config()"
            ),
            "+qa",
        ], cwd=REPO, capture_output=True, text=True, timeout=10, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("Error", result.stderr)


if __name__ == "__main__":
    unittest.main()
