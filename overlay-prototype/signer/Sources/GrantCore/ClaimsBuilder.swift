import Foundation
import Security
import CryptoKit

public enum ClaimsBuilder {
    /// §3: base64url(SHA-256(canonicalize(value))). Every hash in the claims is
    /// this shape, including each param hashed individually -- which is why a
    /// string param canonicalizes to a QUOTED JSON string: canonicalize("abc") is
    /// five bytes, not three.
    public static func hash(_ value: CanonicalValue) throws -> String {
        Base64URL.encode(SHA256.hash(data: Data(try canonicalBytes(value))))
    }

    /// §3: base64url of 16 random bytes from SecRandomCopyBytes.
    public static func newJTI() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw SignerError(.malformedRequest, "SecRandomCopyBytes failed")
        }
        return Base64URL.encode(bytes)
    }

    public static func build(
        plan: Plan,
        risk: Risk,
        issuer: String,
        jti: String,
        now: Int64,
        presenceAt: Int64
    ) throws -> GrantClaims {
        GrantClaims(
            version: 1,
            issuer: issuer,
            audience: "broker.local",
            jti: jti,
            issuedAt: now,
            expiresAt: now + risk.ttlSeconds,
            planHash: try hash(plan.canonicalValue),
            connector: plan.connector,
            operation: plan.operation,
            resource: plan.resource,
            paramHashes: try plan.params.map { (key: $0.key, value: try hash($0.value)) },
            maxCalls: risk.maxCalls,
            presenceMethod: "touchid",
            presenceAt: presenceAt,
            risk: risk
        )
    }
}
