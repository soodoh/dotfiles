from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parent


def load_toml(name: str) -> dict:
    with (ROOT / name).open("rb") as config_file:
        return tomllib.load(config_file)


def assert_tools_locked(config_name: str, lock_name: str) -> dict:
    config_tools = load_toml(config_name).get("tools", {})
    lock_tools = load_toml(lock_name).get("tools", {})
    for tool, specification in config_tools.items():
        version = specification if isinstance(specification, str) else specification["version"]
        entries = lock_tools.get(tool, [])
        assert any(entry["version"] == version for entry in entries), (
            f"{config_name}: {tool}@{version} is missing from {lock_name}"
        )
    return lock_tools


base = load_toml("mise.toml")
work = load_toml("mise.work-macos.toml")

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
assert lock_task["run"] == [
    "mise --env personal-macos lock --global --platform linux-x64,linux-arm64,macos-x64,macos-arm64",
    "mise --env work-macos lock --global --platform linux-x64,linux-arm64,macos-x64,macos-arm64",
]
assert base["tasks"]["update:tools"]["run"] == [
    "mise upgrade --bump",
    {"task": "lock"},
]

pre_tools = work["bootstrap"]["hooks"]["pre-tools"].splitlines()
assert pre_tools == [
    "mise install python",
    'CLOUDSDK_PYTHON="$(mise which python3)" mise install gcloud',
]

gcloud = work["tools"]["gcloud"]
assert gcloud["depends"] == ["python"]

print(f"bootstrap prerequisites: ok (python {python_version})")
