import AppKit
import CoreGraphics
import Foundation

final class NativeTests {
  let environment = ProcessInfo.processInfo.environment
  func controller() throws -> BarController {
    guard environment["SKETCHYBAR_LIVE_TESTS"] == "1" else {
      throw SkipCheck(reason: "set SKETCHYBAR_LIVE_TESTS=1 for native checks")
    }
    let home = environment["HOME"] ?? NSHomeDirectory()
    return BarController(
      bar: try BarClient.live(environment: environment),
      configDirectory: environment["CONFIG_DIR"] ?? home + "/.config/sketchybar",
      binary: environment["SKETCHYBAR_HELPER_BIN"]
        ?? "\(environment["XDG_CACHE_HOME"] ?? home + "/.cache")/sketchybar/sketchybar-helper",
      palette: Palette(environment: environment))
  }
  func set(_ bar: BarClient, _ name: String, _ properties: [String]) throws {
    var c = Commands()
    c.set(name, properties)
    try bar.apply(c)
  }
  func waitPopup(_ bar: BarClient, _ name: String, _ expected: String) throws {
    for _ in 0..<40 {
      if try bar.query(name, as: ItemState.self).popup?.drawing == expected { return }
      Thread.sleep(forTimeInterval: 0.05)
    }
    throw CheckFailure(description: "Popup did not become \(expected)")
  }
  func move(_ p: CGPoint) {
    CGEvent(
      mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?
      .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.2)
  }
  func hover(_ point: CGPoint, display: Display) {
    // Reveal then leave the native menu so it can auto-hide before hover.
    move(CGPoint(x: point.x, y: display.frame.y))
    Thread.sleep(forTimeInterval: 1.2)
    move(CGPoint(x: point.x, y: point.y + 350))
    Thread.sleep(forTimeInterval: 1.2)
    move(point)
  }
  func center(_ rect: ItemState.Rect) -> CGPoint {
    CGPoint(x: rect.origin[0] + rect.size[0] / 2, y: rect.origin[1] + rect.size[1] / 2)
  }
  func withInput(_ bar: BarClient, _ body: () throws -> Void) throws {
    guard CGPreflightPostEventAccess() else {
      throw SkipCheck(
        reason: "existing input permission is required; no permission prompt requested")
    }
    let pointer = try unwrap(CGEvent(source: nil)?.location)
    let updates = try bar.query("ai_usage.refresh", as: ItemState.self).scripting?.updates ?? "on"
    let layoutUpdates = try bar.query("notch.layout", as: ItemState.self).scripting?.updates ?? "on"
    // Each restoration is independent: a failed query/reflow must not leave
    // timers paused or prevent restoring the pointer.
    try preservingState(
      {
        try set(bar, "ai_usage.refresh", ["updates=off"])
        try set(bar, "notch.layout", ["updates=off"])
        try body()
      },
      cleanup: [
        { try self.set(bar, "ai_usage.refresh", ["updates=\(updates)"]) },
        { try self.set(bar, "notch.layout", ["updates=\(layoutUpdates)"]) },
        { self.move(pointer) },
      ])
  }
  func testAccountPopups() throws {
    let controller = try controller()
    let bar = controller.bar
    let state: BarState = try bar.query("bar")
    let names = state.items.filter(accountItem)
    let displays: [Display] = try bar.query("displays")
    try require(!names.isEmpty, "Refresh provider usage before running live checks")
    try withInput(bar) {
      let popupStates = try names.map {
        ($0, try bar.query($0, as: ItemState.self).popup?.drawing ?? "off")
      }
      defer { for (name, state) in popupStates { try? set(bar, name, ["popup.drawing=\(state)"]) } }
      for name in names { try set(bar, name, ["popup.drawing=off"]) }
      var checked = 0
      let ordered = try names.map { name in (name, try bar.query(name, as: ItemState.self)) }.sorted
      {
        let left =
          $0.1.boundingRects?.values.filter { $0.origin[0] > -9000 }.map { $0.origin[0] }.min()
          ?? .infinity
        let right =
          $1.1.boundingRects?.values.filter { $0.origin[0] > -9000 }.map { $0.origin[0] }.min()
          ?? .infinity
        return left < right
      }
      for (name, _) in ordered {
        let parent: ItemState = try bar.query(name)
        guard (parent.boundingRects ?? [:]).values.contains(where: { $0.origin[0] > -9000 }) else {
          continue
        }
        // Sketchybar attaches popups to the active display. Discover it
        // before choosing the hover target rather than assuming screen 1.
        try set(bar, name, ["popup.drawing=on"])
        Thread.sleep(forTimeInterval: 0.2)
        let rowName = try unwrap(try bar.query(name, as: ItemState.self).popup?.items?.first)
        let row: ItemState = try bar.query(rowName)
        let key = try unwrap(row.boundingRects?.first(where: { $0.value.origin[0] > -9000 })?.key)
        try set(bar, name, ["popup.drawing=off"])
        let display = try unwrap(displays.first { "display-\($0.arrangementId)" == key })
        let rect = try unwrap(try bar.query(name, as: ItemState.self).boundingRects?[key])
        let point = center(rect)
        print("Checking account \(checked + 1) hover on display \(display.arrangementId)")
        hover(point, display: display)
        try waitPopup(bar, name, "on")
        for other in names where other != name {
          try requireEqual(try bar.query(other, as: ItemState.self).popup?.drawing, "off")
        }
        let first: ItemState = try bar.query(rowName)
        let bounds = try unwrap(first.boundingRects?[key])
        try require(bounds.origin[0] > -9000, "Popup is not rendered on the hover display")
        try requireEqual(first.label?.align, "right")
        try requireEqual(
          (first.icon?.width ?? 0) + (first.label?.width ?? 0), first.geometry?.width)
        try requireEqual(first.icon?.paddingLeft, first.label?.paddingRight)
        try controller.layout()
        try waitPopup(bar, name, "on")
        let usage = try UsageReader(environment: environment).read()
        try controller.render(usage)
        try controller.layout()
        try waitPopup(bar, name, "on")
        move(CGPoint(x: point.x, y: center(bounds).y))
        try waitPopup(bar, name, "off")
        checked += 1
      }
      try require(checked > 0, "No visible account popups checked")
    }
  }
  func testGlyphBounds() throws {
    let bar = try controller().bar
    let state: BarState = try bar.query("bar")
    var checked = 0
    for name in state.items.filter(accountItem) {
      let item: ItemState = try bar.query(name)
      let frames = (item.boundingRects ?? [:]).values.filter { $0.origin[0] > -9000 }
      guard !frames.isEmpty, item.geometry?.scrollTexts != "on" else { continue }
      let label = try unwrap(item.label)
      let icon = try unwrap(item.icon)
      func bounds(_ text: ItemState.Text) -> CGRect {
        let spec = (text.font ?? "FiraCode Nerd Font:Bold:14").split(separator: ":")
        return glyphBounds(
          text.value ?? "", size: Int(Double(spec.last!)!), family: String(spec[0]))
      }
      var iconLength = 0
      var iconRight = 0.0
      if icon.drawing == "on" {
        let glyph = bounds(icon)
        iconLength = Int(glyph.width + 1.5) + (icon.paddingLeft ?? 0) + (icon.paddingRight ?? 0)
        iconRight = Double(icon.paddingLeft ?? 0) + glyph.maxX
      }
      let paintedRight = max(
        iconRight, Double(iconLength + (label.paddingLeft ?? 0)) + bounds(label).maxX)
      for frame in frames {
        try require(
          paintedRight <= frame.size[0] + 0.5, "Account text paints beyond its native window")
      }
      checked += 1
    }
    if checked == 0 { throw SkipCheck(reason: "no visible unbounded account labels") }
  }
  func checkGuardLayering(
    _ controller: BarController, display: Display, key: String, point: CGPoint
  ) throws {
    let bar = controller.bar
    let displays: [Display] = try bar.query("displays")
    for d in displays {
      let guardItem: ItemState = try bar.query("bar.guard.\(d.arrangementId)")
      let frame = try unwrap(guardItem.boundingRects?["display-\(d.arrangementId)"])
      try requireEqual(frame.origin[0], d.frame.x)
      try requireAtMost(frame.size[0], d.frame.w)
    }
    for open in [false, true] {
      for target in ["notch.clock", "notch.volume", "background", "left-edge", "right-edge"] {
        if open {
          hover(point, display: display)
          try waitPopup(bar, "notch.stats", "on")
        }
        let x: Double
        switch target {
        case "background": x = display.frame.x + 500
        case "left-edge": x = display.frame.x + 5
        case "right-edge": x = display.frame.x + display.frame.w - 5
        default:
          x = center(try unwrap(try bar.query(target, as: ItemState.self).boundingRects?[key])).x
        }
        let click = CGPoint(x: x, y: point.y)
        move(click)
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
          CGEvent(
            mouseEventSource: nil, mouseType: type, mouseCursorPosition: click, mouseButton: .left)?
            .post(tap: .cghidEventTap)
        }
        Thread.sleep(forTimeInterval: 0.2)
        try waitPopup(bar, "notch.stats", "off")
        try requireEqual(try bar.query("bar", as: BarState.self).topmost, "off")
        let windows =
          (CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]])
          ?? []
        let clock = try unwrap(try bar.query("notch.clock", as: ItemState.self).boundingRects?[key])
        // Do not discard negative X/Y: left/below-primary screens are
        // valid. Native window-list order is front-to-back.
        func windowIndex(x: Double, y: Double, width: Double) -> Int? {
          windows.firstIndex { w in
            guard w[kCGWindowOwnerName as String] as? String == "sketchybar",
              let bounds = w[kCGWindowBounds as String] as? [String: Double]
            else { return false }
            return abs((bounds["X"] ?? .infinity) - x) < 1
              && abs((bounds["Y"] ?? .infinity) - y) < 1
              && abs((bounds["Width"] ?? .infinity) - width) < 1
          }
        }
        let content = try unwrap(
          windowIndex(x: clock.origin[0], y: clock.origin[1], width: clock.size[0]))
        let background = try unwrap(
          windowIndex(x: display.frame.x, y: clock.origin[1], width: display.frame.w))
        try require(content < background, "Click raised the opaque bar above its content")
      }
    }
  }
  func testNotchStatsAndOverflow() throws {
    let controller = try controller()
    let bar = controller.bar
    guard !nativeNotches().isEmpty else {
      throw SkipCheck(reason: "connect a notched display for native notch checks")
    }
    try withInput(bar) {
      let stats: ItemState = try bar.query("notch.stats")
      let (key, rect) = try unwrap(stats.boundingRects?.first { $0.value.origin[0] > -9000 })
      let displays: [Display] = try bar.query("displays")
      let display = try unwrap(displays.first { "display-\($0.arrangementId)" == key })
      let point = center(rect)
      defer { try? set(bar, "notch.stats", ["popup.drawing=off"]) }
      try checkGuardLayering(controller, display: display, key: key, point: point)
      hover(point, display: display)
      try waitPopup(bar, "notch.stats", "on")
      let row: ItemState = try bar.query("notch.cpu")
      try requireEqual(row.icon?.font, row.label?.font)
      try requireEqual((row.icon?.width ?? 0) + (row.label?.width ?? 0), row.geometry?.width)
      try requireEqual(row.label?.align, "right")
      let rowRect = try unwrap(row.boundingRects?[key])
      try require(
        rowRect.origin[0] > -9000 && abs(center(rowRect).x - point.x) <= 2,
        "Stats popup is not centered/rendered")
      try controller.layout()
      try waitPopup(bar, "notch.stats", "on")
      move(CGPoint(x: point.x, y: center(rowRect).y))
      try waitPopup(bar, "notch.stats", "off")
      let provider: ItemState = try bar.query("notch.ai_usage.providers")
      let state: BarState = try bar.query("bar")
      let names = state.items.filter { $0.hasPrefix("notch.") && accountItem($0) }
      let drawings = try names.map {
        ($0, try bar.query($0, as: ItemState.self).geometry?.drawing ?? "on")
      }
      defer {
        try? set(
          bar, "notch.ai_usage.providers",
          [
            "drawing=\(provider.geometry?.drawing ?? "off")",
            "label=\(provider.label?.value ?? "")",
          ])
        for (name, drawing) in drawings { try? set(bar, name, ["drawing=\(drawing)"]) }
        try? controller.layout()
      }
      for name in names { try set(bar, name, ["drawing=off"]) }
      try set(
        bar, "notch.ai_usage.providers",
        ["drawing=on", "label=\(String(repeating: "󰀄 100% (7d) ·  100% (30d) · ", count: 8))"])
      try controller.layout()
      let scrolling: ItemState = try bar.query("notch.ai_usage.providers")
      try requireEqual(scrolling.geometry?.scrollTexts, "on")
      try require(scrolling.label?.font?.hasSuffix(":9.00") == true)
      let viewport = try unwrap(scrolling.boundingRects?[key])
      for name in ["notch.volume", "notch.battery"] {
        let item: ItemState = try bar.query(name)
        let frame = try unwrap(item.boundingRects?[key])
        try requireEqual(item.geometry?.position, "right")
        try require(
          viewport.origin[0] + viewport.size[0] <= frame.origin[0],
          "Usage overlaps status indicators")
      }
      let text = "󰀄 12% ·  18%"
      try set(bar, "notch.ai_usage.providers", ["label=\(text)"])
      try controller.layout()
      let restored: ItemState = try bar.query("notch.ai_usage.providers")
      try requireEqual(restored.geometry?.scrollTexts, "off")
      try require(restored.label?.font?.hasSuffix(":12.00") == true)
      let width = Double(
        textWidth(text, size: 12) + (restored.label?.paddingLeft ?? 0)
          + (restored.label?.paddingRight ?? 0))
      try require(
        abs(try unwrap(restored.boundingRects?[key]).size[0] - width) <= 1,
        "Recovery left text capped")
    }
  }
  static var allTests = [
    ("native independent account hover", testAccountPopups),
    ("native glyph bounds", testGlyphBounds),
    ("native notch stats and overflow", testNotchStatsAndOverflow),
  ]
}
