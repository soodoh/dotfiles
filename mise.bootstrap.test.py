import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parent


def load_toml(name: str) -> dict:
    with (ROOT / name).open("rb") as config_file:
        return tomllib.load(config_file)


def assert_work_profile_loads_without_secrets() -> None:
    mise = shutil.which("mise")
    assert mise is not None, "mise must be available to validate profile loading"
    with tempfile.TemporaryDirectory() as home:
        environment = {
            "CI": "1",
            "HOME": home,
            "MISE_TRUSTED_CONFIG_PATHS": str(ROOT),
            "MISE_YES": "1",
            "PATH": os.defpath,
        }
        result = subprocess.run(
            [mise, "--env", "work-macos", "config"],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
    assert result.returncode == 0, (
        "work profile must load without age keys or SSL_CERT_FILE:\n" + result.stderr
    )


def assert_tools_locked(config_name: str, lock_name: str) -> dict:
    config_tools = load_toml(config_name).get("tools", {})
    lock_tools = load_toml(lock_name).get("tools", {})
    for tool, specification in config_tools.items():
        version = (
            specification
            if isinstance(specification, str)
            else specification["version"]
        )
        entries = lock_tools.get(tool, [])
        assert any(entry["version"] == version for entry in entries), (
            f"{config_name}: {tool}@{version} is missing from {lock_name}"
        )
    return lock_tools


base = load_toml("mise.toml")
work = load_toml("mise.work-macos.toml")

certificate_variables = (
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "AWS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "HTTPLIB2_CA_CERTS",
)
assert all(
    work["env"][variable] == "${SSL_CERT_FILE:-}" for variable in certificate_variables
)
assert_work_profile_loads_without_secrets()

base_lock_tools = assert_tools_locked("mise.toml", "mise.lock")
assert_tools_locked("mise.personal-macos.toml", "mise.personal-macos.lock")
assert_tools_locked("mise.work-macos.toml", "mise.work-macos.lock")

python_version = base["tools"]["python"]
assert "{{" not in python_version

yarn_version = base["tools"]["aqua:yarnpkg/berry"]
assert yarn_version == "4.18.0"
assert "yarn" not in base["tools"]
yarn_lock = next(
    entry
    for entry in base_lock_tools["aqua:yarnpkg/berry"]
    if entry["version"] == yarn_version
)
for platform in ("linux-arm64", "linux-x64", "macos-arm64", "macos-x64"):
    assert yarn_lock[f"platforms.{platform}"]["url"]

pre_packages = base["bootstrap"]["hooks"]["pre-packages"]
assert "mise bootstrap packages apply brew:mas --yes" in pre_packages
assert "brew:mas" in base["bootstrap"]["packages"]

homebrew_task = base["tasks"]["bootstrap:homebrew-packages"]
assert homebrew_task["interactive"] is True

lock_task = base["tasks"]["lock"]
assert lock_task["run"] == "python3 mise.lock.py refresh"
assert base["tasks"]["validate:locks"]["run"] == "python3 mise.lock.py check"
assert base["tasks"]["update:tools"]["run"] == "python3 mise.lock.py update"

pre_tools = work["bootstrap"]["hooks"]["pre-tools"].splitlines()
assert pre_tools == [
    "mise install python",
    'CLOUDSDK_PYTHON="$(mise which python3)" mise install gcloud',
]

gcloud = work["tools"]["gcloud"]
assert gcloud["depends"] == ["python"]

print(f"bootstrap prerequisites: ok (python {python_version})")
