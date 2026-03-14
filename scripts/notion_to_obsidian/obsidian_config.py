"""Configure Obsidian vault settings."""
import json
from pathlib import Path


def configure_vault(vault_path: Path) -> None:
    """Write Obsidian configuration files for the migrated vault."""
    obsidian_dir = vault_path / ".obsidian"
    obsidian_dir.mkdir(exist_ok=True)

    # App settings
    app_json = obsidian_dir / "app.json"
    app_config = {}
    if app_json.exists():
        app_config = json.loads(app_json.read_text())

    app_config.update({
        "newFileLocation": "folder",
        "newFileFolderPath": "Notes",
        "attachmentFolderPath": "",
        "useMarkdownLinks": False,
    })
    app_json.write_text(json.dumps(app_config, indent=2) + "\n")

    # Daily Notes core plugin config (core plugins use .obsidian/<name>.json, not plugins/)
    daily_notes_config = {
        "folder": "Journal/Daily",
        "format": "YYYY-MM-DD",
        "template": "Templates/Daily Note",
    }
    (obsidian_dir / "daily-notes.json").write_text(
        json.dumps(daily_notes_config, indent=2) + "\n"
    )

    # Enable core daily-notes plugin
    core_plugins_path = obsidian_dir / "core-plugins.json"
    core_plugins = []
    if core_plugins_path.exists():
        core_plugins = json.loads(core_plugins_path.read_text())
    if "daily-notes" not in core_plugins:
        core_plugins.append("daily-notes")
    core_plugins_path.write_text(json.dumps(core_plugins, indent=2) + "\n")

    # Create daily note template
    templates_dir = vault_path / "Templates"
    templates_dir.mkdir(exist_ok=True)
    template_file = templates_dir / "Daily Note.md"
    if not template_file.exists():
        template_file.write_text("""\
---
date: {{date}}
---
# {{title}}

## Gratitude

1.
2.

## Noteworthy Events

-
""")
