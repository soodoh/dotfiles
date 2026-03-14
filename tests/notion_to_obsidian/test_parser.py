import pytest
from pathlib import Path
from scripts.notion_to_obsidian.parser import parse_notion_markdown, strip_uuid_suffix

FIXTURES = Path(__file__).parent / "fixtures"


class TestParseNotionMarkdown:
    def test_extracts_title(self):
        content = (FIXTURES / "sample_daily.md").read_text()
        result = parse_notion_markdown(content)
        assert result["title"] == "10k, meal prep, relax"

    def test_extracts_properties(self):
        content = (FIXTURES / "sample_daily.md").read_text()
        result = parse_notion_markdown(content)
        assert result["properties"]["Date"] == "04/22/2023"
        assert result["properties"]["Woke Up Early"] == "Yes"
        assert result["properties"]["Pomodoro"] == "1"

    def test_drops_created_property(self):
        content = (FIXTURES / "sample_daily.md").read_text()
        result = parse_notion_markdown(content)
        assert "Created" not in result["properties"]

    def test_extracts_body(self):
        content = (FIXTURES / "sample_daily.md").read_text()
        result = parse_notion_markdown(content)
        assert "# Gratitude" in result["body"]
        assert "Grateful that Jacob" in result["body"]

    def test_body_excludes_properties(self):
        content = (FIXTURES / "sample_daily.md").read_text()
        result = parse_notion_markdown(content)
        assert "Woke Up Early:" not in result["body"]
        assert "Date: 04/22/2023" not in result["body"]

    def test_dream_journal_properties(self):
        content = (FIXTURES / "sample_dream.md").read_text()
        result = parse_notion_markdown(content)
        assert result["title"] == "Dream Entry"
        assert result["properties"]["Date"] == "October 8, 2020"

    def test_packing_item_with_body_content(self):
        content = (FIXTURES / "sample_packing.md").read_text()
        result = parse_notion_markdown(content)
        assert result["title"] == "Clothes"
        assert result["properties"]["Category"] == "Essentials"
        assert "# Always" in result["body"]

    def test_no_properties(self):
        content = "# Just a title\n\nSome body text.\n"
        result = parse_notion_markdown(content)
        assert result["title"] == "Just a title"
        assert result["properties"] == {}
        assert "Some body text." in result["body"]

    def test_empty_file(self):
        result = parse_notion_markdown("")
        assert result["title"] == ""
        assert result["properties"] == {}
        assert result["body"] == ""


class TestStripUuidSuffix:
    def test_strips_uuid_from_md(self):
        assert strip_uuid_suffix("Airpods 84dc7c5f6619435fa5a5e9cdfcc60b4d.md") == "Airpods.md"

    def test_strips_uuid_from_csv(self):
        assert strip_uuid_suffix("Daily Journal e229b92d9f2d4628a3ea09566e215424.csv") == "Daily Journal.csv"

    def test_no_uuid(self):
        assert strip_uuid_suffix("normal_file.md") == "normal_file.md"

    def test_preserves_path(self):
        assert strip_uuid_suffix("Notes/Bucket List 67e5ea01e1764603b2b6188ca652d060.md") == "Notes/Bucket List.md"

    def test_uuid_in_directory_name(self):
        assert strip_uuid_suffix("Kombucha abc12345678901234567890123456789/Untitled.png") == "Kombucha/Untitled.png"
