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

struct UsagePart {
  var text: String
  var icon: String = ""
  var iconPadding: Int = 0
  init(text: String, icon: String = "", iconPadding: Int = 0) {
    self.text = text
    self.icon = icon
    self.iconPadding = iconPadding
  }
  init(item: ItemState) {
    text = item.geometry?.drawing == "on" ? item.label?.value ?? "" : ""
    let showsIcon = item.geometry?.drawing == "on" && item.icon?.drawing == "on"
    icon = showsIcon ? item.icon?.value ?? "" : ""
    iconPadding = showsIcon ? (item.icon?.paddingLeft ?? 0) + (item.icon?.paddingRight ?? 0) : 0
  }
}

struct UsageFit {
  var fontSize: Int
  // Zero means unbounded, not an empty viewport.
  var caps: [Int]
}

func proportionalCaps(_ parts: [UsagePart], budget: Int) -> [Int] {
  let lengths = parts.map { $0.text.unicodeScalars.count }
  let total = lengths.reduce(0, +)
  guard total > 0, budget > 0 else { return parts.map { _ in 0 } }
  return lengths.map { $0 > 0 ? max(1, budget * $0 / total) : 0 }
}

func groupWidth(_ parts: [UsagePart], size: Int, caps: [Int]? = nil) -> Int {
  parts.enumerated().reduce(0) { sum, pair in
    let (index, part) = pair
    let cap = caps?[index] ?? 0
    let text =
      cap > 0 ? String(String.UnicodeScalarView(part.text.unicodeScalars.prefix(cap))) : part.text
    return sum + textWidth(text, size: size) + textWidth(part.icon, size: size)
      + max(0, part.iconPadding)
  }
}

func fitUsage(_ parts: [UsagePart], available: Int) -> UsageFit {
  for size in stride(from: 12, through: 9, by: -1) {
    if groupWidth(parts, size: size) <= available {
      return UsageFit(fontSize: size, caps: parts.map { _ in 0 })
    }
  }
  let total = parts.reduce(0) { $0 + $1.text.unicodeScalars.count }
  var budget = 1
  if total > 1 {
    for candidate in 1..<total
    where groupWidth(parts, size: 9, caps: proportionalCaps(parts, budget: candidate)) <= available
    {
      budget = candidate
    }
  }
  return UsageFit(fontSize: 9, caps: proportionalCaps(parts, budget: budget))
}

struct DisplayLayout {
  var notch: String
  var regular: String
  var gap: Int
  var available: Int?
  init(displays: [Display], notches: [NotchedDisplay], bar: BarState, reserved: Int) {
    let matched = displays.compactMap { display -> (Display, NotchedDisplay)? in
      notches.first(where: { $0.id == display.directDisplayID }).map { (display, $0) }
    }
    let ids = Set(matched.map { $0.0.arrangementId })
    func mask(_ values: [Int]) -> String {
      values.isEmpty ? "0" : values.map(String.init).joined(separator: ",")
    }
    notch = mask(displays.filter { ids.contains($0.arrangementId) }.map(\.arrangementId))
    regular = mask(displays.filter { !ids.contains($0.arrangementId) }.map(\.arrangementId))
    gap = matched.map { Int(ceil($0.1.notchWidth + 16)) }.max() ?? 0
    available = matched.map { Int(floor(($0.0.frame.w - ($0.1.notchWidth + 16)) / 2)) }.min().map {
      $0 - max(bar.paddingLeft ?? 0, bar.paddingRight ?? 0) - reserved - BarStyle.notchInset - 4
        * BarStyle.gutter
    }
  }
}
