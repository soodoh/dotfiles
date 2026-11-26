import AppKit
import CoreGraphics
import CoreText

struct NotchedDisplay {
  var id: UInt32
  var notchWidth: Double
}

func nativeNotches() -> [NotchedDisplay] {
  NSScreen.screens.compactMap { screen in
    guard
      let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
      CGDisplayIsBuiltin(number.uint32Value) != 0,
      screen.safeAreaInsets.top > 0,
      let left = screen.auxiliaryTopLeftArea,
      let right = screen.auxiliaryTopRightArea
    else { return nil }
    return NotchedDisplay(id: number.uint32Value, notchWidth: right.minX - left.maxX)
  }
}

func glyphBounds(_ text: String, size: Int, family: String = "FiraCode Nerd Font") -> CGRect {
  let font =
    NSFontManager.shared.font(
      withFamily: family, traits: .boldFontMask, weight: 9, size: CGFloat(size))
    ?? NSFont.monospacedSystemFont(ofSize: CGFloat(size), weight: .bold)
  let line = CTLineCreateWithAttributedString(
    NSAttributedString(string: text, attributes: [.font: font]))
  return CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
}
func textWidth(_ text: String, size: Int) -> Int {
  text.isEmpty ? 0 : Int(glyphBounds(text, size: size).width + 1.5)
}
