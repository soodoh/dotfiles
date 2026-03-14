"""Transform Notion content into Obsidian-compatible format."""
import re
from urllib.parse import unquote

from .parser import strip_uuid_suffix

DATE_MM_DD_YYYY = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
DATE_MONTH_DAY_YEAR = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$"
)
MONTH_MAP = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}

MD_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)]+)\)")
MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")

NOTION_MENTION = "\u2023"
CSV_LINK = re.compile(r"\[[^\]]*\]\([^)]*\.csv\)")


def normalize_key(key: str) -> str:
    key = key.lower()
    key = key.replace("/", "_").replace("&", "").replace("(", "").replace(")", "")
    key = re.sub(r"\s+", "_", key)
    key = re.sub(r"_+", "_", key)
    key = key.strip("_")
    return key


def convert_value(value: str):
    if not value:
        return None
    if value == "Yes":
        return True
    if value == "No":
        return False

    m = DATE_MM_DD_YYYY.match(value)
    if m:
        month, day, year = m.groups()
        return f"{year}-{month}-{day}"

    m = DATE_MONTH_DAY_YEAR.match(value)
    if m:
        month_name, day, year = m.groups()
        month_num = MONTH_MAP[month_name]
        return f"{year}-{month_num:02d}-{int(day):02d}"

    try:
        return int(value)
    except ValueError:
        pass

    try:
        return float(value)
    except ValueError:
        pass

    if ", " in value and not DATE_MONTH_DAY_YEAR.match(value):
        parts = [p.strip() for p in value.split(", ")]
        if len(parts) >= 2:
            return parts

    return value


def convert_properties_to_frontmatter(properties: dict) -> dict:
    result = {}
    for key, value in properties.items():
        converted = convert_value(value)
        if converted is not None:
            result[normalize_key(key)] = converted
    return result


def fix_links(content: str) -> str:
    def replace_link(match):
        text = match.group(1)
        target = unquote(match.group(2))

        if target.startswith("http://") or target.startswith("https://"):
            return match.group(0)

        if target.endswith(".csv"):
            return ""

        target_name = target.split("/")[-1]
        if target_name.endswith(".md"):
            target_name = target_name[:-3]
        target_name = strip_uuid_suffix(target_name)
        if target_name.endswith(".md"):
            target_name = target_name[:-3]

        if text == target_name:
            return f"[[{target_name}]]"
        else:
            return f"[[{target_name}|{text}]]"

    return MD_LINK.sub(replace_link, content)


def fix_image_refs(content: str) -> str:
    def replace_image(match):
        alt = match.group(1)
        src = unquote(match.group(2))

        if src.startswith("http://") or src.startswith("https://"):
            return match.group(0)

        filename = src.split("/")[-1]
        return f"![[{filename}]]"

    return MD_IMAGE.sub(replace_image, content)


def clean_notion_artifacts(content: str) -> str:
    content = content.replace(NOTION_MENTION, "")
    content = CSV_LINK.sub("", content)
    return content
