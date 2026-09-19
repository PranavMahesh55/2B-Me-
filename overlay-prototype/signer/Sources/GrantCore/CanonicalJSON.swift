import Foundation

/// A hand-written JSON scanner producing `CanonicalValue`.
///
/// `JSONSerialization` is unusable here for two reasons. It yields `NSNumber`,
/// from which `1` and `1.0` are indistinguishable, so §4's "throw on floats"
/// becomes unimplementable. And bridging its dictionaries into Swift would merge
/// canonically-equivalent keys, the trap `CanonicalValue` exists to avoid.
public enum CanonicalJSON {
    public static func parse(_ text: String) throws -> CanonicalValue {
        var scanner = Scanner(bytes: Array(text.utf8))
        scanner.skipWhitespace()
        let value = try scanner.parseValue(path: "", depth: 0)
        scanner.skipWhitespace()
        guard scanner.isAtEnd else {
            throw CanonicalError(.malformedJSON, path: "", detail: "trailing bytes after the top-level value")
        }
        return value
    }

    private struct Scanner {
        let bytes: [UInt8]
        var index = 0

        init(bytes: [UInt8]) { self.bytes = bytes }

        var isAtEnd: Bool { index >= bytes.count }
        private var current: UInt8? { index < bytes.count ? bytes[index] : nil }

        mutating func skipWhitespace() {
            while let byte = current, byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D {
                index += 1
            }
        }

        private mutating func expect(_ byte: UInt8, path: String) throws {
            guard current == byte else {
                throw CanonicalError(.malformedJSON, path: path,
                                     detail: "expected '\(Character(UnicodeScalar(byte)))' at byte \(index)")
            }
            index += 1
        }

        mutating func parseValue(path: String, depth: Int) throws -> CanonicalValue {
            guard depth <= canonicalMaxDepth else {
                throw CanonicalError(.depthExceeded, path: path, detail: "nesting deeper than \(canonicalMaxDepth)")
            }
            skipWhitespace()
            guard let byte = current else {
                throw CanonicalError(.malformedJSON, path: path, detail: "unexpected end of input")
            }
            switch byte {
            case 0x7B: return try parseObject(path: path, depth: depth)
            case 0x5B: return try parseArray(path: path, depth: depth)
            case 0x22: return .string(try parseString(path: path))
            case 0x74: try literal("true", path: path);  return .boolean(true)
            case 0x66: try literal("false", path: path); return .boolean(false)
            case 0x6E: try literal("null", path: path);  return .null
            default:   return try parseNumber(path: path)
            }
        }

        private mutating func literal(_ word: String, path: String) throws {
            let expected = Array(word.utf8)
            guard index + expected.count <= bytes.count,
                  Array(bytes[index ..< index + expected.count]) == expected else {
                throw CanonicalError(.malformedJSON, path: path, detail: "expected \(word)")
            }
            index += expected.count
        }

        private mutating func parseObject(path: String, depth: Int) throws -> CanonicalValue {
            try expect(0x7B, path: path)
            var pairs: [(key: String, value: CanonicalValue)] = []
            skipWhitespace()
            if current == 0x7D { index += 1; return .object(pairs) }
            while true {
                skipWhitespace()
                let key = try parseString(path: path)
                let childPath = path.isEmpty ? key : "\(path).\(key)"
                // Compare by UTF-16 units, not String ==, so NFC and NFD forms of
                // the same letter count as the distinct keys JavaScript sees.
                if pairs.contains(where: { Array($0.key.utf16) == Array(key.utf16) }) {
                    throw CanonicalError(.duplicateKey, path: childPath, detail: "duplicate key")
                }
                skipWhitespace()
                try expect(0x3A, path: childPath)
                let value = try parseValue(path: childPath, depth: depth + 1)
                pairs.append((key: key, value: value))
                skipWhitespace()
                if current == 0x2C { index += 1; continue }
                try expect(0x7D, path: path)
                return .object(pairs)
            }
        }

        private mutating func parseArray(path: String, depth: Int) throws -> CanonicalValue {
            try expect(0x5B, path: path)
            var items: [CanonicalValue] = []
            skipWhitespace()
            if current == 0x5D { index += 1; return .array(items) }
            while true {
                let value = try parseValue(path: "\(path)[\(items.count)]", depth: depth + 1)
                items.append(value)
                skipWhitespace()
                if current == 0x2C { index += 1; continue }
                try expect(0x5D, path: path)
                return .array(items)
            }
        }

        private mutating func parseString(path: String) throws -> String {
            try expect(0x22, path: path)
            var units: [UInt16] = []
            while true {
                guard let byte = current else {
                    throw CanonicalError(.malformedJSON, path: path, detail: "unterminated string")
                }
                if byte == 0x22 { index += 1; break }
                if byte == 0x5C {
                    index += 1
                    guard let escape = current else {
                        throw CanonicalError(.malformedJSON, path: path, detail: "unterminated escape")
                    }
                    index += 1
                    switch escape {
                    case 0x22: units.append(0x22)
                    case 0x5C: units.append(0x5C)
                    case 0x2F: units.append(0x2F)
                    case 0x62: units.append(0x08)
                    case 0x66: units.append(0x0C)
                    case 0x6E: units.append(0x0A)
                    case 0x72: units.append(0x0D)
                    case 0x74: units.append(0x09)
                    case 0x75: units.append(try parseHex4(path: path))
                    default:
                        throw CanonicalError(.malformedJSON, path: path, detail: "unknown escape")
                    }
                    continue
                }
                // Raw UTF-8 run: copy it through and let String decode it.
                let start = index
                while let raw = current, raw != 0x22, raw != 0x5C { index += 1 }
                let chunk = String(decoding: bytes[start ..< index], as: UTF8.self)
                units.append(contentsOf: Array(chunk.utf16))
            }
            // Swift's String cannot hold an unpaired surrogate, so reject here
            // rather than let one be silently replaced with U+FFFD.
            var i = 0
            while i < units.count {
                let unit = units[i]
                if unit >= 0xD800 && unit <= 0xDFFF {
                    let isHigh = unit <= 0xDBFF
                    let next: UInt16? = i + 1 < units.count ? units[i + 1] : nil
                    guard isHigh, let low = next, low >= 0xDC00, low <= 0xDFFF else {
                        throw CanonicalError(.loneSurrogate, path: path,
                                             detail: String(format: "unpaired surrogate \\u%04x", Int(unit)))
                    }
                    i += 2
                    continue
                }
                i += 1
            }
            return String(decoding: units, as: UTF16.self)
        }

        private mutating func parseHex4(path: String) throws -> UInt16 {
            guard index + 4 <= bytes.count else {
                throw CanonicalError(.malformedJSON, path: path, detail: "truncated \\u escape")
            }
            var value: UInt16 = 0
            for _ in 0 ..< 4 {
                let byte = bytes[index]
                let digit: UInt16
                switch byte {
                case 0x30...0x39: digit = UInt16(byte - 0x30)
                case 0x61...0x66: digit = UInt16(byte - 0x61 + 10)
                case 0x41...0x46: digit = UInt16(byte - 0x41 + 10)
                default:
                    throw CanonicalError(.malformedJSON, path: path, detail: "bad hex digit in \\u escape")
                }
                value = value << 4 | digit
                index += 1
            }
            return value
        }

        private mutating func parseNumber(path: String) throws -> CanonicalValue {
            let start = index
            if current == 0x2D { index += 1 }
            var sawFraction = false
            while let byte = current {
                if byte >= 0x30 && byte <= 0x39 { index += 1; continue }
                if byte == 0x2E || byte == 0x65 || byte == 0x45 || byte == 0x2B || byte == 0x2D {
                    sawFraction = true
                    index += 1
                    continue
                }
                break
            }
            let text = String(decoding: bytes[start ..< index], as: UTF8.self)
            guard !text.isEmpty, text != "-" else {
                throw CanonicalError(.malformedJSON, path: path, detail: "expected a number")
            }
            // §4 accepts integers only. Judge by the literal text: a decimal point
            // or an exponent means the source was not an integer, whatever its value.
            if sawFraction {
                throw CanonicalError(.float, path: path, detail: "\(text) is not an integer")
            }
            guard let number = Int64(text) else {
                throw CanonicalError(.unsafeInteger, path: path, detail: "\(text) does not fit in Int64")
            }
            guard abs(number) <= canonicalMaxSafeInteger else {
                throw CanonicalError(.unsafeInteger, path: path,
                                     detail: "\(text) exceeds the safe integer range")
            }
            return .integer(number)
        }
    }
}
