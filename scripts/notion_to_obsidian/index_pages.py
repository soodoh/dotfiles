"""Generate Dataview index pages for database collections."""

INDEX_PAGES = {
    "Lists/Packing List.md": '''\
---
---
# Packing List

## By Category
```dataview
TABLE category, packed
FROM "Lists/Packing"
SORT category ASC, file.name ASC
```

## Unpacked Items
```dataview
TABLE category
FROM "Lists/Packing"
WHERE packed = false
SORT category ASC
```
''',
    "Lists/Camping Packing List.md": '''\
---
---
# Camping Packing List

## All Items
```dataview
TABLE category, packed, weight_oz
FROM "Lists/Camping"
SORT category ASC, file.name ASC
```

## By Category
```dataview
TABLE packed, weight_oz
FROM "Lists/Camping"
GROUP BY category
```

## Total Weight (Packed)
```dataview
TABLE sum(rows.weight_oz) AS "Total Weight (oz)"
FROM "Lists/Camping"
WHERE packed = true
GROUP BY "Packed Items"
```
''',
    "Lists/Places to See.md": '''\
---
---
# Places to See

## All Places
```dataview
TABLE have_seen, type
FROM "Lists/Places"
SORT type ASC, file.name ASC
```

## Not Yet Visited
```dataview
TABLE type
FROM "Lists/Places"
WHERE have_seen = false
SORT type ASC
```
''',
    "Lists/Drinks.md": '''\
---
---
# Drinks

```dataview
TABLE tags
FROM "Lists/Drinks"
SORT file.name ASC
```
''',
    "Lists/Dream Home Ideas.md": '''\
---
---
# Dream Home Ideas

```dataview
TABLE tags, property
FROM "Lists/Dream Home Ideas"
SORT file.name ASC
```
''',
}


def get_index_pages() -> dict[str, str]:
    """Return a dict of {target_path: content} for all Dataview index pages."""
    return INDEX_PAGES.copy()
