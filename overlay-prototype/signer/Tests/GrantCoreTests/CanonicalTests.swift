import Foundation
import CryptoKit
import GrantCore

// §4 and §6 name signer/Tests/CanonicalTests.swift. SwiftPM requires targets to
// live under Tests/<TargetName>/, hence the extra directory level; Package.swift
// points the target at this path so the spec's location is preserved.

struct VectorFile: Decodable {
    let version: Int
    let vectors: [Vector]
}

struct Vector: Decodable {
    let name: String
    let description: String
    let input_json: String
    let canonical: String
    let canonical_utf8_hex: String
    let canonical_utf8_length: Int
    let sha256_base64url: String
}

enum Vectors {
    static var directory: URL {
        if let override = ProcessInfo.processInfo.environment["GRANT_VECTORS_DIR"] {
            return URL(fileURLWithPath: override)
        }
        // <overlay-prototype>/signer/Tests/GrantCoreTests/CanonicalTests.swift
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // -> GrantCoreTests/
            .deletingLastPathComponent()   // -> Tests/
            .deletingLastPathComponent()   // -> signer/
            .deletingLastPathComponent()   // -> overlay-prototype/
            .appendingPathComponent("packages/grant/vectors")
    }

    static func canonical() throws -> VectorFile {
        let url = directory.appendingPathComponent("canonical.json")
        return try JSONDecoder().decode(VectorFile.self, from: Data(contentsOf: url))
    }

    static func bytes(fromHex hex: String) -> [UInt8] {
        var out: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            out.append(UInt8(hex[index ..< next], radix: 16)!)
            index = next
        }
        return out
    }
}

/// techspecsigner.md §4: "This cross-language byte-equality test is the
/// highest-value test in the project. A silent disagreement here presents as an
/// invalid signature and will be misdiagnosed as a crypto bug for hours."
func runCanonicalChecks(_ h: Harness) {
    h.suite("§4 canonical byte-equality with JavaScript")

    let file: VectorFile
    do {
        file = try Vectors.canonical()
    } catch {
        h.fail("could not load \(Vectors.directory.path)/canonical.json: \(error)")
        return
    }
    h.expect(file.vectors.count == 12, "§4 enumerates exactly 12 cases (got \(file.vectors.count))")

    for vector in file.vectors {
        do {
            let produced = try canonicalBytes(try CanonicalJSON.parse(vector.input_json))
            let expected = Vectors.bytes(fromHex: vector.canonical_utf8_hex)

            guard produced == expected else {
                // The ten-second answer §10 asks for: which byte, and what each
                // side actually produced there.
                let offset = zip(produced, expected).enumerated()
                    .first { $0.element.0 != $0.element.1 }?.offset
                    ?? min(produced.count, expected.count)
                h.fail("""
                    \(vector.name): bytes differ at offset \(offset)
                        swift      : \(String(decoding: produced, as: UTF8.self))
                        javascript : \(vector.canonical)
                        swift hex  : \(produced.map { String(format: "%02x", $0) }.joined())
                        js    hex  : \(vector.canonical_utf8_hex)
                    """)
                continue
            }

            let digest = Base64URL.encode(SHA256.hash(data: Data(produced)))
            h.expect(produced.count == vector.canonical_utf8_length && digest == vector.sha256_base64url,
                     "\(vector.name) (\(produced.count) bytes, sha256 agrees)")
        } catch {
            h.fail("\(vector.name): \(error)")
        }
    }

    h.suite("§4 cross-language traps")

    // Trap 1: Swift String equality is canonical-equivalence based, so a
    // Dictionary-backed port would merge these two distinct JavaScript keys.
    let nfc = "\u{00E9}"
    let nfd = "e\u{0301}"
    h.expect(nfc == nfd, "Swift sees NFC and NFD as equal Strings")
    h.expect(Array(nfc.utf16) != Array(nfd.utf16), "but they are distinct key bytes")
    do {
        let value = try CanonicalJSON.parse(#"{"é":1,"é":2}"#)
        guard case .object(let pairs) = value else {
            h.fail("expected an object"); return
        }
        h.expect(pairs.count == 2, "both keys survive parsing (a Dictionary would give 1)")
        h.expect(try canonicalString(value) == "{\"e\u{0301}\":2,\"\u{00E9}\":1}",
                 "NFD sorts before NFC by UTF-16 code unit")
    } catch {
        h.fail("NFC/NFD case threw: \(error)")
    }

    // Trap 2: the ordering rule §4 names.
    let emoji = "\u{1F600}"     // first code unit 0xD83D = 55357
    let fullwidth = "\u{FF5A}"  // single code unit 0xFF5A = 65370
    h.expect(utf16Less(emoji, fullwidth), "UTF-16 order puts the emoji first")
    h.expect(emoji > fullwidth, "Swift's default String < would put it last")

    h.suite("§4 rejections")

    let rejections: [(String, CanonicalErrorReason)] = [
        (#"{"a":1.5}"#, .float),
        (#"{"a":1.0}"#, .float),
        (#"{"a":1e21}"#, .float),
        (#"{"a":null}"#, .null),
        (#"{"a":9007199254740993}"#, .unsafeInteger),
        (#"{"a":"\ud800"}"#, .loneSurrogate),
        (#"{"a":1,"a":2}"#, .duplicateKey),
    ]
    for (json, expected) in rejections {
        do {
            _ = try canonicalBytes(try CanonicalJSON.parse(json))
            h.fail("\(json) should have thrown \(expected.rawValue)")
        } catch let error as CanonicalError {
            h.expect(error.reason == expected, "\(json) -> \(error.reason.rawValue)")
        } catch {
            h.fail("\(json) threw an unexpected error type: \(error)")
        }
    }
}
