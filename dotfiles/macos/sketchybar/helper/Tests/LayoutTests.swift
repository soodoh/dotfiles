import Foundation

final class LayoutTests {
  func testMeasuredIndependentWindows() throws {
    let parts = [
      UsagePart(text: "  0% (7d ↻3)"),
      UsagePart(text: "  100% (12h ↻2)", icon: "·", iconPadding: 25), UsagePart(text: "󰀄 15%"),
    ]
    for size in 9...12 {
      try requireEqual(
        groupWidth(parts, size: size), parts.reduce(0) { $0 + groupWidth([$1], size: size) })
      let withDot = parts[1]
      try requireEqual(
        groupWidth([withDot], size: size) - groupWidth([UsagePart(text: withDot.text)], size: size),
        textWidth("·", size: size) + withDot.iconPadding)
    }
    try requireEqual(groupWidth([UsagePart(text: "")], size: 12), 0)
  }
  func testFontAndScrollRecovery() throws {
    let parts = [
      UsagePart(text: "  0% (7d ↻3)"),
      UsagePart(text: String(repeating: "󰀄 100% (12h) ", count: 4), icon: "·", iconPadding: 25),
    ]
    for available in [65, 90, 120, 180, 250, 400, 9999] {
      let fit = fitUsage(parts, available: available)
      try requireAtMost(groupWidth(parts, size: fit.fontSize, caps: fit.caps), available)
      if fit.caps.contains(where: { $0 > 0 }) {
        try requireEqual(fit.fontSize, 9)
      } else if fit.fontSize < 12 {
        try requireGreater(groupWidth(parts, size: fit.fontSize + 1), available)
      }
    }
    try requireEqual(fitUsage([UsagePart(text: "12%")], available: 90).caps, [0])
    try requireEqual(fitUsage([UsagePart(text: "12%")], available: 90).fontSize, 12)
  }
  func testDisplayMappingGuardsAndFailureAtomicity() throws {
    let fake = FakeBar()
    try fake.ready()
    var controller = fake.controller()
    controller.notches = { [NotchedDisplay(id: 73, notchWidth: 185)] }
    fake.displays = [
      display(1, native: 99, width: 2560, x: 1512, y: -200), display(2, native: 73, width: 1512),
      display(3, native: 101, width: 1920, x: -1920),
    ]
    try controller.layout()
    try requireEqual(fake.items["clock"]?["display"], "1,3")
    try requireEqual(fake.items["notch.clock"]?["display"], "2")
    try requireNil(fake.items["front_app"]?["display"])
    try requireNil(fake.items["space.1"]?["display"])
    for d in fake.displays {
      let guardName = "bar.guard.\(d.arrangementId)"
      try requireEqual(fake.items[guardName]?["display"], String(d.arrangementId))
      try requireEqual(fake.items[guardName + ".anchor"]?["width"], "0")
      try requireEqual(fake.items[guardName + ".anchor"]?["padding_left"], "0")
      try requireEqual(fake.items[guardName + ".anchor"]?["padding_right"], String(Int(d.frame.w)))
    }
    // Reconnect under a new arrangement ID: retire old native hit regions.
    fake.displays = [display(4, native: 99, width: 1920)]
    try controller.layout()
    try requireNil(fake.items["bar.guard.2"])
    try requireNil(fake.items["bar.guard.3.anchor"])
    try requireEqual(fake.items["clock"]?["display"], "4")
    try requireEqual(fake.items["notch.stats"]?["popup.drawing"], "off")
    let members = Set(fake.order)
    try controller.layout()
    try requireEqual(Set(fake.order), members)
    fake.mutations = []
    controller.notches = { throw HelperError("Detector failed") }
    try requireThrows(try controller.layout())
    try require(fake.mutations.isEmpty)
    controller.notches = { [] }
    fake.failQuery = "notch.ai_usage.providers"
    try requireThrows(try controller.layout())
    try require(fake.mutations.isEmpty)
  }
  func testRefreshPreservesNotchCapsAndHover() throws {
    let fake = FakeBar()
    try fake.ready()
    var controller = fake.controller()
    fake.displays = [display(1, native: 73, width: 1280), display(2, native: 99, width: 2560)]
    controller.notches = { [NotchedDisplay(id: 73, notchWidth: 185)] }
    var a = accountFixture()
    a["summary"] = String(repeating: "S100%/W100% ", count: 8)
    let usage = try snapshot([a, accountFixture("b")])
    try controller.render(usage, now: testNow)
    try controller.layout()
    let names = fake.order.filter {
      $0 == "notch.ai_usage.providers" || $0.hasPrefix("notch.") && accountItem($0)
    }
    let caps = names.map { fake.items[$0]?["label.max_chars"] }
    try require(caps.contains { $0 != "0" })
    let host = try unwrap(names.first(where: accountItem))
    try controller.popup(name: host, sender: "mouse.entered")
    try controller.render(usage, now: testNow)
    try requireEqual(names.map { fake.items[$0]?["label.max_chars"] }, caps)
    try controller.layout()
    try requireEqual(fake.items[host]?["popup.drawing"], "on")
    try requireEqual(fake.items["notch.volume"]?["position"], "right")
    try requireEqual(fake.items["notch.battery"]?["position"], "right")
    try requireEqual(fake.properties["topmost"], "off")
    try controller.render(snapshot([], direct: "12%"), now: testNow)
    try controller.layout()
    try requireEqual(fake.items["notch.ai_usage.providers"]?["label.max_chars"], "0")
    try requireEqual(fake.items["notch.ai_usage.providers"]?["scroll_texts"], "off")
    try requireEqual(fake.items["notch.ai_usage.providers"]?["label.font.size"], "12")
    controller.notches = { [] }
    try controller.layout()
    try requireEqual(fake.items["notch.ai_usage.providers"]?["display"], "0")
  }
  func testSectionGeometryAndMembership() throws {
    let fake = FakeBar()
    try fake.ready()
    let metrics = ["cpu", "ram", "volume", "battery", "notch.volume", "notch.battery"]
    let clock = try unwrap(fake.items["clock"])
    for name in metrics {
      let item = try unwrap(fake.items[name])
      try requireEqual(item["width"], "dynamic")
      try requireEqual(item["icon.padding_left"], clock["label.padding_left"])
      try requireEqual(item["label.padding_right"], clock["label.padding_right"])
    }
    for name in ["notch.cpu", "notch.ram"] {
      let row = try unwrap(fake.items[name])
      try requireEqual(row["position"], "popup.notch.stats")
      try requireEqual(row["icon.font"], row["label.font"])
      try requireEqual(Int(row["icon.width"]!)! + Int(row["label.width"]!)!, Int(row["width"]!)!)
      try requireEqual(row["icon.padding_left"], row["label.padding_right"])
    }
    for prefix in ["", "notch."] {
      let separator = try unwrap(fake.items[prefix + "right_separator.system"])
      try requireEqual(separator["padding_left"], separator["padding_right"])
      try requireEqual(separator["icon"], "")
      try requireEqual(separator["width"], "dynamic")
      try requireEqual(separator["background.height"], fake.properties["height"])
    }
    let all = Section.defaults
    let onePopup = all.filter { $0.name != "ram" }
    let noPopup = all.filter { $0.placement != .popup }
    try requireEqual(Section.reservedWidth(all), Section.reservedWidth(onePopup))
    try requireGreater(Section.reservedWidth(onePopup), Section.reservedWidth(noPopup))
    try requireGreater(
      Section.reservedWidth(all), Section.reservedWidth(all.filter { $0.name != "volume" }))
    var controller = fake.controller()
    controller.sections = all.filter {
      $0.placement != .besideNotch && $0.name != "right_separator.ai"
    }
    for name in [
      "ai_usage.providers", "notch.ai_usage.providers", "right_separator.ai",
      "notch.right_separator.ai",
    ] {
      fake.items.removeValue(forKey: name)
      fake.order.removeAll { $0 == name }
    }
    fake.failQuery = "notch.ai_usage.providers"
    try requireNoThrow(try controller.layout())
  }
  static var allTests = [
    ("independent native widths", testMeasuredIndependentWindows),
    ("font selection and scroll recovery", testFontAndScrollRecovery),
    ("display mapping and guards", testDisplayMappingGuardsAndFailureAtomicity),
    ("refresh preserves bounded hover", testRefreshPreservesNotchCapsAndHover),
    ("section geometry and membership", testSectionGeometryAndMembership),
  ]
}
