from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parent


def load_toml(name: str) -> dict:
    with (ROOT / name).open("rb") as config_file:
        return tomllib.load(config_file)


base = load_toml("mise.toml")
work = load_toml("mise.work-macos.toml")

python_version = base["tools"]["python"]
assert "{{" not in python_version

pre_packages = base["bootstrap"]["hooks"]["pre-packages"]
assert "mise bootstrap packages apply brew:mas --yes" in pre_packages
assert "brew:mas" in base["bootstrap"]["packages"]

homebrew_task = base["tasks"]["bootstrap:homebrew-packages"]
assert homebrew_task["interactive"] is True

pre_tools = work["bootstrap"]["hooks"]["pre-tools"].splitlines()
assert pre_tools == [
    "mise install python",
    'CLOUDSDK_PYTHON="$(mise which python3)" mise install gcloud',
]

gcloud = work["tools"]["gcloud"]
assert gcloud["depends"] == ["python"]

print(f"bootstrap prerequisites: ok (python {python_version})")
