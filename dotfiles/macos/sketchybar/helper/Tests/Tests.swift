import Foundation

// Dependency-free native checks: throws (rather than trapping) let live tests
// restore the pointer/timers even on failure. No XCTest/Xcode installation.
struct CheckFailure: Error, CustomStringConvertible {
  let description: String
}
struct SkipCheck: Error { let reason: String }
func require(
  _ condition: Bool, _ message: String = "Requirement failed", file: String = #filePath,
  line: Int = #line
) throws {
  if !condition {
    throw CheckFailure(
      description: "\(URL(fileURLWithPath: file).lastPathComponent):\(line): \(message)")
  }
}
func requireFalse(
  _ condition: Bool, _ message: String = "Expected false", file: String = #filePath,
  line: Int = #line
) throws {
  try require(!condition, message, file: file, line: line)
}
func requireEqual<T: Equatable>(
  _ actual: T, _ expected: T, _ message: String = "Values differ", file: String = #filePath,
  line: Int = #line
) throws {
  try require(actual == expected, message, file: file, line: line)
}
func requireNotEqual<T: Equatable>(
  _ actual: T, _ expected: T, file: String = #filePath, line: Int = #line
) throws {
  try require(actual != expected, "Expected different values", file: file, line: line)
}
func requireNil<T>(
  _ value: T?, _ message: String = "Expected nil", file: String = #filePath, line: Int = #line
) throws {
  try require(value == nil, message, file: file, line: line)
}
func unwrap<T>(_ value: T?, file: String = #filePath, line: Int = #line) throws -> T {
  guard let value else {
    throw CheckFailure(description: "\(file):\(line): Missing required value")
  }
  return value
}
func requireThrows<T>(
  _ body: @autoclosure () throws -> T, file: String = #filePath, line: Int = #line
) throws {
  do { _ = try body() } catch { return }
  try require(false, "Expected an error", file: file, line: line)
}
func requireNoThrow<T>(_ body: @autoclosure () throws -> T) throws { _ = try body() }
func requireAtMost<T: Comparable>(
  _ actual: T, _ maximum: T, file: String = #filePath, line: Int = #line
) throws {
  try require(actual <= maximum, "Exceeds maximum", file: file, line: line)
}
func requireGreater<T: Comparable>(
  _ actual: T, _ minimum: T, file: String = #filePath, line: Int = #line
) throws {
  try require(actual > minimum, "Not greater than minimum", file: file, line: line)
}

func preservingState(_ body: () throws -> Void, cleanup: [() throws -> Void]) throws {
  var failure: Error?
  do { try body() } catch { failure = error }
  for restore in cleanup {
    do { try restore() } catch { failure = failure ?? error }
  }
  if let failure { throw failure }
}

@main
struct Tests {
  static func main() {
    var failures = 0
    func suite<T>(_ instance: T, _ tests: [(String, (T) -> () throws -> Void)]) {
      for (name, test) in tests {
        do {
          try test(instance)()
          print("PASS: \(name)")
        } catch let skip as SkipCheck { print("SKIP: \(name): \(skip.reason)") } catch {
          failures += 1
          print("FAIL: \(name): \(error)")
        }
      }
    }
    suite(UsageTests(), UsageTests.allTests)
    suite(LayoutTests(), LayoutTests.allTests)
    suite(ReaderTests(), ReaderTests.allTests)
    suite(NativeTests(), NativeTests.allTests)
    if failures > 0 { exit(1) }
  }
}
