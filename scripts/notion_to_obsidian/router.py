"""Map Notion export source paths to Obsidian vault target paths."""
import re
from pathlib import PurePosixPath

from .parser import strip_uuid_suffix

DATABASE_ROUTES = {
    "Notes/Packing List": "Lists/Packing",
    "Notes/Camping Packing List": "Lists/Camping",
    "Notes/Places to See": "Lists/Places",
    "Notes/Drinks": "Lists/Drinks",
    "Notes/Dream Home Ideas": "Lists/Dream Home Ideas",
}

HUB_PAGES = {"Home", "Notes", "Jobs Education"}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}

GENERIC_IMAGE_NAMES = {"Untitled.png", "Untitled.jpg", "Untitled.jpeg"}

UUID_PATTERN = re.compile(r" [0-9a-f]{32}")


def _clean_name(name: str) -> str:
    return UUID_PATTERN.sub("", name)


def route_file(source_path: str, date: str | None = None) -> str | None:
    path = PurePosixPath(source_path)
    parts = list(path.parts)
    ext = path.suffix.lower()

    if ext in (".csv", ".html"):
        return None
    if parts[0] == "People":
        return None

    if len(parts) == 1 and ext == ".md":
        clean = _clean_name(path.stem)
        if clean in HUB_PAGES:
            return None

    # Daily Journal
    if parts[0] == "Daily Journal" and ext == ".md":
        if not date:
            return None
        return f"Journal/Daily/{date}.md"

    # Dream Journal
    if parts[0] == "Dream Journal" and ext == ".md":
        if not date:
            return None
        return f"Journal/Dreams/{date}.md"

    # Database items
    if len(parts) >= 2:
        for db_source, db_target in DATABASE_ROUTES.items():
            db_parts = db_source.split("/")
            if parts[:len(db_parts)] == db_parts:
                remaining = parts[len(db_parts):]
                if not remaining:
                    continue

                cleaned = [_clean_name(p) for p in remaining]

                if ext in IMAGE_EXTS and cleaned[-1] in GENERIC_IMAGE_NAMES:
                    parent = cleaned[-2] if len(cleaned) >= 2 else _clean_name(parts[-2])
                    cleaned[-1] = f"{parent}_{cleaned[-1]}"

                result = str(PurePosixPath(db_target, *cleaned))
                return result

    # Jobs Education
    if parts[0] == "Jobs Education":
        if len(parts) == 1:
            return None

        remaining = parts[1:]
        cleaned = [_clean_name(p) for p in remaining]

        if cleaned[0] == "Learning":
            return str(PurePosixPath("Learning", *cleaned[1:])) if len(cleaned) > 1 else "Learning/Learning.md"
        elif cleaned[0] == "STAR Interview Stories":
            return str(PurePosixPath("Career", *cleaned))
        else:
            return str(PurePosixPath("Career", *cleaned))

    # Freeform notes in Notes/
    if len(parts) == 2 and parts[0] == "Notes" and ext == ".md":
        clean_name = _clean_name(path.stem)
        return f"Notes/{clean_name}.md"

    # Images in Notes subfolders
    if parts[0] == "Notes" and ext in IMAGE_EXTS:
        cleaned = [_clean_name(p) for p in parts[1:]]
        return str(PurePosixPath("Notes", *cleaned))

    # Root-level files
    if len(parts) == 1 and ext == ".md":
        clean_name = _clean_name(path.stem)
        return f"Notes/{clean_name}.md"

    # Career images
    if parts[0] == "Jobs Education" and ext in IMAGE_EXTS:
        remaining = parts[1:]
        cleaned = [_clean_name(p) for p in remaining]
        if cleaned[0] == "Learning":
            return str(PurePosixPath("Learning", *cleaned[1:]))
        elif cleaned[0] == "STAR Interview Stories":
            return str(PurePosixPath("Career", *cleaned))
        return str(PurePosixPath("Career", *cleaned))

    return None
