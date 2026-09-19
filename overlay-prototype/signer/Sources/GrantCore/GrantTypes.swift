import Foundation

public enum Risk: String, Sendable, CaseIterable {
    case low, medium, high

    /// §3: exp = iat + TTL_BY_RISK[risk].
    public var ttlSeconds: Int64 {
        switch self {
        case .low: return 300
        case .medium: return 120
        case .high: return 60
        }
    }

    /// §3 says low: 5, but §7 step 5 burns the jti on first use and returns
    /// `replayed` on any reappearance, which makes anything above 1 unreachable.
    /// Single-use is the rule; the field stays for forward compatibility.
    public var maxCalls: Int64 { 1 }

    /// AutomationPlan.safety_level (1 = preview-only) is the prototype's
    /// equivalent of the spec's risk.
    public init(safetyLevel: Int) {
        switch safetyLevel {
        case ...1: self = .low
        case 2: self = .medium
        default: self = .high
        }
    }
}

/// Mirrors OPERATIONS in packages/grant/types.ts. §7 step 7 checks the pair.
public struct OperationSpec: Sendable {
    public let connector: String
    public let operation: String
    public let permission: String
    public let humanDescription: String
}

public enum Operations {
    public static let all: [OperationSpec] = [
        OperationSpec(connector: "desktop", operation: "open_application",
                      permission: "open_application", humanDescription: "Open an application"),
        OperationSpec(connector: "workflow", operation: "prepare_context",
                      permission: "read_active_window", humanDescription: "Prepare workflow context"),
        OperationSpec(connector: "mail", operation: "draft_response",
                      permission: "draft_email", humanDescription: "Draft a response for review"),
    ]

    public static func find(connector: String, operation: String) -> OperationSpec? {
        all.first { $0.connector == connector && $0.operation == operation }
    }

    public static func find(operation: String) -> OperationSpec? {
        all.first { $0.operation == operation }
    }
}

public struct Plan {
    public let connector: String
    public let operation: String
    public let resource: String
    /// Ordered pairs for the same reason CanonicalValue uses them: two params
    /// whose names differ only by Unicode normalization must stay distinct.
    public let params: [(key: String, value: CanonicalValue)]

    public init(connector: String, operation: String, resource: String,
                params: [(key: String, value: CanonicalValue)]) {
        self.connector = connector
        self.operation = operation
        self.resource = resource
        self.params = params
    }

    public var canonicalValue: CanonicalValue {
        .object([
            (key: "connector", value: .string(connector)),
            (key: "operation", value: .string(operation)),
            (key: "resource", value: .string(resource)),
            (key: "params", value: .object(params)),
        ])
    }
}

public struct GrantClaims {
    public let version: Int64
    public let issuer: String
    public let audience: String
    public let jti: String
    public let issuedAt: Int64
    public let expiresAt: Int64
    public let planHash: String
    public let connector: String
    public let operation: String
    public let resource: String
    public let paramHashes: [(key: String, value: String)]
    public let maxCalls: Int64
    public let presenceMethod: String
    public let presenceAt: Int64
    public let risk: Risk

    /// §3's claim set, in the shape the broker re-derives independently.
    public var canonicalValue: CanonicalValue {
        .object([
            (key: "v", value: .integer(version)),
            (key: "iss", value: .string(issuer)),
            (key: "aud", value: .string(audience)),
            (key: "jti", value: .string(jti)),
            (key: "iat", value: .integer(issuedAt)),
            (key: "exp", value: .integer(expiresAt)),
            (key: "plan_hash", value: .string(planHash)),
            (key: "scope", value: .object([
                (key: "connector", value: .string(connector)),
                (key: "operation", value: .string(operation)),
                (key: "resource", value: .string(resource)),
                (key: "param_hashes", value: .object(paramHashes.map { (key: $0.key, value: CanonicalValue.string($0.value)) })),
                (key: "max_calls", value: .integer(maxCalls)),
            ])),
            (key: "presence", value: .object([
                (key: "method", value: .string(presenceMethod)),
                (key: "at", value: .integer(presenceAt)),
            ])),
            (key: "risk", value: .string(risk.rawValue)),
        ])
    }
}
