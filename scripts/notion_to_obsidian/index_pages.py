"""Generate Obsidian Bases (.base) files for database collections."""

INDEX_PAGES = {
    "Lists/Packing List.base": """\
filters:
  and:
    - file.inFolder("Lists/Packing")
properties:
  file.name:
    displayName: Name
  category:
    displayName: Category
  packed:
    displayName: Packed
views:
  - type: table
    name: All Items
    order:
      - file.name
      - category
      - packed
""",
    "Lists/Camping Packing List.base": """\
filters:
  and:
    - file.inFolder("Lists/Camping")
properties:
  file.name:
    displayName: Name
  category:
    displayName: Category
  packed:
    displayName: Packed
  weight_oz:
    displayName: Weight (oz)
  type:
    displayName: Type
views:
  - type: table
    name: All Items
    order:
      - file.name
      - category
      - packed
      - weight_oz
      - type
""",
    "Lists/Places to See.base": """\
filters:
  and:
    - file.inFolder("Lists/Places")
properties:
  file.name:
    displayName: Name
  have_seen:
    displayName: Have Seen
  type:
    displayName: Type
views:
  - type: table
    name: All Places
    order:
      - file.name
      - have_seen
      - type
""",
    "Lists/Drinks.base": """\
filters:
  and:
    - file.inFolder("Lists/Drinks")
properties:
  file.name:
    displayName: Name
  tags:
    displayName: Tags
views:
  - type: table
    name: All Drinks
    order:
      - file.name
      - tags
""",
    "Lists/Dream Home Ideas.base": """\
filters:
  and:
    - file.inFolder("Lists/Dream Home Ideas")
properties:
  file.name:
    displayName: Name
  tags:
    displayName: Tags
  property:
    displayName: Property
views:
  - type: table
    name: All Ideas
    order:
      - file.name
      - tags
      - property
""",
}


def get_index_pages() -> dict[str, str]:
    """Return a dict of {target_path: content} for all Bases files."""
    return INDEX_PAGES.copy()
