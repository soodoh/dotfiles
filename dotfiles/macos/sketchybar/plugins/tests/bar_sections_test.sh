#!/bin/bash
set -euo pipefail

# Exercise the declaration seam, not particular padding values: changing order,
# membership, label length, or notch placement must preserve the spacing rules.
plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
export CONFIG_DIR="$plugin_dir/.."
PLUGIN_DIR="$plugin_dir"
source "$plugin_dir/notch_layout.sh"
source "$plugin_dir/colors.sh"

sketchybar() {
  printf '%s\n' "$@" | jq -Rsc 'split("\n")[:-1]' >>"$log"
}
original=("${RIGHT_SECTIONS[@]}")
for variant in original reordered single_popup no_popup; do
  case "$variant" in
    original) RIGHT_SECTIONS=("${original[@]}") ;;
    reordered) RIGHT_SECTIONS=(sensor:metric divider.a:separator clock:text cpu:metric:popup ram:metric:popup extra:metric:popup divider.b:separator volume:metric battery:metric) ;;
    single_popup) RIGHT_SECTIONS=(clock:text divider:separator sensor:metric cpu:metric:popup) ;;
    no_popup) RIGHT_SECTIONS=(sensor:metric divider:separator volume:metric battery:metric) ;;
  esac
  log="$tmp_dir/$variant.jsonl"
  create_right_sections
  create_notch_items
  printf '%s\n' "${RIGHT_SECTIONS[@]}" >"$tmp_dir/$variant.layout"
  notch_right_sections_width >"$tmp_dir/$variant.width"
  if [[ "$variant" == reordered ]]; then
    # Hidden optional items must not leave a spacer tied to a neighbour.
    sketchybar --set sensor drawing=off --set notch.sensor drawing=off
  fi
done

python3 - "$tmp_dir" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
widths = {}
for log in sorted(root.glob('*.jsonl')):
    specs = [line.split(':') for line in log.with_suffix('.layout').read_text().splitlines()]
    placement = {spec[0]: spec[2] if len(spec) == 3 else 'right' for spec in specs}
    order, items = [], {}
    for args in map(json.loads, log.read_text().splitlines()):
        cursor = 0
        while cursor < len(args):
            command = args[cursor]
            cursor += 1
            values = []
            while cursor < len(args) and not args[cursor].startswith('--'):
                values.append(args[cursor])
                cursor += 1
            if command == '--add':
                _, name, position = values
                assert name not in items, name
                order.append(name)
                items[name] = {'position': position, 'drawing': 'on'}
            elif command == '--clone':
                name, source = values
                assert source in items, source
                order.append(name)
                items[name] = dict(items[source])
            elif command == '--set':
                name, *properties = values
                assert name in items, f'Setting an undeclared item: {name}'
                for prop in properties:
                    key, value = prop.split('=', 1)
                    if key == 'position' and value.startswith('popup.'):
                        assert value[6:] in items, f'Popup host must exist first: {value}'
                    # Item padding and background padding are aliases in
                    # SketchyBar, not independent ways to add whitespace.
                    if key in ('background.padding_left', 'background.padding_right'):
                        key = key.removeprefix('background.')
                    items[name][key] = value
            elif command == '--move':
                name, direction, anchor = values
                order.remove(name)
                order.insert(order.index(anchor) + (direction == 'after'), name)

    regular = [name for name in order if not name.startswith('notch.')]
    assert regular == [spec[0] for spec in specs], (regular, specs)
    assert all('notch.' + name in items for name in regular)
    popups = [name for name in regular if placement[name] == 'popup']
    if popups:
        assert 'notch.stats' in items
        popup_order = [name[6:] for name in order if items[name]['position'] == 'popup.notch.stats']
        assert popup_order == list(reversed(popups)), popup_order
    else:
        assert 'notch.stats' not in items

    def render_row(names, percent_length):
        # Independent SketchyBar geometry contract: item padding is outside the
        # window; text padding is inside; fixed width overrides content width.
        # Supply varying measured glyph widths rather than duplicating fonts.
        x, gaps, internal_gaps, previous_end, previous_kind = 0, {}, [], None, None
        for index, name in enumerate(names):
            props = items[name]
            if props['drawing'] == 'off' or props['position'] != 'right':
                continue
            left = int(props['padding_left'])
            right = int(props['padding_right'])
            x += left
            boxes, content_width = [], 0
            for field in ('icon', 'label'):
                if props[field + '.drawing'] == 'off':
                    continue
                measured = (index % 4 + 1) * 3 if field == 'icon' else percent_length * 7
                if props.get(field) == '':
                    measured = 0
                else:
                    assert props[field + '.width'] == 'dynamic', (name, field)
                pad_left = int(props[field + '.padding_left'])
                pad_right = int(props[field + '.padding_right'])
                if measured:
                    boxes.append((x + content_width + pad_left, x + content_width + pad_left + measured))
                field_width = props[field + '.width']
                content_width += pad_left + measured + pad_right if field_width == 'dynamic' else int(field_width)
            width = content_width if props['width'] == 'dynamic' else int(props['width'])
            kind = 'separator' if props['background.drawing'] == 'on' else 'group'
            if kind == 'separator':
                # A background separator occupies its exact content width,
                # not a font cell with a bearing around a narrow glyph. Keep
                # the item dynamic: fixed item widths bypass RTL outer gutters.
                assert width > 0 and not boxes and props['width'] == 'dynamic', name
                boxes = [(x, x + width)]
            if len(boxes) == 2:
                internal_gaps.append(boxes[1][0] - boxes[0][1])
            if previous_end is not None:
                boundary = tuple(sorted((previous_kind, kind)))
                gaps.setdefault(boundary, []).append(boxes[0][0] - previous_end)
            previous_end = boxes[-1][1]
            previous_kind = kind
            x += width + right
        # Section dividers may have wider gutters than adjacent metric groups,
        # but both sides of every divider must agree, regardless of neighbours.
        assert gaps and all(len(set(values)) == 1 and values[0] > 0 for values in gaps.values()), (log.stem, names, gaps)
        assert internal_gaps and len(set(internal_gaps)) == 1 and internal_gaps[0] > 0, internal_gaps
        return {kind: values[0] for kind, values in gaps.items()}, internal_gaps[0]

    # Right-position items paint in reverse declaration order. Each layout has
    # both separator-to-item and metric-to-metric neighbours in these fixtures.
    regular_row = list(reversed(regular))
    notch_row = [name for name in reversed(order) if name.startswith('notch.')]
    baseline = render_row(regular_row, 2)  # 1%
    for length in (3, 4):  # 99%, 100%
        assert render_row(regular_row, length) == baseline
    assert render_row(notch_row, 4) == baseline
    widths[log.stem] = int(log.with_suffix('.width').read_text())

# The notch budget follows declared membership, and all popup rows share one
# button. Adding/removing visible metrics must actually change reserved space.
assert widths['reordered'] > widths['single_popup'] > widths['no_popup'], widths
PY
