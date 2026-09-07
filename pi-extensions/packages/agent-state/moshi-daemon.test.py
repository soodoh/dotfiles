"""Optional local protocol test; never pairs or touches the workstation service."""
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

binary = str(Path(sys.argv[1]).resolve())
node = shutil.which("node")
assert node, "Node is required"
assert sys.platform in ("darwin", "linux"), "Unix socket test only"
with tempfile.TemporaryDirectory(prefix="moshi-protocol-") as directory:
    home = Path(directory).resolve()
    endpoint = home / "hook.sock"
    env = {
        "HOME": str(home), "PATH": "/usr/bin:/bin",
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "MOSHI_SOCKET_PATH": str(endpoint),
        "PI_CODING_AGENT_DIR": str(home / ".pi/agent"),
        "PI_OFFLINE": "1", "JITI_FS_CACHE": "false",
    }
    with (home / "daemon.log").open("w") as log:
        daemon = subprocess.Popen(
            [binary, "serve", "--gateway-listen", "127.0.0.1:0", "--base-url", "http://127.0.0.1:9"],
            env=env, cwd=home, stdout=log, stderr=log,
        )
        try:
            deadline = time.monotonic() + 5
            while not endpoint.exists() and daemon.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            assert endpoint.exists(), (home / "daemon.log").read_text()
            result = subprocess.run(
                [node, str(Path(__file__).with_name("moshi-daemon-client.test.mjs"))],
                env=env, cwd=home, capture_output=True, text=True, timeout=20,
            )
            assert result.returncode == 0, result.stdout + result.stderr
            print(result.stdout.strip())
        finally:
            daemon.terminate()
            try:
                daemon.wait(timeout=5)
            except subprocess.TimeoutExpired:
                daemon.kill()
                daemon.wait(timeout=5)
