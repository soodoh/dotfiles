"""Parse Notion-exported markdown files into structured components."""
import re
from pathlib import Path

UUID_PATTERN = re.compile(r" [0-9a-f]{32}")
PROPERTY_LINE = re.compile(r"^([A-Za-z][A-Za-z0-9 /&\-()]+):\s*(.*)$")


def strip_uuid_suffix(filename: str) -> str:
    """Remove Notion's 32-char hex UUID suffix from filenames and directory names."""
    parts = Path(filename).parts
    cleaned = []
    for part in parts:
        stem_ext = part.rsplit(".", 1)
        if len(stem_ext) == 2:
            stem, ext = stem_ext
            stem = UUID_PATTERN.sub("", stem)
            cleaned.append(f"{stem}.{ext}")
        else:
            cleaned.append(UUID_PATTERN.sub("", part))
    return str(Path(*cleaned)) if cleaned else filename


def parse_notion_markdown(content: str) -> dict:
    """Parse a Notion markdown file into title, properties, and body.

    Returns:
        dict with keys:
        - title: str
        - properties: dict
        - body: str
    """
    if not content.strip():
        return {"title": "", "properties": {}, "body": ""}

    lines = content.split("\n")
    title = ""
    properties = {}

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            i += 1
            break
        i += 1

    while i < len(lines) and not lines[i].strip():
        i += 1

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and PROPERTY_LINE.match(lines[j].strip()):
                i = j
                continue
            else:
                i = j
                break

        match = PROPERTY_LINE.match(stripped)
        if match:
            key, value = match.group(1).strip(), match.group(2).strip()
            if key != "Created":
                properties[key] = value
            i += 1
        else:
            break

    body = "\n".join(lines[i:]).strip()
    return {"title": title, "properties": properties, "body": body}
