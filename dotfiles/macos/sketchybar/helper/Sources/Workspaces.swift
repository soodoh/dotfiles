import Darwin
import Foundation

struct WorkspaceWindow: Equatable {
  var workspace: String
  var appName: String
  var bundleID: String
}

struct AeroSpaceClient {
  var listWorkspaces: () throws -> [String]
  var focusedWorkspace: () -> String?
  var listWindows: () -> [WorkspaceWindow]?

  static func live(environment: [String: String]) -> AeroSpaceClient {
    func run(_ args: [String]) -> String? {
      guard let path = executable("aerospace", environment: environment) else { return nil }
      guard let result = try? runProcess(path, args, environment: environment), result.status == 0
      else { return nil }
      return String(data: result.output, encoding: .utf8)
    }
    return AeroSpaceClient(
      listWorkspaces: {
        guard let output = run(["list-workspaces", "--all"]) else {
          throw HelperError("AeroSpace list-workspaces failed")
        }
        return output.split(whereSeparator: \.isNewline).map(String.init).filter { !$0.isEmpty }
      },
      focusedWorkspace: {
        guard let output = run(["list-workspaces", "--focused"]) else { return nil }
        let value = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
      },
      listWindows: {
        guard
          let output = run([
            "list-windows", "--all", "--format", "%{workspace}|%{app-name}|%{app-bundle-id}",
          ])
        else { return nil }
        return WorkspaceController.parseWindows(output)
      }
    )
  }
}

struct WorkspaceController {
  static let maxVisibleApps = 4
  static let genericAppIcon =
    "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns"
  static let groupGap = 8
  static let groupPaddingX = 8
  static let emptyGroupWidth = 12
  static let iconPaddingX = 1
  static let iconScale = "0.65"
  static let iconPixelSize = 32

  var bar: BarClient
  var aerospace: AeroSpaceClient
  var configDirectory: String
  var binary: String
  var palette: Palette
  var stateDirectory: URL
  var xdgCacheHome: String? = nil
  var makeGeneration: () -> String = { UUID().uuidString }
  var resolveBundleIcon: (String, URL) -> String? = { bundleID, cacheDir in
    nativeAppIcon(bundleID: bundleID, cacheDirectory: cacheDir, pixelSize: iconPixelSize)
  }

  private var appIconCacheDirectory: URL { stateDirectory.appendingPathComponent("app-icons") }
  private var appsStateFile: URL { stateDirectory.appendingPathComponent("workspace-apps") }
  private var focusStateFile: URL { stateDirectory.appendingPathComponent("workspace-focus") }
  private var lockFile: URL { stateDirectory.appendingPathComponent("workspace-apps.lock") }

  static func parseWindows(_ raw: String) -> [WorkspaceWindow] {
    var parsed: [WorkspaceWindow] = []
    for rawLine in raw.split(whereSeparator: \.isNewline) {
      let line = String(rawLine)
      let parts = line.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false)
      guard parts.count >= 2 else { continue }
      let workspace = String(parts[0])
      guard !workspace.isEmpty else { continue }
      let appName = String(parts[1]).trimmingCharacters(in: .whitespaces)
      let bundleID = parts.count >= 3 ? String(parts[2]).trimmingCharacters(in: .whitespaces) : ""
      parsed.append(WorkspaceWindow(workspace: workspace, appName: appName, bundleID: bundleID))
    }
    return parsed
  }

  static func snapshotLines(from windows: [WorkspaceWindow]) -> [String] {
    let sorted = windows.sorted { lhs, rhs in
      if lhs.workspace != rhs.workspace {
        return lhs.workspace.utf8.lexicographicallyPrecedes(rhs.workspace.utf8)
      }
      if lhs.appName != rhs.appName {
        return lhs.appName.utf8.lexicographicallyPrecedes(rhs.appName.utf8)
      }
      return lhs.bundleID.utf8.lexicographicallyPrecedes(rhs.bundleID.utf8)
    }
    var seen = Set<String>()
    var lines: [String] = []
    for window in sorted where !window.workspace.isEmpty {
      let appName = window.appName.trimmingCharacters(in: .whitespaces)
      let bundleID = window.bundleID.trimmingCharacters(in: .whitespaces)
      let identity = bundleID.isEmpty ? appName : bundleID
      guard !identity.isEmpty else { continue }
      if seen.insert("\(window.workspace)\0\(identity)").inserted {
        lines.append("\(window.workspace)|\(appName)|\(bundleID)")
      }
    }
    return lines
  }

  private static func appsByWorkspace(from snapshotLines: [String]) -> [String: [(String, String)]] {
    var result: [String: [(String, String)]] = [:]
    for line in snapshotLines {
      let parts = line.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false)
      guard parts.count >= 2 else { continue }
      let workspace = String(parts[0])
      let appName = String(parts[1])
      let bundleID = parts.count >= 3 ? String(parts[2]) : ""
      result[workspace, default: []].append((appName, bundleID))
    }
    return result
  }

  private func resolveAppImage(appName: String, bundleID: String) -> String {
    if !bundleID.isEmpty {
      if let cached = resolveBundleIcon(bundleID, appIconCacheDirectory) {
        return cached
      }
      return "app.\(bundleID)"
    }
    if !appName.isEmpty { return "app.\(appName)" }
    return Self.genericAppIcon
  }

  private func refreshScript(generation: String, workspaces: [String]) -> String {
    var parts = [
      "/usr/bin/env",
      "CONFIG_DIR=\(configDirectory)",
      "ACCENT_COLOR=\(palette.accent)",
      "DIMMED_COLOR=\(palette.dimmed)",
      "BAR_COLOR=\(palette.background)",
      "INACTIVE_BORDER_COLOR=\(palette.border)",
      "ACTIVE_COLOR=\(palette.active)",
      "ITEM_BG_COLOR=\(palette.itemBackground)",
    ]
    if let xdgCacheHome, !xdgCacheHome.isEmpty {
      parts.append("XDG_CACHE_HOME=\(xdgCacheHome)")
    }
    parts += [binary, "workspaces-refresh", generation] + workspaces
    return parts.map(shellQuote).joined(separator: " ")
  }

  private func appendFocusArgs(
    _ commands: inout Commands, workspaceID: String, focusedWorkspace: String?
  ) {
    if let focusedWorkspace, !focusedWorkspace.isEmpty, workspaceID == focusedWorkspace {
      commands.set(
        "space.\(workspaceID).group",
        [
          "background.color=\(palette.active)",
          "background.border_color=\(palette.accent)",
          "background.border_width=2",
        ]
      )
    } else {
      commands.set(
        "space.\(workspaceID).group",
        [
          "background.color=\(palette.itemBackground)",
          "background.border_color=\(palette.border)",
          "background.border_width=1",
        ]
      )
    }
  }

  private func appendRenderArgs(
    _ commands: inout Commands, workspaceID: String, apps: [(String, String)]
  ) {
    if apps.isEmpty {
      commands.set("space.\(workspaceID).group", ["drawing=on"])
      commands.set(
        "space.\(workspaceID)",
        ["drawing=on", "label.drawing=off", "label=", "width=\(Self.emptyGroupWidth)"]
      )
      for slot in 1...Self.maxVisibleApps {
        commands.set("space.\(workspaceID).app.\(slot)", ["drawing=off"])
      }
      commands.set("space.\(workspaceID).overflow", ["drawing=off", "label="])
      return
    }

    commands.set("space.\(workspaceID).group", ["drawing=on"])
    commands.set(
      "space.\(workspaceID)",
      ["drawing=on", "label.drawing=off", "label=", "width=0"]
    )
    for (index, app) in apps.prefix(Self.maxVisibleApps).enumerated() {
      let slot = index + 1
      let image = resolveAppImage(appName: app.0, bundleID: app.1)
      commands.set(
        "space.\(workspaceID).app.\(slot)",
        ["drawing=on", "background.image=\(image)"]
      )
    }
    if apps.count < Self.maxVisibleApps {
      for slot in (apps.count + 1)...Self.maxVisibleApps {
        commands.set("space.\(workspaceID).app.\(slot)", ["drawing=off"])
      }
    }
    if apps.count > Self.maxVisibleApps {
      let overflow = apps.count - Self.maxVisibleApps
      commands.set("space.\(workspaceID).overflow", ["drawing=on", "label=+\(overflow)"])
    } else {
      commands.set("space.\(workspaceID).overflow", ["drawing=off", "label="])
    }
  }

  func setup() throws {
    let focusedWorkspace = aerospace.focusedWorkspace()
    let workspaces = try aerospace.listWorkspaces()
    let generation = makeGeneration()
    let refreshCommand = refreshScript(generation: generation, workspaces: workspaces)

    var c = Commands()
    c.command("--add", "event", "aerospace_workspace_change")

    for sid in workspaces {
      let anchor = "space.\(sid)"
      let clickScript = "aerospace workspace \(sid)"

      c.command("--add", "item", anchor, "left")
      c.set(
        anchor,
        [
          "padding_left=0", "padding_right=0", "drawing=on",
          "background.drawing=off", "icon.drawing=off", "label.drawing=off",
          "label=", "width=\(Self.emptyGroupWidth)", "click_script=\(clickScript)",
        ]
      )

      c.command("--add", "item", "\(anchor).pad.left", "left")
      c.set(
        "\(anchor).pad.left",
        [
          "padding_left=0", "padding_right=0", "width=\(Self.groupPaddingX)",
          "drawing=on", "icon.drawing=off", "label.drawing=off", "background.drawing=off",
          "click_script=\(clickScript)",
        ]
      )

      for slot in 1...Self.maxVisibleApps {
        c.command("--add", "item", "\(anchor).app.\(slot)", "left")
        c.set(
          "\(anchor).app.\(slot)",
          [
            "padding_left=0", "padding_right=0", "drawing=off",
            "icon.drawing=off", "label.drawing=off", "background.drawing=on",
            "background.color=0x00000000", "background.image.drawing=on",
            "background.image.scale=\(Self.iconScale)",
            "background.image.padding_left=\(Self.iconPaddingX)",
            "background.image.padding_right=\(Self.iconPaddingX)",
            "click_script=\(clickScript)",
          ]
        )
      }

      c.command("--add", "item", "\(anchor).overflow", "left")
      c.set(
        "\(anchor).overflow",
        [
          "padding_left=0", "padding_right=0", "drawing=off",
          "icon.drawing=off", "label.drawing=on", "background.drawing=off",
          "label.padding_left=2", "label.padding_right=6", "click_script=\(clickScript)",
        ]
      )

      c.command("--add", "item", "\(anchor).pad.right", "left")
      c.set(
        "\(anchor).pad.right",
        [
          "padding_left=0", "padding_right=0", "width=\(Self.groupPaddingX)",
          "drawing=on", "icon.drawing=off", "label.drawing=off", "background.drawing=off",
          "click_script=\(clickScript)",
        ]
      )

      c.command("--add", "item", "\(anchor).gap", "left")
      c.set(
        "\(anchor).gap",
        [
          "padding_left=0", "padding_right=0", "drawing=on",
          "width=\(Self.groupGap)", "icon=", "label=",
          "icon.drawing=off", "label.drawing=off", "background.drawing=off",
        ]
      )

      c.add([
        "--add", "bracket", "\(anchor).group",
        anchor, "\(anchor).pad.left",
        "\(anchor).app.1", "\(anchor).app.2", "\(anchor).app.3", "\(anchor).app.4",
        "\(anchor).overflow", "\(anchor).pad.right",
      ])
      c.set(
        "\(anchor).group",
        ["background.corner_radius=5", "background.drawing=on", "background.height=26"]
      )

      appendFocusArgs(&c, workspaceID: sid, focusedWorkspace: focusedWorkspace)
    }

    // Native window events are hints; the timer catches missed events and moves.
    c.command("--add", "item", "space_separator", "left")
    c.set(
      "space_separator",
      [
        "icon=", "icon.padding_left=4", "label.drawing=off", "background.drawing=off",
        "updates=on", "update_freq=3", "script=\(refreshCommand)",
      ]
    )
    c.command("--subscribe", "space_separator", "aerospace_workspace_change", "space_windows_change")

    try bar.apply(c)

    try FileManager.default.createDirectory(
      at: stateDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if let focusedWorkspace, !focusedWorkspace.isEmpty {
      try Data("\(generation)|\(focusedWorkspace)\n".utf8).write(
        to: focusStateFile, options: .atomic)
    } else {
      try? FileManager.default.removeItem(at: focusStateFile)
    }
  }

  func refresh(
    generation: String,
    workspaces: [String],
    focusedWorkspace initialFocus: String?,
    sender: String
  ) throws {
    try FileManager.default.createDirectory(
      at: stateDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

    // Events and timer ticks can overlap. Let the next tick catch up rather than
    // allowing two renders (and their cached snapshots) to race.
    let fd = open(lockFile.path, O_CREAT | O_RDWR, 0o600)
    guard fd >= 0 else { throw HelperError("Cannot open workspace lock file") }
    defer { close(fd) }
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { return }
    defer { flock(fd, LOCK_UN) }

    var focusedWorkspace = initialFocus?.isEmpty == false ? initialFocus : nil
    if focusedWorkspace == nil && sender == "aerospace_workspace_change" {
      focusedWorkspace = aerospace.focusedWorkspace()
    }

    var commands = Commands()
    var focusChanged = false
    var focusState = ""

    if let focusedWorkspace {
      focusState = "\(generation)|\(focusedWorkspace)"
      let previousFocus = (try? String(contentsOf: focusStateFile, encoding: .utf8))?
        .trimmingCharacters(in: .newlines)
      if previousFocus != focusState {
        focusChanged = true
        for sid in workspaces {
          appendFocusArgs(&commands, workspaceID: sid, focusedWorkspace: focusedWorkspace)
        }
      }
    }

    var appsChanged = false
    var currentAppsContent = ""

    // A failed query is not the same as a successful snapshot with no windows.
    if let windows = aerospace.listWindows() {
      let snapshot = Self.snapshotLines(from: windows)
      currentAppsContent = snapshot.isEmpty ? generation : ([generation] + snapshot).joined(separator: "\n")

      let previousRaw = (try? String(contentsOf: appsStateFile, encoding: .utf8))?
        .trimmingCharacters(in: .newlines)
      if previousRaw != currentAppsContent {
        appsChanged = true
        let previousLines = previousRaw?.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) ?? []
        let previousGeneration = previousLines.first
        let previousByWorkspace =
          previousGeneration == generation
          ? Self.appsByWorkspace(from: Array(previousLines.dropFirst()))
          : [:]
        let currentByWorkspace = Self.appsByWorkspace(from: snapshot)

        // Invalidate before drawing so an interrupted or partial render is repaired
        // on the next tick, even if the window set has since returned to its old state.
        try? FileManager.default.removeItem(at: appsStateFile)

        for sid in workspaces {
          let currentApps = currentByWorkspace[sid] ?? []
          if previousGeneration == generation {
            let previousApps = previousByWorkspace[sid] ?? []
            if previousApps.count == currentApps.count
              && zip(previousApps, currentApps).allSatisfy({ $0.0 == $1.0 && $0.1 == $1.1 })
            {
              continue
            }
          }
          appendRenderArgs(&commands, workspaceID: sid, apps: currentApps)
        }
      }
    }

    try bar.apply(commands)

    if focusChanged {
      try Data("\(focusState)\n".utf8).write(to: focusStateFile, options: .atomic)
    }
    if appsChanged {
      try Data("\(currentAppsContent)\n".utf8).write(to: appsStateFile, options: .atomic)
    }
  }
}
