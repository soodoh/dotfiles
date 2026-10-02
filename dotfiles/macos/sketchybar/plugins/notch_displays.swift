import AppKit
import CoreGraphics
import CoreText

// Match SketchyBar's glyph-path width (including its rounding), not typographic
// advances. max_chars counts Unicode scalars, including supplementary Nerd icons.
if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--measure" {
    let text = CommandLine.arguments[2]
    let available = Int(CommandLine.arguments[3]) ?? 0
    let measurements: [[String: Any]] = (9...12).reversed().map { size in
        let font = NSFontManager.shared.font(
            withFamily: "FiraCode Nerd Font", traits: .boldFontMask,
            weight: 9, size: CGFloat(size)
        ) ?? NSFont.monospacedSystemFont(ofSize: CGFloat(size), weight: .bold)
        func width(_ string: String) -> Int {
            let attributed = NSAttributedString(string: string, attributes: [.font: font])
            let line = CTLineCreateWithAttributedString(attributed)
            return Int(CTLineGetBoundsWithOptions(line, .useGlyphPathBounds).width + 1.5)
        }
        let fullWidth = width(text)
        var maxChars = 0
        if size == 9 && fullWidth > available {
            var prefix = ""
            for (index, scalar) in text.unicodeScalars.enumerated() {
                prefix.unicodeScalars.append(scalar)
                if width(prefix) <= available { maxChars = index + 1 }
            }
            // SketchyBar treats zero as unlimited, not an empty viewport.
            maxChars = max(1, maxChars)
        }
        return ["size": size, "width": fullWidth, "max_chars": maxChars]
    }
    let data = try JSONSerialization.data(withJSONObject: measurements, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} else {
    // Use AppKit's safe areas, not the model name or a hard-coded display ID.
    // Coordinates are logical points, matching SketchyBar's display frames.
    var displays: [[String: Any]] = []
    if #available(macOS 12.0, *) {
        for screen in NSScreen.screens {
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
                  CGDisplayIsBuiltin(number.uint32Value) != 0,
                  screen.safeAreaInsets.top > 0,
                  let left = screen.auxiliaryTopLeftArea,
                  let right = screen.auxiliaryTopRightArea else { continue }
            displays.append([
                "id": number.uint32Value,
                "width": screen.frame.width,
                "notch_width": right.minX - left.maxX
            ])
        }
    }
    let data = try JSONSerialization.data(withJSONObject: displays, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
