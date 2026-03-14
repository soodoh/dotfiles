"""Main orchestrator for Notion to Obsidian migration."""
import shutil
import sys
from pathlib import Path

from .parser import parse_notion_markdown, strip_uuid_suffix
from .transforms import (
    clean_notion_artifacts,
    convert_properties_to_frontmatter,
    fix_image_refs,
    fix_links,
)
from .router import route_file
from .index_pages import get_index_pages
from .obsidian_config import configure_vault

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def _yaml_value(v) -> str:
    """Serialize a single value to YAML format (stdlib only, no PyYAML)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        items = ", ".join(f'"{i}"' if isinstance(i, str) else str(i) for i in v)
        return f"[{items}]"
    s = str(v)
    if any(c in s for c in ":#{}[]|>&*?!,'\"@`") or s in ("true", "false", "null", "yes", "no"):
        return f'"{s}"'
    return s


def build_frontmatter_yaml(frontmatter: dict) -> str:
    """Serialize frontmatter dict to YAML string (stdlib only, no PyYAML)."""
    if not frontmatter:
        return ""
    lines = []
    for key, value in frontmatter.items():
        lines.append(f"{key}: {_yaml_value(value)}")
    return "\n".join(lines)


def process_markdown(content: str) -> tuple[dict, str]:
    """Process a single markdown file's content.

    Returns (frontmatter_dict, processed_body).
    """
    parsed = parse_notion_markdown(content)
    frontmatter = convert_properties_to_frontmatter(parsed["properties"])

    body = parsed["body"]
    body = fix_links(body)
    body = fix_image_refs(body)
    body = clean_notion_artifacts(body)

    title_line = f"# {parsed['title']}" if parsed["title"] else ""
    full_body = f"{title_line}\n\n{body}".strip() if title_line else body

    return frontmatter, full_body


def assemble_markdown(frontmatter: dict, body: str) -> str:
    """Assemble frontmatter and body into a complete markdown file."""
    fm_yaml = build_frontmatter_yaml(frontmatter)
    if fm_yaml:
        return f"---\n{fm_yaml}\n---\n{body}\n"
    return f"{body}\n"


def migrate(source_dir: Path, vault_dir: Path, dry_run: bool = False) -> dict:
    """Run the full migration.

    Returns stats dict with counts of processed/skipped/merged files.
    """
    stats = {"processed": 0, "skipped": 0, "images": 0, "merged": 0, "errors": []}
    date_files: dict[str, list[tuple[dict, str]]] = {}

    for source_file in sorted(source_dir.rglob("*")):
        if not source_file.is_file():
            continue

        rel_path = str(source_file.relative_to(source_dir))

        if source_file.suffix == ".md":
            try:
                content = source_file.read_text(encoding="utf-8")
                parsed = parse_notion_markdown(content)
                frontmatter = convert_properties_to_frontmatter(parsed["properties"])

                date = frontmatter.get("date")

                target_path = route_file(rel_path, date=date)
                if target_path is None:
                    if rel_path.startswith(("Daily Journal/", "Dream Journal/")) and not date:
                        stats["errors"].append(f"{rel_path}: skipped (no Date property)")
                    stats["skipped"] += 1
                    continue

                _, body = process_markdown(content)

                if target_path not in date_files:
                    date_files[target_path] = []
                date_files[target_path].append((frontmatter, body))

                stats["processed"] += 1

            except Exception as e:
                stats["errors"].append(f"{rel_path}: {e}")

        elif source_file.suffix.lower() in IMAGE_EXTS:
            target_path = route_file(rel_path)
            if target_path is None:
                stats["skipped"] += 1
                continue

            if not dry_run:
                target = vault_dir / target_path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_file, target)

            stats["images"] += 1

        else:
            stats["skipped"] += 1

    for target_path, entries in date_files.items():
        if not dry_run:
            target = vault_dir / target_path
            target.parent.mkdir(parents=True, exist_ok=True)

            if len(entries) == 1:
                fm, body = entries[0]
                target.write_text(assemble_markdown(fm, body), encoding="utf-8")
            else:
                stats["merged"] += len(entries) - 1
                fm = entries[0][0]
                merged_body = "\n\n---\n\n".join(body for _, body in entries)
                target.write_text(assemble_markdown(fm, merged_body), encoding="utf-8")

    for path, content in get_index_pages().items():
        if not dry_run:
            target = vault_dir / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")

    if not dry_run:
        configure_vault(vault_dir)

    return stats


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Migrate Notion export to Obsidian vault")
    parser.add_argument("source", type=Path, help="Path to Notion export directory")
    parser.add_argument("target", type=Path, help="Path to Obsidian vault directory")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without writing files")

    args = parser.parse_args()

    if not args.source.is_dir():
        print(f"Error: Source directory not found: {args.source}")
        sys.exit(1)

    print(f"Migrating from: {args.source}")
    print(f"           to: {args.target}")
    if args.dry_run:
        print("(DRY RUN — no files will be written)")
    print()

    stats = migrate(args.source, args.target, dry_run=args.dry_run)

    print(f"Processed: {stats['processed']} markdown files")
    print(f"Images:    {stats['images']} copied")
    print(f"Merged:    {stats['merged']} duplicate-date entries")
    print(f"Skipped:   {stats['skipped']} files")
    if stats["errors"]:
        print(f"\nErrors ({len(stats['errors'])}):")
        for err in stats["errors"]:
            print(f"  - {err}")


if __name__ == "__main__":
    main()
