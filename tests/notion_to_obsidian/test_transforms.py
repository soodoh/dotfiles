import pytest
from scripts.notion_to_obsidian.transforms import (
    convert_properties_to_frontmatter,
    normalize_key,
    convert_value,
    fix_links,
    fix_image_refs,
    clean_notion_artifacts,
)


class TestNormalizeKey:
    def test_spaces_to_underscores(self):
        assert normalize_key("Woke Up Early") == "woke_up_early"

    def test_slash_to_underscore(self):
        assert normalize_key("Read/Leetcode/Study") == "read_leetcode_study"

    def test_parens_stripped(self):
        assert normalize_key("Weight (oz)") == "weight_oz"

    def test_already_lowercase(self):
        assert normalize_key("date") == "date"

    def test_ampersand_stripped(self):
        assert normalize_key("Cooking & Food") == "cooking_food"


class TestConvertValue:
    def test_yes_to_true(self):
        assert convert_value("Yes") is True

    def test_no_to_false(self):
        assert convert_value("No") is False

    def test_integer(self):
        assert convert_value("42") == 42

    def test_float(self):
        assert convert_value("3.5") == 3.5

    def test_date_mm_dd_yyyy(self):
        assert convert_value("04/22/2023") == "2023-04-22"

    def test_date_month_day_year(self):
        assert convert_value("October 8, 2020") == "2020-10-08"

    def test_date_month_day_year_double_digit(self):
        assert convert_value("January 13, 2022") == "2022-01-13"

    def test_comma_separated_multi_value(self):
        assert convert_value("Backpacking, Car Camping") == ["Backpacking", "Car Camping"]

    def test_plain_string(self):
        assert convert_value("Essentials") == "Essentials"

    def test_string_that_looks_like_number_with_comma(self):
        result = convert_value("Backpacking, Car Camping")
        assert isinstance(result, list)

    def test_empty_string(self):
        assert convert_value("") is None

    def test_tempo_string(self):
        assert convert_value("Tempo") == "Tempo"


class TestConvertPropertiesToFrontmatter:
    def test_full_daily_journal_properties(self):
        props = {
            "Date": "04/22/2023",
            "Woke Up Early": "Yes",
            "Sleep Early": "Yes",
            "Meditated": "No",
            "Pomodoro": "1",
        }
        result = convert_properties_to_frontmatter(props)
        assert result["date"] == "2023-04-22"
        assert result["woke_up_early"] is True
        assert result["sleep_early"] is True
        assert result["meditated"] is False
        assert result["pomodoro"] == 1

    def test_empty_values_omitted(self):
        props = {"Category": "Tech", "Bag": ""}
        result = convert_properties_to_frontmatter(props)
        assert "bag" not in result
        assert result["category"] == "Tech"

    def test_multi_value_type(self):
        props = {"Type": "Backpacking, Car Camping, Day Hiking"}
        result = convert_properties_to_frontmatter(props)
        assert result["type"] == ["Backpacking", "Car Camping", "Day Hiking"]


class TestFixLinks:
    def test_simple_internal_link(self):
        content = "[Movies](Movies%20b6f1d8e8a44e4d41b1bd53ebefe41946.md)"
        assert fix_links(content) == "[[Movies]]"

    def test_link_with_different_text(self):
        content = "[my movies list](Movies%20b6f1d8e8a44e4d41b1bd53ebefe41946.md)"
        assert fix_links(content) == "[[Movies|my movies list]]"

    def test_external_link_preserved(self):
        content = "[Google](https://google.com)"
        assert fix_links(content) == "[Google](https://google.com)"

    def test_link_with_path(self):
        content = "[Data Structures](../Learning/Algorithm%20Design%20Manual/Data%20Structures%20abc12345678901234567890123456789.md)"
        assert fix_links(content) == "[[Data Structures]]"

    def test_csv_link_removed(self):
        content = "[Packing List](Notes/Packing%20List%201fea6c16cdd345c192d26b4fb087bf3d.csv)"
        assert fix_links(content) == ""


class TestFixImageRefs:
    def test_simple_image(self):
        content = "![alt](Middle_Split_Technique.png)"
        assert fix_image_refs(content) == "![[Middle_Split_Technique.png]]"

    def test_image_with_path(self):
        content = "![](Kombucha/Untitled.png)"
        assert fix_image_refs(content) == "![[Untitled.png]]"

    def test_external_image_preserved(self):
        content = "![alt](https://example.com/image.png)"
        assert fix_image_refs(content) == "![alt](https://example.com/image.png)"

    def test_url_encoded_image(self):
        content = "![](Screen%20Shot%202021-01-24.png)"
        assert fix_image_refs(content) == "![[Screen Shot 2021-01-24.png]]"


class TestCleanNotionArtifacts:
    def test_removes_mention_marker(self):
        content = "See \u2023 for details"
        assert clean_notion_artifacts(content) == "See  for details"

    def test_removes_csv_links(self):
        content = "Check [Packing List](Notes/Packing%20List%201fea6c16.csv) here"
        assert clean_notion_artifacts(content) == "Check  here"
