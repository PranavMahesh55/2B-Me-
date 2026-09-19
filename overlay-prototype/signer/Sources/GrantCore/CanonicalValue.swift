import Foundation

/// The value model for the restricted JCS subset in techspecsigner.md §4.
///
/// Objects are ordered `(key, value)` PAIRS, deliberately not a `Dictionary`.
/// Swift's `String` equality is canonical-equivalence based, so "\u{00E9}" and
/// "e\u{0301}" compare equal and a dictionary would silently merge them into one
/// key. JavaScript treats them as two distinct keys. A merge shortens the
/// canonical string, which breaks the signature and presents as a crypto bug --
/// exactly the failure §4 warns about, one layer deeper than the sort order.
/// The `non_ascii_key` vector covers it.
public indirect enum CanonicalValue {
    case object([(key: String, value: CanonicalValue)])
    case array([CanonicalValue])
    case string(String)
    case integer(Int64)
    case boolean(Bool)
    case null
}

public enum CanonicalErrorReason: String, Sendable {
    case null
    case float
    case nan
    case infinity
    case unsafeInteger = "unsafe_integer"
    case loneSurrogate = "lone_surrogate"
    case unsupported
    case duplicateKey = "duplicate_key"
    case depthExceeded = "depth_exceeded"
    case malformedJSON = "malformed_json"
}

public struct CanonicalError: Error, CustomStringConvertible {
    public let reason: CanonicalErrorReason
    public let path: String
    public let detail: String

    public init(_ reason: CanonicalErrorReason, path: String, detail: String) {
        self.reason = reason
        self.path = path
        self.detail = detail
    }

    public var description: String {
        "canonicalize: \(detail) at \(path.isEmpty ? "<root>" : path)"
    }
}

/// JavaScript cannot represent integers beyond 2^53-1 exactly, so the TypeScript
/// canonicalizer throws above this bound. Int64 could hold them, which is
/// precisely why Swift has to enforce JavaScript's limit rather than its own.
public let canonicalMaxSafeInteger: Int64 = 9_007_199_254_740_991
public let canonicalMaxDepth = 128
