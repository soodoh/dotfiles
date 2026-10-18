import Foundation

struct UsageSnapshot: Decodable {
  var directText: String
  var proxyAccounts: [UsageAccount]
  static func decode(_ data: Data) throws -> UsageSnapshot {
    let snapshot = try JSONDecoder().decode(Self.self, from: data)
    let keys = snapshot.proxyAccounts.map(\.key)
    guard Set(keys).count == keys.count,
      keys.allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil })
    else {
      throw HelperError("Invalid account keys")
    }
    return snapshot
  }
}
struct UsageAccount: Decodable {
  struct Scope: Decodable {
    var sessionPercentUsed: Double?
    var sessionResetAt: Double?
    var weeklyPercentUsed: Double?
    var weeklyResetAt: Double?
    var monthlyPercentUsed: Double?
    var monthlyResetAt: Double?
    var percentUsed: Double?
    var resetAt: Double?
    var windowSeconds: Double?
    var availableResets: Int?
  }
  struct ResetCredit: Decodable { var expiresAt: Double? }
  enum Balance: Decodable, Equatable {
    case credits(Double)
    case unlimited
    init(from decoder: Decoder) throws {
      let value = try decoder.singleValueContainer()
      if let number = try? value.decode(Double.self), number.isFinite, number >= 0 {
        self = .credits(number)
      } else if (try? value.decode(String.self)) == "unlimited" {
        self = .unlimited
      } else {
        throw HelperError("Invalid credit balance")
      }
    }
  }
  var key: String
  var summary: String
  var scope: Scope
  var plan: String?
  var health: String?
  var disabled: Bool?
  var stale: Bool?
  var quotaLookupFailed: Bool?
  var resetLookupFailed: Bool?
  var fetchedAt: Double
  var observedAt: Double
  var resetCreditsObservedAt: Double?
  var resetCredits: [ResetCredit]?
  var creditBalance: Balance?
}

struct PopupRow: Equatable {
  enum Kind { case detail, header, status, divider, spacer, note }
  var kind: Kind = .detail
  var title: String = ""
  var value: String = ""
}

// Pure presentation. Receives time explicitly so relative dates/freshness can
// be tested independently from the CLI and network. Dates use the local zone.
struct PopupFormatter {
  var now: Date
  var timeZone: TimeZone = .current
  func date(_ milliseconds: Double, format: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = format
    return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
  }
  func clock(_ milliseconds: Double) -> String {
    date(milliseconds, format: "yyyy-MM-dd")
      == date(now.timeIntervalSince1970 * 1000, format: "yyyy-MM-dd")
      ? date(milliseconds, format: "HH:mm") : date(milliseconds, format: "MMM dd, HH:mm")
  }
  func remaining(_ milliseconds: Double) -> String {
    let minutes = max(0, ceil((milliseconds / 1000 - now.timeIntervalSince1970) / 60))
    if minutes < 60 { return "\(Int(minutes))m" }
    if minutes < 1440 { return "\(Int(ceil(minutes / 60)))h" }
    return "\(Int(ceil(minutes / 1440)))d"
  }
  func resetDate(_ milliseconds: Double) -> String {
    "\(date(milliseconds, format: "MMM dd, HH:mm")) · \(remaining(milliseconds))"
  }
  func observed(_ milliseconds: Double) -> String {
    let minutes = max(0, Int((now.timeIntervalSince1970 - milliseconds / 1000) / 60))
    if minutes == 0 { return "just now" }
    if minutes < 60 { return "\(minutes)m ago" }
    if minutes < 1440 { return "\(minutes / 60)h ago" }
    return "\(minutes / 1440)d ago"
  }
  func windowName(_ seconds: Double?) -> String {
    guard let seconds, seconds.isFinite, seconds > 0 else { return "Quota" }
    for (unit, size) in [("d", 86400.0), ("h", 3600.0), ("m", 60.0), ("s", 1.0)] {
      if seconds.truncatingRemainder(dividingBy: size) == 0 {
        return "\((seconds / size).formatted(.number.locale(Locale(identifier: "en_US_POSIX"))))\(unit)"
      }
    }
    return "\(seconds)s"
  }
  func rows(_ account: UsageAccount) -> [PopupRow] {
    let plans = [
      "pro": "Pro", "prolite": "Pro Lite", "plus": "Plus", "free": "Free", "team": "Team",
      "business": "Business", "enterprise": "Enterprise",
    ]
    let plan = account.plan ?? ""
    let title = "Codex" + (plan.isEmpty ? "" : " · \(plans[plan] ?? plan)")
    let health = [
      "active": "Active", "unavailable": "Unavailable", "cooling-down": "Cooling down",
      "error": "Error",
    ]
    let status =
      (account.disabled == true ? "Disabled" : health[account.health ?? ""] ?? "Not reported")
      + (account.stale == true ? " · stale data" : "")
    var rows = [
      PopupRow(kind: .header, title: title, value: "Updated at \(clock(account.fetchedAt))"),
      PopupRow(kind: .status, title: status), PopupRow(kind: .divider),
    ]
    let windows = [
      ("Session", account.scope.sessionPercentUsed, account.scope.sessionResetAt),
      ("Weekly", account.scope.weeklyPercentUsed, account.scope.weeklyResetAt),
      ("Monthly", account.scope.monthlyPercentUsed, account.scope.monthlyResetAt),
      (windowName(account.scope.windowSeconds), account.scope.percentUsed, account.scope.resetAt),
    ]
    let hasQuota = windows.contains { $0.1 != nil }
    if account.quotaLookupFailed == true {
      rows.append(
        PopupRow(
          title: "Quota lookup", value: "Failed · \(hasQuota ? "last observed" : "unavailable")"))
    }
    if account.resetLookupFailed == true {
      rows.append(
        PopupRow(
          title: "Reset lookup",
          value:
            "Failed · \(account.scope.availableResets != nil ? "last observed" : "unavailable")"))
    }
    if !hasQuota { rows.append(PopupRow(title: "Quota", value: "Unavailable")) }
    for (name, used, reset) in windows {
      if let used {
        rows.append(PopupRow(title: "\(name) usage", value: "\(Int(used.rounded()))%"))
        if let reset { rows.append(PopupRow(title: "Resets", value: resetDate(reset))) }
      }
    }
    rows.append(PopupRow(kind: .spacer))
    let balance: String
    switch account.creditBalance {
    case .credits(let value):
      balance =
        "\(value.formatted(.number.locale(Locale(identifier: "en_US")).precision(.fractionLength(0...8)))) credits"
    case .unlimited: balance = "Unlimited"
    case nil: balance = "Unavailable"
    }
    rows.append(PopupRow(title: "Credit balance", value: balance))
    rows.append(
      PopupRow(
        title: "Manual resets",
        value: account.scope.availableResets.map {
          "\($0) \(account.resetLookupFailed == true ? "last observed" : "available")"
        } ?? "Unavailable"))
    for (index, credit) in (account.resetCredits ?? []).enumerated() {
      rows.append(
        PopupRow(
          title: index == 0 ? "Expires" : "",
          value: credit.expiresAt.map(resetDate) ?? "Not reported"))
    }
    if hasQuota
      && (account.quotaLookupFailed == true || account.fetchedAt - account.observedAt > 60_000)
    {
      rows.append(
        PopupRow(
          kind: .note,
          value:
            "Quota last observed at \(clock(account.observedAt)) (\(observed(account.observedAt)))")
      )
    }
    if account.scope.availableResets != nil, let observedAt = account.resetCreditsObservedAt,
      account.resetLookupFailed == true || account.fetchedAt - observedAt > 60_000
    {
      rows.append(
        PopupRow(
          kind: .note,
          value: "Resets last observed at \(clock(observedAt)) (\(observed(observedAt)))"))
    }
    return rows
  }
}

struct UsageReader {
  var environment: [String: String]
  var run: (String, [String], [String: String]) throws -> ProcessResult = runProcess
  var isExecutable: (String) -> Bool = FileManager.default.isExecutableFile(atPath:)
  var exists: (String) -> Bool = FileManager.default.fileExists(atPath:)
  var home: String { environment["HOME"] ?? NSHomeDirectory() }
  var diagnosticsPath: String {
    environment["AI_USAGE_LOG_PATH"]
      ?? "\(environment["XDG_CACHE_HOME"] ?? home + "/.cache")/sketchybar/ai-usage.log"
  }

  func read() throws -> UsageSnapshot {
    let extensions = environment["PI_EXTENSIONS_DIR"] ?? "\(home)/.pi/agent/pi-extensions"
    let cli =
      environment["PROVIDER_USAGE_CLI"]
      ?? "\(extensions)/packages/statusline/src/provider-usage-cli.ts"
    guard exists(cli) else { throw HelperError("Provider usage CLI is missing") }
    let checkout = URL(fileURLWithPath: extensions).resolvingSymlinksInPath()
      .deletingLastPathComponent().path
    let mise = environment["MISE_BIN"] ?? "\(home)/.local/bin/mise"
    var bun = environment["BUN_BIN"] ?? "\(home)/.bun/bin/bun"
    if !isExecutable(bun), isExecutable(mise) {
      let result = try run(mise, ["-C", checkout, "which", "bun"], environment)
      if result.status == 0 {
        bun = String(decoding: result.output, as: UTF8.self).trimmingCharacters(
          in: .whitespacesAndNewlines)
      }
    }
    if !isExecutable(bun) { bun = executable("bun", environment: environment) ?? "" }
    guard !bun.isEmpty, isExecutable(bun) else { throw HelperError("Bun is unavailable") }
    var childEnvironment = environment
    let result: ProcessResult
    if exists("\(environment["XDG_CONFIG_HOME"] ?? home + "/.config")/mise/miserc.toml") {
      guard isExecutable(mise) else { throw HelperError("Mise is unavailable") }
      childEnvironment["MISE_EXEC_AUTO_INSTALL"] = "false"
      result = try run(mise, ["-C", checkout, "exec", "--", bun, cli], childEnvironment)
    } else {
      result = try run(bun, [cli], childEnvironment)
    }
    appendDiagnostics(result.diagnostics, path: diagnosticsPath)
    guard result.status == 0 else { throw HelperError("Provider usage CLI failed") }
    do { return try UsageSnapshot.decode(result.output) } catch {
      throw HelperError("Provider usage CLI returned invalid JSON")
    }
  }
}
