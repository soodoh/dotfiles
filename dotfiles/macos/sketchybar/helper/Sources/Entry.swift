import Foundation

@main
struct Entry {
  static func main() {
    let environment = ProcessInfo.processInfo.environment
    let mode = CommandLine.arguments.dropFirst().first ?? ""
    let reader = UsageReader(environment: environment)
    do {
      let configDirectory =
        environment["CONFIG_DIR"]
        ?? "\(environment["HOME"] ?? NSHomeDirectory())/.config/sketchybar"
      let binary = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
      let palette = Palette(environment: environment)
      let bar = try BarClient.live(environment: environment)
      let controller = BarController(
        bar: bar,
        configDirectory: configDirectory,
        binary: binary,
        palette: palette
      )
      func workspaceController() -> WorkspaceController {
        let cacheRoot =
          environment["XDG_CACHE_HOME"].flatMap { $0.isEmpty ? nil : $0 }
          ?? "\(environment["HOME"] ?? NSHomeDirectory())/.cache"
        return WorkspaceController(
          bar: bar,
          aerospace: AeroSpaceClient.live(environment: environment),
          configDirectory: configDirectory,
          binary: binary,
          palette: palette,
          stateDirectory: URL(fileURLWithPath: cacheRoot).appendingPathComponent("sketchybar"),
          xdgCacheHome: environment["XDG_CACHE_HOME"]
        )
      }
      switch mode {
      case "appearance": try controller.appearance()
      case "setup": try controller.setup()
      case "layout": try controller.layout()
      case "refresh": try controller.render(reader.read())
      case "popup":
        try controller.popup(name: environment["NAME"] ?? "", sender: environment["SENDER"] ?? "")
      case "guard": try controller.guardClick(name: environment["NAME"] ?? "")
      case "workspaces-setup": try workspaceController().setup()
      case "workspaces-refresh":
        let extra = Array(CommandLine.arguments.dropFirst(2))
        guard let generation = extra.first, !generation.isEmpty else {
          throw HelperError("Usage: sketchybar-helper workspaces-refresh <generation> <workspace...>")
        }
        try workspaceController().refresh(
          generation: generation,
          workspaces: Array(extra.dropFirst()),
          focusedWorkspace: environment["FOCUSED_WORKSPACE"],
          sender: environment["SENDER"] ?? ""
        )
      default:
        throw HelperError(
          "Usage: sketchybar-helper appearance|setup|layout|refresh|popup|guard|workspaces-setup|workspaces-refresh"
        )
      }
    } catch {
      // Decoding/process errors can include provider output. Report only
      // our own fixed messages; never raw JSON, argv, or environment.
      let detail: String
      switch error {
      case DecodingError.keyNotFound(let key, _): detail = "missing field \(key.stringValue)"
      case DecodingError.typeMismatch(_, let context), DecodingError.valueNotFound(_, let context),
        DecodingError.dataCorrupted(let context):
        detail = "invalid JSON at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
      default: detail = "\((error as NSError).domain) \((error as NSError).code)"
      }
      let message =
        (error as? HelperError)?.description ?? "Sketchybar helper \(mode) failed: \(detail)"
      if mode == "refresh" {
        appendDiagnostics(
          Data("\(ISO8601DateFormatter().string(from: Date())) \(message)\n".utf8),
          path: reader.diagnosticsPath)
      } else {
        FileHandle.standardError.write(Data((message + "\n").utf8))
        exit(1)
      }
    }
  }
}
