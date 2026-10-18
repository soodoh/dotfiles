import Foundation

final class ReaderTests {
  func testNativeMiseExecutionAndBunDiscovery() throws {
    let fixture = try jsonData(["directText": "LLMHub $12.00", "proxyAccounts": []])
    for configHome in ["/fixture/home/.config", "/fixture/work-config"] {
      var calls: [(String, [String], [String: String])] = []
      let env = [
        "HOME": "/fixture/home", "PATH": "/usr/bin:/bin", "XDG_CONFIG_HOME": configHome,
        "PI_EXTENSIONS_DIR": "/fixture/checkout/pi-extensions", "AI_USAGE_LOG_PATH": "/dev/null",
      ]
      var reader = UsageReader(environment: env)
      reader.isExecutable = { $0 == "/fixture/home/.local/bin/mise" || $0 == "/fixture/bun" }
      reader.exists = {
        $0.hasSuffix("provider-usage-cli.ts") || $0 == configHome + "/mise/miserc.toml"
      }
      reader.run = { exe, args, environment in
        calls.append((exe, args, environment))
        if args.contains("which") {
          return ProcessResult(status: 0, output: Data("/fixture/bun\n".utf8))
        }
        return ProcessResult(status: 0, output: fixture)
      }
      try requireEqual(try reader.read().directText, "LLMHub $12.00")
      try requireEqual(calls.count, 2)
      try requireEqual(calls[0].1, ["-C", "/fixture/checkout", "which", "bun"])
      try requireEqual(
        calls[1].1,
        [
          "-C", "/fixture/checkout", "exec", "--", "/fixture/bun",
          "/fixture/checkout/pi-extensions/packages/statusline/src/provider-usage-cli.ts",
        ])
      try requireEqual(calls[1].2["MISE_EXEC_AUTO_INSTALL"], "false")
      try requireNil(calls[1].2["MISE_ENV"], "Native explicit profile selection belongs to mise")
      try requireNil(
        calls[1].2["CLIPROXYAPI_MANAGEMENT_KEY"], "Only mise's child resolves credentials")
    }
  }
  func testStandaloneAndFailureDoNotEraseBar() throws {
    let fake = FakeBar()
    try fake.ready()
    let controller = fake.controller()
    var reader = UsageReader(environment: [
      "HOME": "/fixture", "BUN_BIN": "/fixture/bun", "PROVIDER_USAGE_CLI": "/fixture/usage.ts",
      "AI_USAGE_LOG_PATH": "/dev/null",
    ])
    reader.exists = { $0 == "/fixture/usage.ts" }
    reader.isExecutable = { $0 == "/fixture/bun" }
    reader.run = { exe, args, _ in
      try requireEqual(exe, "/fixture/bun")
      try requireEqual(args, ["/fixture/usage.ts"])
      return ProcessResult(
        status: 0, output: try jsonData(["directText": "Standalone 42%", "proxyAccounts": []]))
    }
    try controller.render(reader.read())
    try requireEqual(fake.items["ai_usage.providers"]?["label"], "Standalone 42%")
    let count = fake.mutations.count
    for result in [
      ProcessResult(status: 1, output: Data()),
      ProcessResult(status: 0, output: Data("invalid".utf8)),
    ] {
      reader.run = { _, _, _ in result }
      try requireThrows(try controller.render(reader.read()))
      try requireEqual(fake.mutations.count, count)
    }
  }
  func testProcessArgumentsAndDiagnostics() throws {
    let secretLikeText = "a 'quote' $(not-executed)\nnext line"
    let result = try runProcess("/usr/bin/printf", ["%s", secretLikeText], environment: [:])
    try requireEqual(result.status, 0)
    try requireEqual(String(decoding: result.output, as: UTF8.self), secretLikeText)
    // Both streams exceed pipe capacity: this used to be a possible deadlock
    // when a child filled stderr while its parent only drained stdout.
    let streams = try runProcess(
      "/bin/sh", ["-c", "head -c 131072 /dev/zero >&2; head -c 131072 /dev/zero"],
      environment: ["PATH": "/usr/bin:/bin"])
    try requireEqual(streams.output.count, 131072)
    try requireEqual(streams.diagnostics.count, 131072)
    try withTemporaryDirectory { root in
      let path = root.appendingPathComponent("usage.log").path
      appendDiagnostics(Data(repeating: 65, count: 70000), path: path)
      try requireAtMost(try Data(contentsOf: URL(fileURLWithPath: path)).count, 65536)
      appendDiagnostics(Data("latest\n".utf8), path: path)
      try require(try String(contentsOfFile: path, encoding: .utf8).hasSuffix("latest\n"))
    }
  }
  func testScriptQuotingAndCachedHover() throws {
    let fake = FakeBar()
    try fake.ready()
    var controller = fake.controller()
    controller.binary = "/tmp/it's a helper"
    let encoded = shellQuote(controller.binary)
    let result = try runProcess("/bin/sh", ["-c", "printf '%s' " + encoded], environment: [:])
    try requireEqual(String(decoding: result.output, as: UTF8.self), controller.binary)
    let queries = fake.queries.count
    try controller.popup(name: "notch.stats", sender: "mouse.entered")
    try requireEqual(fake.queries.count, queries)
    try requireEqual(fake.items["notch.stats"]?["popup.drawing"], "on")
    let count = fake.mutations.count
    try controller.popup(name: "--remove", sender: "mouse.entered")
    try controller.guardClick(name: "--remove")
    try requireEqual(fake.mutations.count, count)
  }
  func testEmptyNativeRepliesRetryButMalformedRepliesDoNot() throws {
    var calls = 0
    let delayed = BarClient { args in
      try requireEqual(args, ["--query", "bar"])
      calls += 1
      return calls < 3 ? Data() : try jsonData(["items": []])
    }
    let state: BarState = try delayed.query("bar")
    try require(state.items.isEmpty)
    try requireEqual(calls, 3)
    calls = 0
    let malformed = BarClient { _ in
      calls += 1
      return Data("invalid".utf8)
    }
    try requireThrows(try malformed.query("bar", as: BarState.self))
    try requireEqual(calls, 1)
    calls = 0
    let unavailable = BarClient { _ in
      calls += 1
      return Data()
    }
    try requireThrows(try unavailable.query("bar", as: BarState.self))
    try require(calls > 1 && calls < 20, "Unavailable bar must have bounded read retries")
  }
  func testLiveCleanupSurvivesFailures() throws {
    for failBody in [false, true] {
      for failRestore in [false, true] {
        var restored: [String] = []
        let operation = {
          try preservingState(
            { if failBody { throw HelperError("Injected body failure") } },
            cleanup: [
              {
                restored.append("provider")
                if failRestore { throw HelperError("Injected restore failure") }
              },
              { restored.append("timer") }, { restored.append("pointer") },
            ])
        }
        if failBody || failRestore { try requireThrows(try operation()) } else { try operation() }
        try requireEqual(restored, ["provider", "timer", "pointer"])
      }
    }
  }
  static var allTests = [
    ("mise and Bun discovery", testNativeMiseExecutionAndBunDiscovery),
    ("standalone and failure preservation", testStandaloneAndFailureDoNotEraseBar),
    ("argv and bounded diagnostics", testProcessArgumentsAndDiagnostics),
    ("script quoting and cached hover", testScriptQuotingAndCachedHover),
    ("native query timeouts", testEmptyNativeRepliesRetryButMalformedRepliesDoNot),
    ("live cleanup after failure", testLiveCleanupSurvivesFailures),
  ]
}
