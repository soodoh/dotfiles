import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType

import tomllib

ROOT = Path(__file__).resolve().parent


def load_toml(name: str) -> dict:
    with (ROOT / name).open("rb") as config_file:
        return tomllib.load(config_file)


def load_mise_lock_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("mise_lock", ROOT / "mise.lock.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_renovate_owns_supported_mise_tools() -> None:
    renovate = json.loads((ROOT / "renovate.json").read_text())
    assert ":maintainLockFilesWeekly" in renovate["extends"]
    assert all(
        not (
            rule.get("enabled") is False
            and "mise" in rule.get("matchManagers", [])
        )
        for rule in renovate["packageRules"]
    )


def assert_repository_updates_only_unsupported_tools() -> None:
    mise_lock = load_mise_lock_module()
    assert mise_lock.UNSUPPORTED_TOOLS == {"work-macos": ("http:twg",)}

    calls: list[tuple[str, ...]] = []

    @contextmanager
    def unlocked_tool_config(root: Path) -> Iterator[None]:
        assert root == ROOT
        yield

    def run_mise(root: Path, *arguments: str) -> None:
        assert root == ROOT
        calls.append(arguments)

    def lock_profiles(root: Path) -> None:
        assert root == ROOT
        calls.append(("lock-profiles",))

    mise_lock.unlocked_tool_config = unlocked_tool_config
    mise_lock.run_mise = run_mise
    mise_lock.lock_profiles = lock_profiles
    mise_lock.update_unsupported_tools(ROOT)

    assert calls == [
        ("--env", "work-macos", "upgrade", "--bump", "http:twg"),
        ("lock-profiles",),
    ]

    workflow = (ROOT / ".github/workflows/repository-updates.yml").read_text()
    assert "run: python3 mise.lock.py update-unsupported" in workflow
    assert "run: python3 mise.lock.py update\n" not in workflow


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
assert_renovate_owns_supported_mise_tools()
assert_repository_updates_only_unsupported_tools()

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

pre_tools = base["bootstrap"]["hooks"]["pre-tools"].splitlines()
assert pre_tools == [
    "mise install python",
    'CLOUDSDK_PYTHON="$(mise which python3)" mise install gcloud',
]

gcloud = base["tools"]["gcloud"]
assert gcloud["depends"] == ["python"]
assert base["tools"]["npm:@googleworkspace/cli"] == "0.22.5"

google_env = {
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_WORKSPACE_CLI_CLIENT_ID",
    "GOOGLE_WORKSPACE_CLI_CLIENT_SECRET",
    "GOOGLE_WORKSPACE_PROJECT_ID",
}
assert google_env <= base["env"].keys()
assert google_env.isdisjoint(work["env"].keys())

print(f"bootstrap prerequisites: ok (python {python_version})")
