// swift-tools-version: 6.0
import PackageDescription

// Command Line Tools ship neither a usable XCTest nor a SwiftPM-hostable
// swift-testing, so the checks are an executable target rather than a test
// target. It is pointed at the path §4 and §6 name. This also matters later:
// the Secure Enclave suite needs a codesigned binary, and a .xctest bundle
// built by SwiftPM is never signed with entitlements.
let package = Package(
    name: "GrantSigner",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "GrantCore", targets: ["GrantCore"]),
        .executable(name: "grant-check", targets: ["GrantCheck"]),
        .executable(name: "grant-signer", targets: ["GrantSigner"]),
    ],
    targets: [
        // Swift 5 language mode on purpose: Swift 6 strict concurrency generates a
        // wall of Sendable errors around SecKey (a CF type), LAContext and
        // NWListener callbacks. That state is confined to one serial queue here,
        // so the errors would be noise, not bugs.
        .target(name: "GrantCore", swiftSettings: [.swiftLanguageMode(.v5)]),
        .executableTarget(
            name: "GrantSigner",
            dependencies: ["GrantCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "GrantCheck",
            dependencies: ["GrantCore"],
            path: "Tests/GrantCoreTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
