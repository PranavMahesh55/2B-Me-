import Foundation

/// §6: `SecKeyCreateSignature` returns X9.62 DER (`30 len 02 len r 02 len s`) but
/// WebCrypto's ECDSA verify needs raw `r||s`, exactly 64 bytes. DER drops leading
/// zero bytes and prepends one when the high bit is set, so each of r and s
/// arrives as 31, 32 or 33 bytes. Observed live on this machine: three
/// consecutive signatures came back 72, 70 and 71 bytes.
public enum DERSignature {
    public enum DERError: Error, CustomStringConvertible {
        case malformed(String)

        public var description: String {
            switch self { case .malformed(let why): return "malformed ECDSA DER: \(why)" }
        }
    }

    public static func derToRaw(_ der: Data) throws -> Data {
        let bytes = [UInt8](der)
        var index = 0

        func take(_ what: String) throws -> UInt8 {
            guard index < bytes.count else { throw DERError.malformed("truncated reading \(what)") }
            defer { index += 1 }
            return bytes[index]
        }

        /// DER lengths here are always short-form or one-byte long-form: the whole
        /// structure is at most ~72 bytes.
        func takeLength(_ what: String) throws -> Int {
            let first = try take("\(what) length")
            if first & 0x80 == 0 { return Int(first) }
            guard first == 0x81 else {
                throw DERError.malformed("unsupported long-form length 0x\(String(format: "%02x", first)) for \(what)")
            }
            return Int(try take("\(what) long length"))
        }

        guard try take("sequence tag") == 0x30 else {
            throw DERError.malformed("expected SEQUENCE")
        }
        let sequenceLength = try takeLength("sequence")
        guard index + sequenceLength == bytes.count else {
            throw DERError.malformed("sequence length \(sequenceLength) does not match \(bytes.count - index) remaining bytes")
        }

        func takeInteger(_ name: String) throws -> [UInt8] {
            guard try take("\(name) tag") == 0x02 else {
                throw DERError.malformed("expected INTEGER for \(name)")
            }
            let length = try takeLength(name)
            guard length > 0 else { throw DERError.malformed("\(name) is empty") }
            guard index + length <= bytes.count else {
                throw DERError.malformed("\(name) runs past the end")
            }
            var value = Array(bytes[index ..< index + length])
            index += length

            // A leading 0x00 is DER's sign padding and is only legal when the next
            // byte has its high bit set; anything else is a non-minimal encoding.
            if value.count > 1 && value[0] == 0x00 {
                guard value[1] & 0x80 != 0 else {
                    throw DERError.malformed("\(name) has a non-minimal leading zero")
                }
                value.removeFirst()
            } else if value[0] & 0x80 != 0 {
                throw DERError.malformed("\(name) is negative")
            }

            guard value.count <= 32 else {
                throw DERError.malformed("\(name) is \(value.count) bytes, more than the 32 a P-256 scalar can be")
            }
            guard value.contains(where: { $0 != 0 }) else {
                throw DERError.malformed("\(name) is zero")
            }
            // Left-pad to exactly 32.
            return Array(repeating: 0, count: 32 - value.count) + value
        }

        let r = try takeInteger("r")
        let s = try takeInteger("s")
        guard index == bytes.count else {
            throw DERError.malformed("\(bytes.count - index) trailing bytes after s")
        }
        return Data(r + s)
    }
}
