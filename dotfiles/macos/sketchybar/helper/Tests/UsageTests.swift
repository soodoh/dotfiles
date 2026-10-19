import Foundation

final class UsageTests {
  let formatter = PopupFormatter(now: testNow, timeZone: TimeZone(secondsFromGMT: 0)!)
  func rows(_ changes: [String: Any] = [:]) throws -> [PopupRow] {
    formatter.rows(
      try snapshot([accountFixture().merging(changes) { _, new in new }]).proxyAccounts[0])
  }
  func testHeaderAndFreshness() throws {
    let fresh = try rows(["observedAt": testNow.timeIntervalSince1970 * 1000 - 10000])
    try requireEqual(
      fresh.first, PopupRow(kind: .header, title: "Codex · Pro", value: "Updated at 00:00"))
    try requireFalse(fresh.contains { $0.kind == .note })
    let older = try rows(["observedAt": testNow.timeIntervalSince1970 * 1000 - 7 * 60000])
    try requireEqual(
      older.filter { $0.kind == .note }.map(\.value),
      ["Quota last observed at Jan 30, 23:53 (7m ago)"])
    try requireEqual(try rows(["plan": NSNull()]).first?.title, "Codex")
  }
  func testFallbacksAndUnknowns() throws {
    let retained = try rows([
      "disabled": true, "stale": true, "quotaLookupFailed": true, "resetLookupFailed": true,
    ])
    try require(retained.contains(PopupRow(kind: .status, title: "Disabled · stale data")))
    try require(retained.contains(PopupRow(title: "Quota lookup", value: "Failed · last observed")))
    try require(retained.contains(PopupRow(title: "Manual resets", value: "2 last observed")))
    try requireEqual(retained.filter { $0.kind == .note }.count, 2)
    let unknown = try rows(["scope": [:], "creditBalance": NSNull(), "resetCredits": []])
    for title in ["Quota", "Credit balance", "Manual resets"] {
      try require(unknown.contains(PopupRow(title: title, value: "Unavailable")))
    }
    try requireFalse(unknown.contains { $0.kind == .note })
  }
  func testBalancesAndExpirations() throws {
    for (balance, expected) in [
      (0 as Any, "0 credits"), (125.5, "125.5 credits"), (62500, "62,500 credits"),
      ("unlimited", "Unlimited"), (NSNull(), "Unavailable"),
    ] {
      let result = try rows(["creditBalance": balance])
      try require(result.contains(PopupRow(title: "Credit balance", value: expected)))
      try require(result.contains(PopupRow(title: "Manual resets", value: "2 available")))
    }
    let result = try rows([
      "resetCredits": [["expiresAt": (testNow.timeIntervalSince1970 + 3600) * 1000], [:]]
    ])
    let expiry = try unwrap(result.firstIndex { $0.title == "Expires" })
    try requireEqual(result[expiry].value, "Jan 31, 01:00 · 1h")
    try requireEqual(result[expiry + 1], PopupRow(value: "Not reported"))
  }
  func testScopeWindowsAndValidation() throws {
    let result = try rows([
      "scope": [
        "sessionPercentUsed": 12.4, "weeklyPercentUsed": 0,
        "sessionResetAt": (testNow.timeIntervalSince1970 + 60) * 1000,
      ]
    ])
    try require(result.contains(PopupRow(title: "Session usage", value: "12%")))
    try require(result.contains(PopupRow(title: "Weekly usage", value: "0%")))
    try require(result.contains(PopupRow(title: "Resets", value: "Jan 31, 00:01 · 1m")))
    try requireThrows(
      try snapshot([accountFixture().merging(["key": "bad key"]) { _, new in new }]))
    try requireThrows(try snapshot([accountFixture(), accountFixture()]))
    try requireThrows(try rows(["creditBalance": -1]))
    try requireThrows(try UsageSnapshot.decode(Data("not JSON".utf8)))
  }
  func testMonthlyAndUnclassifiedQuota() throws {
    let reset = (testNow.timeIntervalSince1970 + 30 * 86400) * 1000
    let monthly = try rows([
      "plan": "free", "scope": ["monthlyPercentUsed": 0, "monthlyResetAt": reset],
    ])
    try require(monthly.contains(PopupRow(title: "Monthly usage", value: "0%")))
    try require(monthly.contains(PopupRow(title: "Resets", value: formatter.resetDate(reset))))
    try requireFalse(monthly.contains(PopupRow(title: "Quota", value: "Unavailable")))
    let fallback = try rows([
      "quotaLookupFailed": true, "scope": ["monthlyPercentUsed": 42, "monthlyResetAt": reset],
    ])
    try require(fallback.contains(PopupRow(title: "Quota lookup", value: "Failed · last observed")))
    let unknown = try rows([
      "scope": ["percentUsed": 23, "windowSeconds": 14 * 86400, "resetAt": reset]
    ])
    try require(unknown.contains(PopupRow(title: "14d usage", value: "23%")))
    try requireFalse(unknown.contains { $0.title == "Weekly usage" || $0.title == "Session usage" })
  }
  func testLifecycleOrderingHoverAndRemoval() throws {
    let fake = FakeBar()
    try fake.ready()
    let controller = fake.controller()
    let a = accountFixture()
    let b = accountFixture("b", disabled: true)
    let usage = try snapshot([a, b])
    try controller.render(usage, now: testNow)
    for prefix in ["", "notch."] {
      let anchor = prefix + "ai_usage.providers"
      let first = prefix + "ai_usage.proxy." + String(repeating: "a", count: 64)
      let second = prefix + "ai_usage.proxy." + String(repeating: "b", count: 64)
      let order = prefix.isEmpty ? Array(fake.order.reversed()) : fake.order
      try requireEqual(
        order.filter { [anchor, first, second].contains($0) }, [anchor, first, second])
      try requireNotEqual(fake.items[first]?["label.color"], fake.items[second]?["label.color"])
      try requireEqual(fake.items[second]?["label"], "  47% (2d ↻2)")
      try controller.popup(name: first, sender: "mouse.entered")
      try requireEqual(fake.items[first]?["popup.drawing"], "on")
      try requireEqual(fake.items[second]?["popup.drawing"], "off")
      let count = fake.mutations.count
      let queries = fake.queries.count
      for event in ["routine", "forced", "mouse.clicked"] {
        try controller.popup(name: first, sender: event)
      }
      try requireEqual(fake.mutations.count, count)
      try requireEqual(
        fake.queries.count, queries, "Hover must not query, fetch, or resolve credentials")
      try controller.popup(name: first, sender: "mouse.exited")
      try requireEqual(fake.items[first]?["popup.drawing"], "off")
    }
    let second = "ai_usage.proxy." + String(repeating: "b", count: 64)
    try controller.popup(name: second, sender: "mouse.entered")
    let members = Set(fake.order)
    try controller.render(usage, now: testNow)
    try requireEqual(Set(fake.order), members)
    try requireEqual(fake.items[second]?["popup.drawing"], "on")
    let shorter = a.merging(["resetCredits": []]) { _, new in new }
    try controller.render(snapshot([shorter], direct: ""), now: testNow)
    try requireFalse(fake.order.contains { $0.contains(String(repeating: "b", count: 64)) })
    let first = "ai_usage.proxy." + String(repeating: "a", count: 64)
    try requireEqual(fake.items[first]?["icon.drawing"], "off")
    try controller.render(snapshot([], direct: ""), now: testNow)
    try requireFalse(fake.order.contains(where: accountOrRow))
    try requireEqual(fake.items["ai_usage.providers"]?["drawing"], "off")
    try requireEqual(fake.items["right_separator.ai"]?["drawing"], "off")
  }
  func testReusedRowsResetStyle() throws {
    let fake = FakeBar()
    try fake.ready()
    let controller = fake.controller()
    try controller.render(snapshot(), now: testNow)
    var account = accountFixture()
    account["quotaLookupFailed"] = true
    account["resetLookupFailed"] = true
    account["observedAt"] = testNow.timeIntervalSince1970 * 1000 - 120000
    try controller.render(snapshot([account]), now: testNow)
    try controller.render(snapshot(), now: testNow)
    let parent = "ai_usage.proxy." + String(repeating: "a", count: 64)
    for (index, row) in PopupFormatter(now: testNow).rows(try snapshot().proxyAccounts[0])
      .enumerated()
    {
      let properties = try unwrap(fake.items[parent + ".detail.\(index)"])
      try requireEqual(properties["icon"], row.title)
      try requireEqual(properties["label"], row.value)
      if row.kind == .detail {
        try requireEqual(properties["background.drawing"], "off")
        try requireEqual(properties["label.align"], "right")
        try requireEqual(
          Int(properties["icon.width"]!)! + Int(properties["label.width"]!)!,
          Int(properties["width"]!)!)
      }
    }
  }
  func testCopilotQuotaUnitsAndFreshness() throws {
    func rows(_ quota: [String: Any]? = nil, changes: [String: Any] = [:]) throws -> [PopupRow] {
      var fixture = copilotFixture().merging(changes) { _, new in new }
      if let quota { fixture["details"] = ["plan": "Business", "premium": quota] }
      return formatter.rows(try unwrap(snapshot([], copilot: fixture).copilot))
    }
    let fresh = try rows()
    try requireEqual(fresh.first?.title, "Copilot · Business")
    try require(fresh.contains(PopupRow(title: "Billing", value: "AI credits")))
    try require(
      fresh.contains(PopupRow(title: "Used / allowance", value: "250.75 / 1,000 AI credits")))
    try require(fresh.contains(PopupRow(title: "Remaining", value: "749.25 AI credits")))
    try require(fresh.contains(PopupRow(title: "Overage used", value: "0 AI credits")))
    try require(fresh.contains(PopupRow(title: "Paid overage", value: "Allowed")))
    try require(fresh.contains(PopupRow(title: "Resets", value: "Jan 31, 01:00 · 1h")))
    try require(fresh.contains { $0.kind == .note && $0.value.contains("not organization pool") })
    let requests = try rows([
      "unit": "requests", "used": 0, "allowance": 300, "remaining": 300, "percentUsed": 0,
      "overagePermitted": false,
    ])
    try require(requests.contains(PopupRow(title: "Used / allowance", value: "0 / 300 requests")))
    try require(requests.contains(PopupRow(title: "Usage", value: "0%")))
    try require(requests.contains(PopupRow(title: "Paid overage", value: "Not allowed")))
    try require(requests.contains(PopupRow(title: "Resets", value: "Not reported")))
    let unknown = try rows(["unit": "unknown"])
    for (title, value) in [
      ("Usage", "Unavailable"), ("Remaining", "Unavailable"), ("Billing", "Not reported"),
      ("Paid overage", "Not reported"),
    ] {
      try require(unknown.contains(PopupRow(title: title, value: value)))
    }
    let unlimited = try rows(["unit": "credits", "unlimited": true, "creditsUsed": 1234.5])
    try require(unlimited.contains(PopupRow(title: "Allowance", value: "Unlimited")))
    try require(unlimited.contains(PopupRow(title: "Credits used", value: "1,234.5 AI credits")))
    try requireFalse(unlimited.contains { $0.title == "Usage" || $0.title == "Remaining" })
    let stale = try rows(changes: [
      "state": "error", "stale": true,
      "fetchedAt": testNow.timeIntervalSince1970 * 1000 - 7 * 60000,
    ])
    try require(stale.contains(PopupRow(kind: .status, title: "Stale data")))
    try require(stale.contains(PopupRow(title: "Quota lookup", value: "Failed · last observed")))
    try require(stale.contains { $0.kind == .note && $0.value.contains("7m ago") })
    let expired = try rows([
      "unit": "credits", "used": 10, "remaining": 90,
      "resetAt": testNow.timeIntervalSince1970 * 1000 - 1,
    ])
    try require(expired.contains(PopupRow(title: "Quota", value: "Expired · awaiting refresh")))
    try requireFalse(expired.contains { $0.title == "Remaining" || $0.title == "Used / allowance" })
    let unavailable = try rows(changes: ["details": NSNull(), "state": "unknown"])
    try require(unavailable.contains(PopupRow(title: "Quota", value: "Unavailable")))
    try requireEqual(unavailable.first?.title, "Copilot")
  }
  func testCopilotLifecycleAndNotchLayout() throws {
    let fake = FakeBar()
    try fake.ready()
    var controller = fake.controller()
    let usage = try snapshot(copilot: copilotFixture())
    try controller.render(usage, now: testNow)
    for prefix in ["", "notch."] {
      let copilot = prefix + "ai_usage.copilot"
      let proxy = prefix + "ai_usage.proxy." + String(repeating: "a", count: 64)
      let anchor = prefix + "ai_usage.providers"
      let order = prefix.isEmpty ? Array(fake.order.reversed()) : fake.order
      try requireEqual(
        order.filter { [anchor, copilot, proxy].contains($0) }, [anchor, copilot, proxy])
      try requireEqual(fake.items[copilot]?["label"], " 25%")
      try controller.popup(name: copilot, sender: "mouse.entered")
      try requireEqual(fake.items[copilot]?["popup.drawing"], "on")
      try requireEqual(fake.items[proxy]?["popup.drawing"], "off")
      let queries = fake.queries.count
      try controller.popup(name: copilot, sender: "mouse.exited")
      try requireEqual(fake.queries.count, queries, "Copilot hover must remain cache-only")
      try controller.popup(name: copilot, sender: "mouse.entered")
    }
    let members = Set(fake.order)
    try controller.render(usage, now: testNow)
    try requireEqual(Set(fake.order), members)
    try requireEqual(fake.items["ai_usage.copilot"]?["popup.drawing"], "on")
    fake.displays = [display(1, native: 73, width: 1280), display(2, native: 99, width: 2560)]
    controller.notches = { [NotchedDisplay(id: 73, notchWidth: 185)] }
    try controller.layout()
    try requireEqual(fake.items["notch.ai_usage.copilot"]?["display"], "1")
    try requireEqual(fake.items["ai_usage.copilot"]?["display"], "2")
    try requireEqual(fake.items["notch.ai_usage.copilot"]?["popup.drawing"], "on")
    try controller.render(snapshot([], direct: "", copilot: copilotFixture()), now: testNow)
    try requireEqual(fake.items["ai_usage.copilot"]?["icon.drawing"], "off")
    try requireEqual(fake.items["notch.ai_usage.copilot"]?["padding_left"], "8")
    try requireEqual(fake.items["right_separator.ai"]?["drawing"], "on")
    controller.notches = { [] }
    try controller.layout()
    try requireEqual(fake.items["notch.ai_usage.copilot"]?["popup.drawing"], "off")
    try controller.render(snapshot([], direct: ""), now: testNow)
    try requireFalse(fake.order.contains(where: accountOrRow))
    try requireEqual(fake.items["right_separator.ai"]?["drawing"], "off")
  }
  static var allTests = [
    ("header and freshness", testHeaderAndFreshness),
    ("fallbacks and unknowns", testFallbacksAndUnknowns),
    ("balances and expirations", testBalancesAndExpirations),
    ("windows and validation", testScopeWindowsAndValidation),
    ("monthly and unclassified quota", testMonthlyAndUnclassifiedQuota),
    ("lifecycle and cached hover", testLifecycleOrderingHoverAndRemoval),
    ("reused row styling", testReusedRowsResetStyle),
    ("Copilot units and freshness", testCopilotQuotaUnitsAndFreshness),
    ("Copilot lifecycle and layout", testCopilotLifecycleAndNotchLayout),
  ]
}
