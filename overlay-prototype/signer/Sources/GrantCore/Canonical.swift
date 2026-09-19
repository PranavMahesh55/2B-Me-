import Foundation

/// §4: object keys sort by UTF-16 code unit.
///
/// Swift's default `String` `<` is Unicode *scalar* ordering, which disagrees with
/// JavaScript for anything above the BMP: U+1F600 has scalar value 128512 and
/// sorts after U+FF5A (65370), but its first UTF-16 code unit is 0xD83D (55357)
/// and sorts before. Compare the code units directly.
@inline(__always)
public func utf16Less(_ a: String, _ b: String) -> Bool {
    var i = a.utf16.makeIterator()
    var j = b.utf16.makeIterator()
    while true {
        switch (i.next(), j.next()) {
        case (nil, nil): return false       // equal
        case (nil, _?): return true         // a is a prefix of b
        case (_?, nil): return false
        case let (x?, y?):
            if x != y { return x < y }
        }
    }
}

private let twoCharEscapes: [UInt16: [UInt8]] = [
    0x22: Array("\\\"".utf8),
    0x5C: Array("\\\\".utf8),
    0x08: Array("\\b".utf8),
    0x0C: Array("\\f".utf8),
    0x0A: Array("\\n".utf8),
    0x0D: Array("\\r".utf8),
    0x09: Array("\\t".utf8),
]

private let lowerHex: [UInt8] = Array("0123456789abcdef".utf8)

/// §4: the seven listed escapes, other sub-0x20 code points as `\u00xx` with
/// LOWERCASE hex, every other code point raw.
func encodeString(_ value: String, path: String, into out: inout [UInt8]) throws {
    out.append(0x22)
    let units = Array(value.utf16)
    var index = 0
    while index < units.count {
        let unit = units[index]
        if let escape = twoCharEscapes[unit] {
            out.append(contentsOf: escape)
        } else if unit < 0x20 {
            out.append(contentsOf: Array("\\u00".utf8))
            out.append(lowerHex[Int((unit >> 4) & 0xF)])
            out.append(lowerHex[Int(unit & 0xF)])
        } else if unit >= 0xD800 && unit <= 0xDFFF {
            // A lone surrogate has no UTF-8 encoding; emitting one would make the
            // two languages disagree on bytes. §4's rule is to throw, never coerce.
            let isHigh = unit <= 0xDBFF
            let next: UInt16? = index + 1 < units.count ? units[index + 1] : nil
            guard isHigh, let low = next, low >= 0xDC00, low <= 0xDFFF else {
                throw CanonicalError(
                    .loneSurrogate, path: path,
                    detail: String(format: "unpaired surrogate \\u%04x", Int(unit)))
            }
            var scalarValue = UInt32(unit - 0xD800) << 10
            scalarValue += UInt32(low - 0xDC00)
            scalarValue += 0x1_0000
            out.append(contentsOf: Array(String(UnicodeScalar(scalarValue)!).utf8))
            index += 2
            continue
        } else {
            out.append(contentsOf: Array(String(UnicodeScalar(unit)!).utf8))
        }
        index += 1
    }
    out.append(0x22)
}

private func encode(_ value: CanonicalValue, path: String, depth: Int, into out: inout [UInt8]) throws {
    guard depth <= canonicalMaxDepth else {
        throw CanonicalError(.depthExceeded, path: path, detail: "nesting deeper than \(canonicalMaxDepth)")
    }
    switch value {
    case .null:
        throw CanonicalError(.null, path: path, detail: "null is not encodable")
    case .boolean(let flag):
        out.append(contentsOf: Array((flag ? "true" : "false").utf8))
    case .integer(let number):
        guard abs(number) <= canonicalMaxSafeInteger else {
            throw CanonicalError(.unsafeInteger, path: path,
                                 detail: "\(number) exceeds the safe integer range")
        }
        // §4: no sign on positives, no exponent, no decimal point.
        out.append(contentsOf: Array(String(number).utf8))
    case .string(let text):
        try encodeString(text, path: path, into: &out)
    case .array(let items):
        out.append(0x5B) // [
        for (offset, item) in items.enumerated() {
            if offset > 0 { out.append(0x2C) }
            try encode(item, path: "\(path)[\(offset)]", depth: depth + 1, into: &out)
        }
        out.append(0x5D) // ]
    case .object(let pairs):
        // §4: sorted by UTF-16 code unit, no whitespace anywhere.
        let sorted = pairs.sorted { utf16Less($0.key, $1.key) }
        out.append(0x7B) // {
        for (offset, pair) in sorted.enumerated() {
            if offset > 0 { out.append(0x2C) }
            let childPath = path.isEmpty ? pair.key : "\(path).\(pair.key)"
            try encodeString(pair.key, path: childPath, into: &out)
            out.append(0x3A) // :
            try encode(pair.value, path: childPath, depth: depth + 1, into: &out)
        }
        out.append(0x7D) // }
    }
}

/// The canonical bytes. Built as UTF-8 directly rather than as a `String` that is
/// converted at the end, so no `String` normalization can touch the output.
public func canonicalBytes(_ value: CanonicalValue) throws -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(256)
    try encode(value, path: "", depth: 0, into: &out)
    return out
}

public func canonicalString(_ value: CanonicalValue) throws -> String {
    String(decoding: try canonicalBytes(value), as: UTF8.self)
}
