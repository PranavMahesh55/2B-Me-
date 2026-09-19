import Foundation

/// A deliberately tiny assertion harness. See Package.swift for why this is not
/// XCTest or swift-testing.
final class Harness {
    private(set) var failures: [String] = []
    private var checks = 0
    private var currentSuite = ""

    func suite(_ name: String) {
        currentSuite = name
        print("\n\(name)")
    }

    func expect(_ condition: Bool, _ message: @autoclosure () -> String) {
        checks += 1
        if condition {
            print("  ok   \(message())")
        } else {
            let text = "  FAIL \(message())"
            print(text)
            failures.append("[\(currentSuite)] \(message())")
        }
    }

    func fail(_ message: String) {
        checks += 1
        print("  FAIL \(message)")
        failures.append("[\(currentSuite)] \(message)")
    }

    func finish() -> Never {
        print("\n\(checks - failures.count)/\(checks) checks passed")
        if failures.isEmpty {
            print("PASS")
            exit(0)
        }
        print("\nFAILURES:")
        for failure in failures { print("  - \(failure)") }
        exit(1)
    }
}
