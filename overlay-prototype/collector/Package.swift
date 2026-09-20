// swift-tools-version: 6.0
import PackageDescription

// Deliberately its own package, sharing nothing with signer/. It reads input
// COUNTERS, never the signing key, and never any event content.
let package = Package(
    name: "InputCounter",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "input-counter", targets: ["InputCounter"])],
    targets: [
        .executableTarget(name: "InputCounter", swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
