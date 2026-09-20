import Foundation
import LocalAuthentication

/// The `/grant` request body from §2.
public struct GrantRequest {
    public let plan: Plan
    public let risk: Risk

    /// §2's example is not valid JSON (`"thread_ts": "1726...": }` has a stray
    /// colon), so this parses the shape the field names describe.
    public static func parse(_ body: Data) throws -> GrantRequest {
        let text = String(decoding: body, as: UTF8.self)
        let root: CanonicalValue
        do {
            root = try CanonicalJSON.parse(text)
        } catch {
            throw SignerError(.malformedRequest, "body is not the accepted JSON subset: \(error)")
        }
        guard case .object(let top) = root else {
            throw SignerError(.malformedRequest, "body is not an object")
        }

        func field(_ name: String, in pairs: [(key: String, value: CanonicalValue)]) -> CanonicalValue? {
            pairs.first { $0.key == name }?.value
        }
        func string(_ value: CanonicalValue?, _ name: String) throws -> String {
            guard case .string(let text)? = value else {
                throw SignerError(.malformedRequest, "\(name) is missing or not a string")
            }
            return text
        }

        guard case .object(let planPairs)? = field("plan", in: top) else {
            throw SignerError(.malformedRequest, "plan is missing")
        }
        let riskText = try string(field("risk", in: top), "risk")
        guard let risk = Risk(rawValue: riskText) else {
            throw SignerError(.malformedRequest, "risk must be low, medium or high")
        }

        var params: [(key: String, value: CanonicalValue)] = []
        if let paramsValue = field("params", in: planPairs) {
            guard case .object(let pairs) = paramsValue else {
                throw SignerError(.malformedRequest, "params is not an object")
            }
            params = pairs
        }

        let plan = Plan(
            connector: try string(field("connector", in: planPairs), "connector"),
            operation: try string(field("operation", in: planPairs), "operation"),
            resource: try string(field("resource", in: planPairs), "resource"),
            params: params
        )
        return GrantRequest(plan: plan, risk: risk)
    }
}

public struct GrantService {
    private let keys: EnclaveKeyManager
    private let requirePresence: Bool
    private let log: (String) -> Void

    public init(keys: EnclaveKeyManager, requirePresence: Bool = true, log: @escaping (String) -> Void = { _ in }) {
        self.keys = keys
        self.requirePresence = requirePresence
        self.log = log
    }

    /// §3's claim construction, in the order §3 requires: the operation is
    /// checked against the registry BEFORE any prompt, so an unknown operation
    /// returns `unknown_operation` without disturbing the user.
    public func grant(_ request: GrantRequest) throws -> (claims: GrantClaims, signature: Data) {
        guard let spec = Operations.find(connector: request.plan.connector, operation: request.plan.operation) else {
            throw SignerError(.unknownOperation,
                              "\(request.plan.connector):\(request.plan.operation) is not a known operation")
        }

        let issuer = try keys.issuer()
        let jti = try ClaimsBuilder.newJTI()

        var context: LAContext?
        var presenceAt = Int64(Date().timeIntervalSince1970)
        if requirePresence {
            let reason = "\(spec.humanDescription): \(request.plan.resource.isEmpty ? "this workflow" : request.plan.resource)"
            let presence = try Presence.require(reason: reason)
            context = presence.context
            presenceAt = presence.at
        }

        let claims = try ClaimsBuilder.build(
            plan: request.plan,
            risk: request.risk,
            issuer: issuer,
            jti: jti,
            now: Int64(Date().timeIntervalSince1970),
            presenceAt: presenceAt
        )

        let canonical = try canonicalString(claims.canonicalValue)
        // §10: log the canonical string and its SHA-256 on both sides at debug
        // level, so "do the two canonical strings differ?" takes ten seconds.
        log("canonical[claims] sha256=\(try ClaimsBuilder.hash(claims.canonicalValue)) \(canonical)")

        let signature = try keys.signRaw(Data(canonical.utf8), context: context)
        return (claims, signature)
    }

    /// The §2 success body: { "token": { "claims": ..., "sig": ..., "alg": "ES256" } }
    public static func tokenJSON(claims: GrantClaims, signature: Data) throws -> String {
        let canonical = try canonicalString(claims.canonicalValue)
        return "{\"token\":{\"claims\":\(canonical),\"sig\":\"\(Base64URL.encode(signature))\",\"alg\":\"ES256\"}}"
    }
}
