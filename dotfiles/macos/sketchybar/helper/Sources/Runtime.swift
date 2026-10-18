import Darwin
import Foundation

struct HelperError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

struct ProcessResult {
  var status: Int32
  var output: Data
  var diagnostics: Data = Data()
}

// argv, not shell interpolation. Drain stdout while the process runs; stderr
// goes to a temporary file so neither pipe can deadlock the other.
func runProcess(_ executable: String, _ arguments: [String], environment: [String: String]) throws
  -> ProcessResult
{
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  process.environment = environment
  let output = Pipe()
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
    "sketchybar-\(UUID().uuidString)")
  guard
    FileManager.default.createFile(
      atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600])
  else {
    throw HelperError("Cannot create diagnostics file")
  }
  defer { try? FileManager.default.removeItem(at: temporary) }
  let diagnostics = try FileHandle(forWritingTo: temporary)
  defer { try? diagnostics.close() }
  process.standardOutput = output
  process.standardError = diagnostics
  try process.run()
  let data = output.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  return ProcessResult(
    status: process.terminationStatus, output: data, diagnostics: try Data(contentsOf: temporary))
}

func executable(_ name: String, environment: [String: String]) -> String? {
  if name.contains("/") { return FileManager.default.isExecutableFile(atPath: name) ? name : nil }
  return (environment["PATH"] ?? "/opt/homebrew/bin:/usr/bin:/bin").split(separator: ":")
    .map { "\($0)/\(name)" }.first { FileManager.default.isExecutableFile(atPath: $0) }
}

func shellQuote(_ value: String) -> String {
  "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

struct BarClient {
  var request: ([String]) throws -> Data
  func query<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    // Sketchybar's Mach client exits successfully with no output after a
    // 100ms reply timeout. A large setup/update batch can occupy the daemon
    // longer than that. Retry read-only empty replies, never mutations or
    // malformed nonempty JSON, and keep an unavailable bar bounded.
    for attempt in 0..<6 {
      let data = try request(["--query", name])
      if !data.isEmpty { return try decoder.decode(type, from: data) }
      if attempt < 5 { Thread.sleep(forTimeInterval: 0.05) }
    }
    throw HelperError("Sketchybar query timed out")
  }
  func apply(_ commands: Commands) throws {
    if !commands.args.isEmpty { _ = try request(commands.args) }
  }
  static func live(environment: [String: String]) throws -> BarClient {
    guard
      let path = executable(environment["SKETCHYBAR_BIN"] ?? "sketchybar", environment: environment)
    else {
      throw HelperError("Sketchybar is not installed")
    }
    return BarClient { args in
      let result = try runProcess(path, args, environment: environment)
      guard result.status == 0 else { throw HelperError("Sketchybar command failed") }
      return result.output
    }
  }
}

struct Commands {
  var args: [String] = []
  mutating func command(_ arguments: String...) { args += arguments }
  mutating func set(_ name: String, _ properties: [String]) {
    args += ["--set", name] + properties
  }
}

struct BarState: Decodable {
  var items: [String]
  var topmost: String?
  var paddingLeft: Int?
  var paddingRight: Int?
  var height: Int?
}
struct Display: Decodable {
  var arrangementId: Int
  var directDisplayID: UInt32
  var frame: Frame
  enum CodingKeys: String, CodingKey {
    case arrangementId = "arrangement-id"
    case directDisplayID = "DirectDisplayID"
    case frame
  }
  struct Frame: Decodable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
  }
}
struct ItemState: Decodable {
  struct Text: Decodable {
    var value: String?
    var drawing: String?
    var font: String?
    var width: Int?
    var paddingLeft: Int?
    var paddingRight: Int?
    var align: String?
  }
  struct Geometry: Decodable {
    var drawing: String?
    var position: String?
    var width: Int?
    var scrollTexts: String?
    var paddingLeft: Int?
    var paddingRight: Int?
  }
  struct Popup: Decodable {
    var drawing: String?
    var items: [String]?
  }
  struct Scripting: Decodable { var updates: String? }
  struct Rect: Decodable {
    var origin: [Double]
    var size: [Double]
  }
  var icon: Text?
  var label: Text?
  var geometry: Geometry?
  var popup: Popup?
  var scripting: Scripting?
  var boundingRects: [String: Rect]?
}

struct Palette {
  var accent: String
  var dimmed: String
  var background: String
  var border: String
  init(environment: [String: String]) {
    accent = environment["ACCENT_COLOR"] ?? "0xffffffff"
    dimmed = environment["DIMMED_COLOR"] ?? "0x88ffffff"
    background = environment["BAR_COLOR"] ?? "0xff101314"
    border = environment["INACTIVE_BORDER_COLOR"] ?? "0x44ffffff"
  }
}

// Serialize only writers of the bounded diagnostics log. Logging failures must
// never prevent rendering and never print provider output or credentials.
func appendDiagnostics(_ data: Data, path: String) {
  guard !data.isEmpty else { return }
  let url = URL(fileURLWithPath: path)
  do {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let fd = open(path + ".lock", O_CREAT | O_RDWR, 0o600)
    guard fd >= 0 else { return }
    defer { close(fd) }
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { return }
    defer { flock(fd, LOCK_UN) }
    var contents = (try? Data(contentsOf: url)) ?? Data()
    contents.append(data)
    if contents.count > 65536 { contents = Data(contents.suffix(32768)) }
    try contents.write(to: url, options: .atomic)
  } catch { /* Diagnostics are best-effort. */  }
}
