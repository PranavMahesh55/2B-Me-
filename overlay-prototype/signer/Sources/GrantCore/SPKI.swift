import Foundation

/// §3 says `iss = base64url(SHA-256(public key in SPKI DER))`, but the Security
/// framework will not give you SPKI. `SecKeyCopyExternalRepresentation` returns
/// the X9.63 form -- `04 || X || Y`, 65 bytes for P-256 -- and the broker's
/// `crypto.subtle.importKey("spki", ...)` needs the real 91-byte structure.
/// So the ASN.1 wrapper is built by hand. This is a genuine gap in §3.
public enum SPKI {
    /// SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING }
    /// with the 66-byte bit string (1 unused-bits octet + 65 key bytes).
    static let p256Prefix: [UInt8] = [
        0x30, 0x59,                                      // SEQUENCE, 89 bytes
        0x30, 0x13,                                      //   SEQUENCE, 19 bytes
        0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,        // OID 1.2.840.10045.2.1
        0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07,  // OID 1.2.840.10045.3.1.7
        0x03, 0x42, 0x00,                                //   BIT STRING, 66 bytes, 0 unused
    ]

    public enum SPKIError: Error, CustomStringConvertible {
        case badX963Length(Int)
        case badX963Prefix(UInt8)

        public var description: String {
            switch self {
            case .badX963Length(let n): return "expected 65 X9.63 bytes, got \(n)"
            case .badX963Prefix(let b): return "expected uncompressed point 0x04, got 0x\(String(format: "%02x", b))"
            }
        }
    }

    public static func fromX963(_ x963: Data) throws -> Data {
        guard x963.count == 65 else { throw SPKIError.badX963Length(x963.count) }
        guard x963.first == 0x04 else { throw SPKIError.badX963Prefix(x963.first ?? 0) }
        return Data(p256Prefix) + x963
    }
}
