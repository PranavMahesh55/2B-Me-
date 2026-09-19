import Foundation

/// The signer-reachable codes from §2, plus `malformed_request`, which §2 omits
/// and §10 requires: an unparseable body or a non-canonicalizable param has no
/// enumerated code otherwise, and §10 forbids answering with a 500.
public enum SignerErrorCode: String, Sendable {
    case presenceCancelled = "presence_cancelled"
    case presenceFailed = "presence_failed"
    case keyMissing = "key_missing"
    case biometryChanged = "biometry_changed"
    case unknownOperation = "unknown_operation"
    case malformedRequest = "malformed_request"
}

public struct SignerError: Error, CustomStringConvertible {
    public let code: SignerErrorCode
    public let message: String

    public init(_ code: SignerErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }

    public var description: String { "\(code.rawValue): \(message)" }
}
