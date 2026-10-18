import Foundation

@main
struct Entry {
  static func main() {
    let environment = ProcessInfo.processInfo.environment
    let mode = CommandLine.arguments.dropFirst().first ?? ""
    let reader = UsageReader(environment: environment)
    do {
      let controller = BarController(
        bar: try BarClient.live(environment: environment),
        configDirectory: environment["CONFIG_DIR"]
          ?? "\(environment["HOME"] ?? NSHomeDirectory())/.config/sketchybar",
        binary: URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path,
        palette: Palette(environment: environment)
      )
      switch mode {
      case "appearance": try controller.appearance()
      case "setup":
        try controller.createSections()
        try controller.createGuardPadding()
        try controller.installEvents()
        try controller.layout()
      case "events": try controller.installEvents()
      case "layout": try controller.layout()
      case "refresh": try controller.render(reader.read())
      case "popup":
        try controller.popup(name: environment["NAME"] ?? "", sender: environment["SENDER"] ?? "")
      case "guard": try controller.guardClick(name: environment["NAME"] ?? "")
      default:
        throw HelperError(
          "Usage: sketchybar-helper appearance|setup|events|layout|refresh|popup|guard")
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
