import Foundation

enum BarStyle {
  static let height = 32
  static let gutter = 6
  static let metricGap = 4
  static let separatorWidth = 1
  static let separatorGutter = 10
  static let notchInset = 8
}
struct Section {
  enum Kind { case text, metric, separator, icon }
  enum Placement { case row, popup, hidden, besideNotch }
  var name: String
  var kind: Kind
  var placement: Placement = .row
  // Native right-position items are ordered right-to-left.
  static let defaults: [Section] = [
    Section(name: "clock", kind: .text),
    Section(name: "right_separator.system", kind: .separator),
    Section(name: "battery", kind: .metric), Section(name: "volume", kind: .metric),
    Section(name: "ram", kind: .metric, placement: .popup),
    Section(name: "cpu", kind: .metric, placement: .popup),
    Section(name: "right_separator.ai", kind: .separator, placement: .hidden),
    Section(name: "ai_usage.providers", kind: .text, placement: .besideNotch),
  ]
  static func reservedWidth(_ sections: [Section]) -> Int {
    var result = 0
    var hasPopup = false
    for section in sections {
      if section.placement == .popup {
        hasPopup = true
        continue
      }
      if section.placement == .hidden || section.placement == .besideNotch { continue }
      switch section.kind {
      case .metric: result += 44 + BarStyle.metricGap + 2 * BarStyle.gutter
      case .text: result += 128 + 2 * BarStyle.gutter
      case .icon: result += 12 + 2 * BarStyle.gutter
      case .separator: result += BarStyle.separatorWidth + 2 * BarStyle.separatorGutter
      }
    }
    return result + (hasPopup ? 12 + 2 * BarStyle.gutter : 0)
  }
}

func accountItem(_ name: String) -> Bool {
  name.range(of: "^(notch[.])?ai_usage[.]proxy[.][a-f0-9]{64}$", options: .regularExpression) != nil
}
func accountOrRow(_ name: String) -> Bool {
  name.range(
    of: "^(notch[.])?ai_usage[.]proxy[.][a-f0-9]{64}([.]detail[.][0-9]+)?$",
    options: .regularExpression) != nil
}

struct BarController {
  var bar: BarClient
  var configDirectory: String
  var binary: String
  var palette: Palette
  var sections = Section.defaults
  var notches: () throws -> [NotchedDisplay] = nativeNotches

  // Sketchybar runs scripts through a shell. Quote only fixed configuration;
  // account/provider text travels as Process argv, never executable script.
  func script(_ mode: String) -> String {
    [
      "/usr/bin/env", "CONFIG_DIR=\(configDirectory)", "ACCENT_COLOR=\(palette.accent)",
      "DIMMED_COLOR=\(palette.dimmed)", "BAR_COLOR=\(palette.background)",
      "INACTIVE_BORDER_COLOR=\(palette.border)", binary, mode,
    ].map(shellQuote).joined(separator: " ")
  }
  func popupProperties(height: Int) -> [String] {
    [
      "script=\(script("popup"))", "popup.align=center", "popup.height=\(height)",
      "popup.y_offset=-1",
      "popup.background.color=\(palette.background)", "popup.background.corner_radius=5",
      "popup.background.border_color=\(palette.border)", "popup.background.border_width=1",
    ]
  }
  func style(_ kind: Section.Kind) -> [String] {
    let outer = kind == .separator ? BarStyle.separatorGutter : 0
    var p = [
      "width=dynamic", "padding_left=\(outer)", "padding_right=\(outer)",
      "icon.width=\(kind == .separator ? String(BarStyle.separatorWidth) : "dynamic")",
      "icon.align=left", "icon.padding_left=\(BarStyle.gutter)",
      "icon.padding_right=\(BarStyle.metricGap)",
      "label.width=dynamic", "label.align=left", "label.padding_left=0",
      "label.padding_right=\(BarStyle.gutter)",
      "icon.drawing=on", "label.drawing=on", "label.max_chars=0", "background.drawing=off",
    ]
    switch kind {
    case .text: p += ["icon.drawing=off", "label.padding_left=\(BarStyle.gutter)"]
    case .icon: p += ["label.drawing=off", "icon.padding_right=\(BarStyle.gutter)"]
    case .separator:
      // Empty fixed-width icon avoids font side bearings; the item stays
      // dynamic because native RTL fixed-item widths bypass outer padding.
      p += [
        "icon=", "icon.padding_left=0", "icon.padding_right=0", "label.drawing=off",
        "background.drawing=on", "background.color=0x66ffffff",
        "background.height=\(BarStyle.height)",
        "background.corner_radius=0", "background.border_width=0",
      ]
    case .metric: break
    }
    return p
  }
  func appearance() throws {
    var c = Commands()
    c.command(
      "--bar", "position=top", "height=\(BarStyle.height)", "padding_left=20", "blur_radius=30",
      "color=\(palette.background)")
    try bar.apply(c)
  }
  func createSections() throws {
    var c = Commands()
    for section in sections {
      let name = section.name
      c.command("--add", "item", name, "right")
      if section.kind == .metric || section.kind == .text {
        c.set(
          name,
          ["script=\(shellQuote(configDirectory + "/plugins/" + name + ".sh"))", "update_freq=120"])
      }
      switch name {
      case "clock": c.set(name, ["update_freq=10"])
      case "cpu": c.set(name, ["update_freq=10", "icon=󰻠"])
      case "battery": c.command("--subscribe", name, "system_woke", "power_source_change")
      case "volume":
        c.set(name, ["update_freq=0"])
        c.command("--subscribe", name, "volume_change")
      case "ram": c.set(name, ["icon="])
      case "ai_usage.providers": c.set(name, ["script=", "update_freq=0", "drawing=off"])
      case "right_separator.ai": c.set(name, ["drawing=off"])
      default: break
      }
      c.set(name, style(section.kind))
    }
    var popupItems: [String] = []
    for section in sections {
      let name = "notch." + section.name
      c.command("--clone", name, section.name)
      c.set(
        name,
        [
          "display=0", "icon.font=FiraCode Nerd Font:Bold:14.0",
          "label.font=FiraCode Nerd Font:Bold:12.0",
        ] + style(section.kind))
      if section.kind == .metric { c.set(name, ["label.max_chars=4"]) }
      switch section.placement {
      case .popup: popupItems.append(name)
      case .hidden: c.set(name, ["drawing=off"])
      case .besideNotch:
        c.set(
          name,
          [
            "position=e", "padding_left=\(BarStyle.notchInset)", "scroll_texts=off",
            "label.max_chars=0", "label.scroll_duration=100",
          ])
      case .row: break
      }
    }
    if let first = popupItems.first {
      c.command("--add", "item", "notch.stats", "right")
      c.set(
        "notch.stats",
        ["display=0", "icon=", "icon.font=FiraCode Nerd Font:Bold:14.0"]
          + popupProperties(height: 30) + style(.icon))
      c.command("--subscribe", "notch.stats", "mouse.entered", "mouse.exited")
      c.command("--move", "notch.stats", "before", first)
      for (index, name) in popupItems.enumerated() {
        c.set(
          name,
          [
            "position=popup.notch.stats", "icon=\(name.dropFirst(6).uppercased())", "width=120",
            "padding_left=0", "padding_right=0",
            "icon.font=FiraCode Nerd Font:Bold:12.0", "icon.width=60", "icon.align=left",
            "icon.padding_left=12", "icon.padding_right=0",
            "label.font=FiraCode Nerd Font:Bold:12.0", "label.width=60", "label.align=right",
            "label.padding_left=0", "label.padding_right=12", "label.max_chars=0",
          ])
        if index > 0 { c.command("--move", name, "before", popupItems[index - 1]) }
      }
    }
    try bar.apply(c)
  }
  func installEvents() throws {
    let state: BarState = try bar.query("bar")
    var c = Commands()
    if !state.items.contains("ai_usage.refresh") {
      c.command("--add", "item", "ai_usage.refresh", "right")
    }
    c.set(
      "ai_usage.refresh",
      ["drawing=off", "updates=on", "update_freq=60", "script=\(script("refresh"))"])
    c.command("--subscribe", "ai_usage.refresh", "system_woke")
    if !state.items.contains("notch.layout") {
      c.command("--add", "event", "notch_usage_change")
      c.command("--add", "item", "notch.layout", "left")
    }
    c.set(
      "notch.layout", ["drawing=off", "updates=on", "update_freq=30", "script=\(script("layout"))"])
    c.command("--subscribe", "notch.layout", "display_change", "system_woke", "notch_usage_change")
    if state.items.contains("notch.stats") { c.set("notch.stats", ["script=\(script("popup"))"]) }
    try bar.apply(c)
  }
  func createGuardPadding() throws {
    let state: BarState = try bar.query("bar")
    guard !state.items.contains("bar.guard.padding"), let first = state.items.first else { return }
    var c = Commands()
    c.command("--bar", "padding_left=0")
    c.command("--add", "item", "bar.guard.padding", "left")
    c.set(
      "bar.guard.padding",
      [
        "width=\(state.paddingLeft ?? 0)", "padding_left=0", "padding_right=0", "icon.drawing=off",
        "label.drawing=off", "background.drawing=off",
      ])
    c.command("--move", "bar.guard.padding", "before", first)
    try bar.apply(c)
  }
  func guardCommands(displays: [Display], state: BarState) -> Commands {
    var c = Commands()
    let ids = Set(displays.map { String($0.arrangementId) })
    for name in state.items
    where name == "bar.guard"
      || name.range(of: "^bar[.]guard[.][0-9]+$", options: .regularExpression) != nil
    {
      if name == "bar.guard" || !ids.contains(String(name.split(separator: ".").last!)) {
        c.command("--remove", name, "--remove", name + ".anchor")
      }
    }
    for display in displays {
      let id = display.arrangementId
      let name = "bar.guard.\(display.arrangementId)"
      let anchor = name + ".anchor"
      if !state.items.contains(anchor) {
        c.command(
          "--add", "item", anchor, "left", "--move", anchor, "before", "bar.guard.padding", "--add",
          "bracket", name, anchor)
      }
      // Bracket windows are not clipped to screens. Bound every hit
      // region to its own display, including left/below-primary displays.
      c.set(
        anchor,
        [
          "display=\(id)", "width=0", "padding_left=0",
          "padding_right=\(Int(floor(display.frame.w)))", "icon.drawing=off", "label.drawing=off",
          "background.drawing=off",
        ])
      c.set(
        name,
        [
          "display=\(id)", "background.color=0x00000000", "background.drawing=off",
          "click_script=\(script("guard"))",
        ])
    }
    return c
  }
  func layout() throws {
    // Read/validate all inputs before issuing any mutation. A detector or
    // query failure must not masquerade as clamshell mode.
    let native = try notches()
    let displays: [Display] = try bar.query("displays")
    let state: BarState = try bar.query("bar")
    let layout = DisplayLayout(
      displays: displays, notches: native, bar: state, reserved: Section.reservedWidth(sections))
    let names = state.items.filter {
      $0 == "notch.ai_usage.providers" || ($0.hasPrefix("notch.") && accountItem($0))
    }
    let parts = try names.map { UsagePart(item: try bar.query($0, as: ItemState.self)) }
    let fit =
      layout.available.map { fitUsage(parts, available: $0) }
      ?? UsageFit(fontSize: 12, caps: parts.map { _ in 0 })
    var c = guardCommands(displays: displays, state: state)
    c.command("--bar", "notch_width=\(layout.gap)")
    if state.topmost != "off" { c.args.append("topmost=off") }
    for name in state.items where name != "notch.layout" {
      if name.hasPrefix("notch.") {
        c.set(name, ["display=\(layout.notch)"])
        if layout.notch == "0", name.hasPrefix("notch.ai_usage.proxy.") {
          c.set(name, ["popup.drawing=off"])
        }
      } else if name.hasPrefix("ai_usage.proxy.") {
        c.set(name, ["display=\(layout.regular)"])
        if layout.regular == "0" { c.set(name, ["popup.drawing=off"]) }
      }
    }
    for section in sections where state.items.contains(section.name) {
      c.set(section.name, ["display=\(layout.regular)"])
      if section.placement == .row, state.items.contains("notch." + section.name) {
        c.set("notch." + section.name, ["position=right"])
      }
    }
    for (index, name) in names.enumerated() {
      let cap = fit.caps[index]
      c.set(
        name,
        [
          "position=e", "label.font.size=\(fit.fontSize)", "icon.font.size=\(fit.fontSize)",
          "label.max_chars=\(cap)", "scroll_texts=\(cap > 0 ? "on" : "off")",
        ])
    }
    if layout.notch == "0", state.items.contains("notch.stats") {
      c.set("notch.stats", ["popup.drawing=off"])
    }
    try bar.apply(c)
  }
  func popup(name: String, sender: String) throws {
    guard name == "notch.stats" || accountItem(name) else { return }
    guard sender == "mouse.entered" || sender == "mouse.exited" else { return }
    var c = Commands()
    c.set(name, ["popup.drawing=\(sender == "mouse.entered" ? "on" : "off")"])
    try bar.apply(c)
  }
  func guardClick(name: String) throws {
    guard name.range(of: "^bar[.]guard[.][0-9]+$", options: .regularExpression) != nil else {
      return
    }
    var c = Commands()
    c.command("--reorder", name)
    c.set(name, ["background.drawing=toggle"])
    try bar.apply(c)
  }
  func render(_ usage: UsageSnapshot, now: Date = Date()) throws {
    let state: BarState = try bar.query("bar")
    var c = Commands()
    var wanted: Set<String> = []
    let formatter = PopupFormatter(now: now)
    for prefix in ["", "notch."] {
      let anchor = prefix + "ai_usage.providers"
      guard state.items.contains(anchor) else { continue }
      let notch = !prefix.isEmpty
      c.set(
        anchor,
        [
          "drawing=\(usage.directText.isEmpty ? "off" : "on")", "icon.drawing=off",
          "label=\(usage.directText)", "label.color=\(palette.accent)",
          "label.padding_right=\(usage.proxyAccounts.isEmpty ? BarStyle.gutter : 0)",
        ])
      var previous = anchor
      for (index, account) in usage.proxyAccounts.enumerated() {
        let name = prefix + "ai_usage.proxy." + account.key
        wanted.insert(name)
        if !state.items.contains(name) {
          c.command("--clone", name, anchor)
          c.set(
            name,
            [
              "popup.drawing=off", "label.max_chars=0", "scroll_texts=off",
              "icon.font.size=\(notch ? 12 : 14)",
            ])
        }
        let color = account.disabled == true ? palette.dimmed : palette.accent
        let separator = index > 0 || !usage.directText.isEmpty
        // Leading spaces in a text box shift paint without extending
        // glyph-path width. The dot uses its native icon slot instead.
        // Its 2–3px bearing needs unequal box padding for equal visual gaps.
        c.set(
          name,
          [
            "position=\(notch ? "e" : "right")", "drawing=on", "width=dynamic", "padding_left=0",
            "padding_right=0", "background.drawing=off",
            "icon=·", "icon.drawing=\(separator ? "on" : "off")", "icon.width=dynamic",
            "icon.color=\(color)", "icon.padding_left=10", "icon.padding_right=15",
            "label=  \(account.summary)\(account.stale == true ? " !" : "")",
            "label.color=\(color)", "label.width=dynamic",
            "label.padding_left=\(separator ? 0 : BarStyle.gutter)",
            "label.padding_right=\(index == usage.proxyAccounts.count - 1 ? BarStyle.gutter : 0)",
            "update_freq=0", "updates=on", "click_script=",
          ] + popupProperties(height: 26))
        if !notch { c.set(name, ["icon.font.size=14"]) }
        if notch, usage.directText.isEmpty, index == 0 {
          c.set(name, ["padding_left=\(BarStyle.notchInset)"])
        }
        c.command("--subscribe", name, "mouse.entered", "mouse.exited")
        c.command("--move", name, notch ? "after" : "before", previous)
        for (rowIndex, row) in formatter.rows(account).enumerated() {
          let detail = name + ".detail.\(rowIndex)"
          wanted.insert(detail)
          if !state.items.contains(detail) { c.command("--add", "item", detail, "popup." + name) }
          c.set(detail, rowProperties(row))
          if rowIndex > 0 { c.command("--move", detail, "after", name + ".detail.\(rowIndex - 1)") }
        }
        previous = name
      }
    }
    // Remove children before parents regardless of native item reordering.
    let obsolete = state.items.filter { accountOrRow($0) && !wanted.contains($0) }
    for name in obsolete.filter({ $0.contains(".detail.") })
      + obsolete.filter({ !$0.contains(".detail.") })
    { c.command("--remove", name) }
    if state.items.contains("right_separator.ai") {
      c.set(
        "right_separator.ai",
        ["drawing=\(usage.directText.isEmpty && usage.proxyAccounts.isEmpty ? "off" : "on")"])
    }
    c.command("--trigger", "notch_usage_change")
    try bar.apply(c)
  }
  func rowProperties(_ row: PopupRow) -> [String] {
    var p = [
      "drawing=on", "width=380", "padding_left=0", "padding_right=0", "update_freq=0",
      "updates=off", "script=", "click_script=", "background.drawing=off",
      "icon=\(row.title)", "icon.drawing=on", "icon.font=FiraCode Nerd Font:Bold:12.0",
      "icon.color=\(palette.dimmed)", "icon.width=130", "icon.align=left", "icon.padding_left=12",
      "icon.padding_right=0", "icon.max_chars=0",
      "label=\(row.value)", "label.drawing=on", "label.font=FiraCode Nerd Font:Bold:12.0",
      "label.color=\(palette.accent)", "label.width=250", "label.align=right",
      "label.padding_left=0", "label.padding_right=12", "label.max_chars=0", "scroll_texts=off",
    ]
    switch row.kind {
    case .header:
      p += [
        "icon.width=200", "icon.color=\(palette.accent)", "icon.max_chars=24", "label.width=180",
        "label.font=FiraCode Nerd Font:Bold:10.0", "label.color=\(palette.dimmed)",
      ]
    case .status: p += ["icon.width=380", "label.width=0"]
    case .divider:
      p += [
        "width=356", "icon.width=0", "label.width=0", "background.drawing=on",
        "background.height=1", "background.color=\(palette.border)", "padding_left=12",
        "padding_right=12",
      ]
    case .note:
      p += [
        "icon.width=0", "label.width=380", "label.align=left", "label.padding_left=12",
        "label.font=FiraCode Nerd Font:Bold:10.0", "label.color=\(palette.dimmed)",
      ]
    case .detail, .spacer: break
    }
    return p
  }
}
