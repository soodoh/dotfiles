import pytest
from scripts.notion_to_obsidian.router import route_file


class TestRouteFile:
    def test_daily_journal_entry(self):
        result = route_file("Daily Journal/some entry abc12345678901234567890123456789.md", date="2023-04-22")
        assert result == "Journal/Daily/2023-04-22.md"

    def test_dream_journal_entry(self):
        result = route_file("Dream Journal/Dream Entry 1 abc12345678901234567890123456789.md", date="2020-10-08")
        assert result == "Journal/Dreams/2020-10-08.md"

    def test_packing_list_item(self):
        result = route_file("Notes/Packing List/Airpods abc12345678901234567890123456789.md")
        assert result == "Lists/Packing/Airpods.md"

    def test_camping_packing_item(self):
        result = route_file("Notes/Camping Packing List/Bear Canister abc12345678901234567890123456789.md")
        assert result == "Lists/Camping/Bear Canister.md"

    def test_places_item(self):
        result = route_file("Notes/Places to See/Alaska abc12345678901234567890123456789.md")
        assert result == "Lists/Places/Alaska.md"

    def test_drinks_item(self):
        result = route_file("Notes/Drinks/Kava abc12345678901234567890123456789.md")
        assert result == "Lists/Drinks/Kava.md"

    def test_drinks_with_image_sibling(self):
        result = route_file("Notes/Drinks/Kombucha abc12345678901234567890123456789.md")
        assert result == "Lists/Drinks/Kombucha.md"

    def test_dream_home_item(self):
        result = route_file("Notes/Dream Home Ideas/Kitchen abc12345678901234567890123456789.md")
        assert result == "Lists/Dream Home Ideas/Kitchen.md"

    def test_freeform_note_in_notes(self):
        result = route_file("Notes/Movies b6f1d8e8a44e4d41b1bd53ebefe41946.md")
        assert result == "Notes/Movies.md"

    def test_freeform_note_with_image_sibling(self):
        result = route_file("Notes/Stretching abc12345678901234567890123456789.md")
        assert result == "Notes/Stretching.md"

    def test_therapy_root_level(self):
        result = route_file("Therapy b2e1b43fb2be4fedbb1d6c40ddab3740.md")
        assert result == "Notes/Therapy.md"

    def test_learning_note(self):
        result = route_file("Jobs Education/Learning/Algorithm Design Manual/Data Structures abc12345678901234567890123456789.md")
        assert result == "Learning/Algorithm Design Manual/Data Structures.md"

    def test_learning_index(self):
        result = route_file("Jobs Education/Learning/Learning abc12345678901234567890123456789.md")
        assert result == "Learning/Learning.md"

    def test_star_stories(self):
        result = route_file("Jobs Education/STAR Interview Stories/Distributed Architecture @ Healthline/Distributed Architecture @ Healthline abc12345678901234567890123456789.md")
        assert result == "Career/STAR Interview Stories/Distributed Architecture @ Healthline/Distributed Architecture @ Healthline.md"

    def test_star_index(self):
        result = route_file("Jobs Education/STAR Interview Stories abc12345678901234567890123456789.md")
        assert result == "Career/STAR Interview Stories.md"

    def test_questions_for_interviewer(self):
        result = route_file("Jobs Education/Questions for Interviewer abc12345678901234567890123456789.md")
        assert result == "Career/Questions for Interviewer.md"

    def test_image_next_to_note(self):
        result = route_file("Notes/Stretching/Middle_Split_Technique.png")
        assert result == "Notes/Stretching/Middle_Split_Technique.png"

    def test_image_in_drinks_subfolder(self):
        result = route_file("Notes/Drinks/Kombucha abc12345678901234567890123456789/Untitled.png")
        assert result == "Lists/Drinks/Kombucha/Kombucha_Untitled.png"

    def test_skip_index_html(self):
        result = route_file("index.html")
        assert result is None

    def test_skip_people(self):
        result = route_file("People/Paul DiLoreto abc12345678901234567890123456789.md")
        assert result is None

    def test_skip_csv(self):
        result = route_file("Daily Journal e229b92d9f2d4628a3ea09566e215424_all.csv")
        assert result is None

    def test_skip_home_hub(self):
        result = route_file("Home 2d8d684b29fb43e3baecb9775986be0e.md")
        assert result is None

    def test_skip_notes_hub(self):
        result = route_file("Notes 9d5592104a544e8fbede9099b641af2d.md")
        assert result is None

    def test_skip_jobs_hub(self):
        result = route_file("Jobs Education 6b06bcf249744d61b9c5b7695ff4c4be.md")
        assert result is None

    def test_journal_without_date_returns_none(self):
        result = route_file("Daily Journal/entry abc12345678901234567890123456789.md")
        assert result is None

    def test_dream_without_date_returns_none(self):
        result = route_file("Dream Journal/Dream Entry abc12345678901234567890123456789.md")
        assert result is None
