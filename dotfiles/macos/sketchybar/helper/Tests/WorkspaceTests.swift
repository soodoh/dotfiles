import Foundation

struct WorkspaceTests {
  static let allTests: [(String, (WorkspaceTests) -> () throws -> Void)] = [
    ("workspace setup batches items, brackets, focus, and subscriptions", testSetup),
    ("workspace refresh deduplicates, sorts, caps with overflow, and caches icons", testRefreshAndIcons),
    ("workspace refresh diffs per workspace and ignores window reorder", testDifferentialRefresh),
    ("workspace focus updates brackets without touching app slots", testFocusUpdates),
    ("aerospace outage does not clear cached workspace state", testOutageDoesNotClear),
    ("reload generation forces full workspace redraw", testGenerationReload),
    ("nativeAppIcon renders and caches a real macOS bundle PNG", testNativeAppIcon),
  ]

  private func makeWorkspaceController(
    bar: FakeBar,
    stateDir: URL,
    workspaces: [String] = ["3", "7", "8", "9"],
    focused: @escaping () -> String? = { "7" },
    windows: @escaping () -> [WorkspaceWindow]? = { [] },
    generation: @escaping () -> String = { "first-bar" },
    resolveIcon: @escaping (String, URL) -> String? = { _, _ in nil }
  ) -> WorkspaceController {
    WorkspaceController(
      bar: bar.client,
      aerospace: AeroSpaceClient(
        listWorkspaces: { workspaces },
        focusedWorkspace: focused,
        listWindows: windows
      ),
      configDirectory: "/fixture/bar",
      binary: "/fixture/helper",
      palette: Palette(environment: [:]),
      stateDirectory: stateDir,
      makeGeneration: generation,
      resolveBundleIcon: resolveIcon
    )
  }

  func testSetup() throws {
    try withTemporaryDirectory { root in
      let bar = FakeBar()
      let palette = Palette(environment: [:])
      let controller = makeWorkspaceController(bar: bar, stateDir: root)
      try controller.setup()

      try requireEqual(bar.mutations.count, 1, "Setup should batch into one sketchybar call")
      try require(bar.events.contains("aerospace_workspace_change"))
      try requireEqual(
        bar.items["space.7.group"]?["members"],
        "space.7 space.7.pad.left space.7.app.1 space.7.app.2 space.7.app.3 space.7.app.4 space.7.overflow space.7.pad.right"
      )
      try requireEqual(bar.items["space.7.group"]?["background.color"], palette.active)
      try requireEqual(bar.items["space.7.group"]?["background.border_color"], palette.accent)
      try requireEqual(bar.items["space.7.group"]?["background.border_width"], "2")
      try requireEqual(bar.items["space.8.group"]?["background.color"], palette.itemBackground)
      try requireEqual(bar.items["space.8.group"]?["background.border_color"], palette.border)
      try requireEqual(bar.items["space.8.group"]?["background.border_width"], "1")
      try requireEqual(bar.items["space.7"]?["click_script"], "aerospace workspace 7")
      let refreshScript = try unwrap(bar.items["space_separator"]?["script"])
      try require(refreshScript.contains("workspaces-refresh"), "Expected workspaces-refresh script")
      try require(refreshScript.contains("'first-bar'"), "Expected generation in refresh script")
      try requireEqual(
        bar.subscriptions["space_separator"],
        ["aerospace_workspace_change", "space_windows_change"]
      )
    }
  }

  func testRefreshAndIcons() throws {
    try withTemporaryDirectory { root in
      let bar = FakeBar()
      var currentWindows: [WorkspaceWindow]? = [
        WorkspaceWindow(workspace: "3", appName: "Messages", bundleID: "com.apple.MobileSMS"),
        WorkspaceWindow(workspace: "3", appName: "Ghostty", bundleID: "com.mitchellh.ghostty"),
        WorkspaceWindow(workspace: "3", appName: "Ghostty Helper", bundleID: "com.mitchellh.ghostty"),
        WorkspaceWindow(workspace: "3", appName: "Slack", bundleID: "com.tinyspeck.slackmacgap"),
        WorkspaceWindow(workspace: "3", appName: "Notes", bundleID: ""),
        WorkspaceWindow(workspace: "3", appName: "Calendar", bundleID: "com.apple.Calendar"),
        WorkspaceWindow(workspace: "1", appName: "Contacts", bundleID: "com.apple.AddressBook"),
        WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari"),
      ]
      let slackPNG = root.appendingPathComponent("app-icons/com.tinyspeck.slackmacgap.png").path
      let controller = makeWorkspaceController(
        bar: bar,
        stateDir: root,
        windows: { currentWindows },
        resolveIcon: { bundleID, _ in
          bundleID == "com.tinyspeck.slackmacgap" ? slackPNG : nil
        }
      )
      try controller.setup()
      bar.mutations = []

      try controller.refresh(
        generation: "first-bar", workspaces: ["3", "7", "8", "9"],
        focusedWorkspace: nil, sender: "forced"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.3"]?["width"], "0")
      try requireEqual(bar.items["space.3.app.1"]?["background.image"], "app.com.apple.Calendar")
      try requireEqual(bar.items["space.3.app.2"]?["background.image"], "app.com.mitchellh.ghostty")
      try requireEqual(bar.items["space.3.app.3"]?["background.image"], "app.com.apple.MobileSMS")
      try requireEqual(bar.items["space.3.app.4"]?["background.image"], "app.Notes")
      try requireEqual(bar.items["space.3.overflow"]?["drawing"], "on")
      try requireEqual(bar.items["space.3.overflow"]?["label"], "+1")
      try requireEqual(bar.items["space.7.app.1"]?["background.image"], "app.com.apple.Safari")
      try requireEqual(bar.items["space.8"]?["width"], "12")
      try requireEqual(bar.items["space.8.app.1"]?["drawing"], "off")
      try requireEqual(bar.items["space.8.overflow"]?["drawing"], "off")

      // When Slack enters a visible slot, the cached icon path is used and unchanged workspaces are untouched.
      currentWindows = [
        WorkspaceWindow(workspace: "7", appName: "Slack", bundleID: "com.tinyspeck.slackmacgap"),
        WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari"),
      ]
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["3", "7", "8", "9"],
        focusedWorkspace: nil, sender: "space_windows_change"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.7.app.2"]?["background.image"], slackPNG)
      let rawArgs = bar.mutations[0].joined(separator: " ")
      try requireFalse(rawArgs.contains("space.8."), "Unchanged workspace 8 should not be redrawn")
      try requireFalse(rawArgs.contains("space.9."), "Unchanged workspace 9 should not be redrawn")
    }
  }

  func testDifferentialRefresh() throws {
    try withTemporaryDirectory { root in
      let bar = FakeBar()
      var currentWindows: [WorkspaceWindow]? = [
        WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari"),
        WorkspaceWindow(workspace: "8", appName: "Notes", bundleID: "com.apple.Notes"),
      ]
      let controller = makeWorkspaceController(
        bar: bar, stateDir: root, workspaces: ["7", "8", "9"], windows: { currentWindows }
      )
      try controller.setup()
      bar.mutations = []

      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "space_windows_change"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.8.app.1"]?["background.image"], "app.com.apple.Notes")

      // Moving Notes from 8 -> 7 updates both 7 and 8 without touching 9.
      currentWindows = [
        WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari"),
        WorkspaceWindow(workspace: "7", appName: "Notes", bundleID: "com.apple.Notes"),
      ]
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "routine"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.7.app.1"]?["background.image"], "app.com.apple.Notes")
      try requireEqual(bar.items["space.8.app.1"]?["drawing"], "off")
      try requireFalse(bar.mutations[0].joined(separator: " ").contains("space.9."))

      // Reordering or duplicating windows emits zero mutations.
      currentWindows = [
        WorkspaceWindow(workspace: "7", appName: "Notes", bundleID: "com.apple.Notes"),
        WorkspaceWindow(workspace: "7", appName: "Notes", bundleID: "com.apple.Notes"),
        WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari"),
      ]
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "space_windows_change"
      )
      try requireEqual(bar.mutations.count, 0)
    }
  }

  func testFocusUpdates() throws {
    try withTemporaryDirectory { root in
      let bar = FakeBar()
      let palette = Palette(environment: [:])
      let windows = [WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari")]
      let controller = makeWorkspaceController(
        bar: bar, stateDir: root, workspaces: ["7", "8", "9"], windows: { windows }
      )
      try controller.setup()
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "forced"
      )
      bar.mutations = []

      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: "8", sender: "aerospace_workspace_change"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.8.group"]?["background.color"], palette.active)
      try requireEqual(bar.items["space.7.group"]?["background.color"], palette.itemBackground)
      try requireFalse(bar.mutations[0].joined(separator: " ").contains(".app."))

      // Repeating same focus with unchanged apps emits zero mutations.
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: "8", sender: "aerospace_workspace_change"
      )
      try requireEqual(bar.mutations.count, 0)
    }
  }

  func testOutageDoesNotClear() throws {
    try withTemporaryDirectory { root in
      let bar = FakeBar()
      var currentWindows: [WorkspaceWindow]? = [
        WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari")
      ]
      let controller = makeWorkspaceController(
        bar: bar, stateDir: root, workspaces: ["7", "8", "9"], windows: { currentWindows }
      )
      try controller.setup()
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "forced"
      )

      // Outage (nil) emits zero mutations and preserves cached state.
      currentWindows = nil
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "routine"
      )
      try requireEqual(bar.mutations.count, 0)

      // Recovery to same windows also emits zero mutations.
      currentWindows = [WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari")]
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "routine"
      )
      try requireEqual(bar.mutations.count, 0)

      // Genuine empty snapshot clears app slots.
      currentWindows = []
      bar.mutations = []
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "routine"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.7.app.1"]?["drawing"], "off")
    }
  }

  func testGenerationReload() throws {
    try withTemporaryDirectory { root in
      let bar = FakeBar()
      let windows = [WorkspaceWindow(workspace: "7", appName: "Safari", bundleID: "com.apple.Safari")]
      let controller = makeWorkspaceController(
        bar: bar, stateDir: root, workspaces: ["7", "8", "9"], windows: { windows }
      )
      try controller.setup()
      try controller.refresh(
        generation: "first-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "routine"
      )
      bar.mutations = []

      // New bar generation forces redraw even when windows are identical.
      try controller.refresh(
        generation: "second-bar", workspaces: ["7", "8", "9"],
        focusedWorkspace: nil, sender: "forced"
      )
      try requireEqual(bar.mutations.count, 1)
      try requireEqual(bar.items["space.7.app.1"]?["background.image"], "app.com.apple.Safari")
    }
  }

  func testNativeAppIcon() throws {
    try withTemporaryDirectory { root in
      let cacheDir = root.appendingPathComponent("app-icons")
      let first = try unwrap(nativeAppIcon(bundleID: "com.apple.finder", cacheDirectory: cacheDir))
      let data = try Data(contentsOf: URL(fileURLWithPath: first))
      try requireGreater(data.count, 8)
      try requireEqual(Array(data.prefix(4)), [0x89, 0x50, 0x4E, 0x47], "Expected PNG signature")

      let second = try unwrap(nativeAppIcon(bundleID: "com.apple.finder", cacheDirectory: cacheDir))
      try requireEqual(first, second)
      try requireNil(nativeAppIcon(bundleID: "com.example.nonexistent.bundle.id", cacheDirectory: cacheDir))
    }
  }
}
