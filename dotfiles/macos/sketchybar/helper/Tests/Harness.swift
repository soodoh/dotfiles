import Foundation

func jsonData(_ value: Any) throws -> Data {
  try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
}
let testNow = Date(timeIntervalSince1970: 1_927_584_000)
func accountFixture(_ key: String = "a", disabled: Bool = false) -> [String: Any] {
  [
    "key": String(repeating: key, count: 64), "summary": "47% (2d ↻2)", "plan": "pro",
    "health": "active",
    "disabled": disabled, "stale": false, "fetchedAt": testNow.timeIntervalSince1970 * 1000,
    "observedAt": testNow.timeIntervalSince1970 * 1000,
    "resetCreditsObservedAt": testNow.timeIntervalSince1970 * 1000,
    "scope": [
      "weeklyPercentUsed": 47, "weeklyResetAt": (testNow.timeIntervalSince1970 + 2 * 86400) * 1000,
      "availableResets": 2,
    ],
    "resetCredits": [["expiresAt": (testNow.timeIntervalSince1970 + 86400) * 1000]],
    "creditBalance": 125.5,
  ]
}
func snapshot(_ accounts: [[String: Any]] = [accountFixture()], direct: String = "LLMHub $12.00")
  throws -> UsageSnapshot
{
  try UsageSnapshot.decode(jsonData(["directText": direct, "proxyAccounts": accounts]))
}
func display(_ id: Int, native: UInt32, width: Double, x: Double = 0, y: Double = 0) -> Display {
  Display(
    arrangementId: id, directDisplayID: native, frame: Display.Frame(x: x, y: y, w: width, h: 1000))
}

// Model the native item graph and opposing RTL/e orders, not a log of expected
// command strings. The real renderer/reflow runs through the same BarClient.
final class FakeBar {
  var items: [String: [String: String]] = [:]
  var order: [String] = []
  var properties = ["topmost": "off", "padding_left": "20", "padding_right": "20", "height": "32"]
  var displays: [Display] = [display(1, native: 99, width: 2560)]
  var mutations: [[String]] = []
  var queries: [String] = []
  var failQuery: String?
  lazy var client = BarClient { [unowned self] in try self.request($0) }
  func controller() -> BarController {
    BarController(
      bar: client, configDirectory: "/fixture/bar", binary: "/fixture/helper",
      palette: Palette(environment: [:]), notches: { [] })
  }
  func add(_ name: String, _ props: [String: String] = [:]) {
    items[name] = props
    order.append(name)
  }
  func ready() throws {
    add("space.1")
    add("front_app")
    let controller = controller()
    try controller.createSections()
    try controller.createGuardPadding()
    try controller.installEvents()
    try controller.layout()
    mutations = []
    queries = []
  }
  func queryObject(_ name: String) throws -> Any {
    queries.append(name)
    if name == failQuery { throw HelperError("Injected query failure") }
    if name == "bar" {
      return [
        "items": order, "topmost": properties["topmost"]!,
        "padding_left": Int(properties["padding_left"]!)!,
        "padding_right": Int(properties["padding_right"]!)!, "height": 32,
      ] as [String: Any]
    }
    if name == "displays" {
      return displays.map {
        [
          "arrangement-id": $0.arrangementId, "DirectDisplayID": $0.directDisplayID,
          "frame": ["x": $0.frame.x, "y": $0.frame.y, "w": $0.frame.w, "h": $0.frame.h],
        ] as [String: Any]
      }
    }
    guard let p = items[name] else { throw HelperError("Query of missing item") }
    func text(_ kind: String) -> [String: Any] {
      [
        "value": p[kind] ?? "", "drawing": p[kind + ".drawing"] ?? "on",
        "font": p[kind + ".font"] ?? "FiraCode Nerd Font:Bold:14.0",
        "width": Int(p[kind + ".width"] ?? "") ?? 0,
        "padding_left": Int(p[kind + ".padding_left"] ?? "0") ?? 0,
        "padding_right": Int(p[kind + ".padding_right"] ?? "0") ?? 0,
        "align": p[kind + ".align"] ?? "left",
      ]
    }
    return [
      "icon": text("icon"), "label": text("label"),
      "geometry": [
        "drawing": p["drawing"] ?? "on", "position": p["position"] ?? "right",
        "width": Int(p["width"] ?? "") ?? -1,
        "scroll_texts": p["scroll_texts"] ?? "off",
        "padding_left": Int(p["padding_left"] ?? "0") ?? 0,
        "padding_right": Int(p["padding_right"] ?? "0") ?? 0,
      ],
      "popup": [
        "drawing": p["popup.drawing"] ?? "off",
        "items": order.filter { items[$0]?["position"] == "popup." + name },
      ],
      "scripting": ["updates": p["updates"] ?? "on"], "bounding_rects": [:],
    ] as [String: Any]
  }
  func request(_ args: [String]) throws -> Data {
    if args.first == "--query" { return try jsonData(queryObject(args[1])) }
    mutations.append(args)
    var index = 0
    while index < args.count {
      let command = args[index]
      index += 1
      var end = index
      while end < args.count && !args[end].hasPrefix("--") { end += 1 }
      let fields = Array(args[index..<end])
      index = end
      switch command {
      case "--add":
        if fields[0] == "event" { continue }
        guard items[fields[1]] == nil else { throw HelperError("Duplicate item") }
        add(fields[1], ["position": fields[2]])
      case "--clone":
        guard items[fields[0]] == nil, let parent = items[fields[1]] else {
          throw HelperError("Invalid clone")
        }
        add(fields[0], parent)
      case "--set":
        guard items[fields[0]] != nil else { throw HelperError("Setting missing item") }
        for field in fields.dropFirst() {
          let parts = field.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
          items[fields[0]]![String(parts[0])] = String(parts[1])
        }
      case "--bar":
        for field in fields {
          let parts = field.split(separator: "=", maxSplits: 1)
          properties[String(parts[0])] = String(parts[1])
        }
      case "--move":
        guard let from = order.firstIndex(of: fields[0]) else {
          throw HelperError("Moving missing item")
        }
        order.remove(at: from)
        guard let to = order.firstIndex(of: fields[2]) else {
          throw HelperError("Missing move anchor")
        }
        order.insert(fields[0], at: to + (fields[1] == "after" ? 1 : 0))
      case "--remove":
        guard !items.values.contains(where: { $0["position"] == "popup." + fields[0] }) else {
          throw HelperError("Orphaned popup rows")
        }
        items.removeValue(forKey: fields[0])
        order.removeAll { $0 == fields[0] }
      case "--subscribe", "--trigger", "--reorder": break
      default: throw HelperError("Unexpected command")
      }
    }
    return Data()
  }
}

func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "bar-tests-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  try body(root)
}
