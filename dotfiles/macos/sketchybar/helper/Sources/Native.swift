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

func sanitizeBundleCacheName(_ bundleID: String) -> String {
  String(
    bundleID.unicodeScalars.map { scalar in
      let v = scalar.value
      let allowed =
        (v >= 0x30 && v <= 0x39)  // 0-9
        || (v >= 0x41 && v <= 0x5A)  // A-Z
        || (v >= 0x61 && v <= 0x7A)  // a-z
        || v == 0x2E || v == 0x5F || v == 0x2D  // . _ -
      return allowed ? Character(scalar) : "_"
    })
}

func nativeAppIcon(bundleID: String, cacheDirectory: URL, pixelSize: Int = 32) -> String? {
  guard !bundleID.isEmpty,
    let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
  else { return nil }
  let cacheURL = cacheDirectory.appendingPathComponent("\(sanitizeBundleCacheName(bundleID)).png")
  let fm = FileManager.default
  if let cachedMTime = (try? cacheURL.resourceValues(forKeys: [.contentModificationDateKey]))?
    .contentModificationDate
  {
    let bundleMTime =
      (try? appURL.appendingPathComponent("Contents/Info.plist").resourceValues(
        forKeys: [.contentModificationDateKey]))?.contentModificationDate
      ?? (try? appURL.resourceValues(forKeys: [.contentModificationDateKey]))?
        .contentModificationDate
    if let bundleMTime, cachedMTime >= bundleMTime {
      return cacheURL.path
    }
  }
  let icon = NSWorkspace.shared.icon(forFile: appURL.path)
  guard
    let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: pixelSize,
      pixelsHigh: pixelSize,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    )
  else { return nil }
  rep.size = NSSize(width: pixelSize, height: pixelSize)
  NSGraphicsContext.saveGraphicsState()
  guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
    NSGraphicsContext.restoreGraphicsState()
    return nil
  }
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  icon.draw(
    in: NSRect(x: 0, y: 0, width: pixelSize, height: pixelSize),
    from: .zero,
    operation: .copy,
    fraction: 1.0
  )
  NSGraphicsContext.restoreGraphicsState()
  guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
  do {
    try fm.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    try png.write(to: cacheURL, options: .atomic)
    return cacheURL.path
  } catch {
    return nil
  }
}
