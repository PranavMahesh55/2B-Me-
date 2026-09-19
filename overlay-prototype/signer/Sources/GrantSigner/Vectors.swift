import Foundation
import CryptoKit
import GrantCore

/// §6: 500 distinct payloads signed with the Enclave test key, every output
/// asserted to be exactly 64 raw bytes.
func runVectors(_ args: [String]) {
    // §6: "signs 500 distinct payloads with the real Enclave key and asserts every
    // output is exactly 64 bytes. A single-signature test passes about 255 times out
    // of 256 and tells you nothing. Write the 500 pairs to
    // packages/grant/vectors/signatures.json for the broker's test suite to consume."
    //
    // Uses the `test` key role: a real Secure Enclave key on the same code path, but
    // without .biometryCurrentSet, so 500 signatures do not mean 500 Touch ID prompts.
    //
    //   signature-harness [--count N] [--out PATH] [--regenerate]

    var count = 500
    var outPath = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // -> SignatureHarness/
        .deletingLastPathComponent()   // -> Sources/
        .deletingLastPathComponent()   // -> signer/
        .deletingLastPathComponent()   // -> overlay-prototype/
        .appendingPathComponent("packages/grant/vectors/signatures.json")
    var regenerate = false

    var arguments = args
    while let argument = arguments.first {
        arguments.removeFirst()
        switch argument {
        case "--count":
            count = Int(arguments.removeFirst()) ?? 500
        case "--out":
            outPath = URL(fileURLWithPath: arguments.removeFirst())
        case "--regenerate":
            regenerate = true
        default:
            FileHandle.standardError.write(Data("unknown argument \(argument)\n".utf8))
            exit(2)
        }
    }

    func die(_ message: String) -> Never {
        FileHandle.standardError.write(Data("\(message)\n".utf8))
        exit(1)
    }

    /// Deterministic, not random, so the file is reproducible: a regenerated file
    /// that differs means the canonicalizer changed, not the RNG.
    func payload(_ index: Int) -> (Plan, Risk) {
        let spec = Operations.all[index % Operations.all.count]
        let risk = Risk.allCases[(index / 3) % Risk.allCases.count]

        let resources = [
            "workflow:wf_\(index)",
            "preview_only",
            "com.apple.Safari",
            "café ☕ \(index)",
            "",
            "emoji 🚀 \(index)",
        ]
        let resource = resources[index % resources.count]

        // 0 to 3 params, including non-ASCII names, control characters, empty
        // strings, integers, booleans, arrays and nested objects.
        var params: [(key: String, value: CanonicalValue)] = []
        let shape = index % 4
        if shape >= 1 {
            params.append((key: "destination", value: .string(index % 2 == 0 ? "preview_only" : "draft")))
        }
        if shape >= 2 {
            params.append((key: "workflow_\(index % 7)", value: .integer(Int64(index))))
            params.append((key: "naïve_kéy", value: .string("value \u{0001} with control")))
        }
        if shape >= 3 {
            params.append((key: "flags", value: .array([.boolean(index % 2 == 0), .integer(-Int64(index))])))
            params.append((key: "nested", value: .object([
                (key: "b", value: .string("")),
                (key: "a", value: .string("😀")),
            ])))
        }
        return (Plan(connector: spec.connector, operation: spec.operation, resource: resource, params: params), risk)
    }

    let manager = EnclaveKeyManager(role: .test)
    do {
        try manager.loadOrCreate()
    } catch {
        die("could not open the test Enclave key: \(error)")
    }

    let issuer: String
    let spki: String
    do {
        issuer = try manager.issuer()
        spki = Base64URL.encode(try manager.publicKeySPKIDER())
    } catch {
        die("could not export the public key: \(error)")
    }

    var cases: [String] = []
    var seenCanonical = Set<String>()
    var shortest = Int.max
    var longest = 0

    for index in 0 ..< count {
        let (plan, risk) = payload(index)
        let issuedAt = Int64(1_758_300_000 + index)

        // Deterministic jti, so the artifact is reproducible.
        let jtiSeed = Data("2bme-vector-\(index)".utf8)
        let jti = String(Base64URL.encode(SHA256.hash(data: jtiSeed)).prefix(22))

        do {
            let claims = try ClaimsBuilder.build(
                plan: plan, risk: risk, issuer: issuer, jti: jti,
                now: issuedAt, presenceAt: issuedAt - 2)

            let canonical = try canonicalString(claims.canonicalValue)
            guard seenCanonical.insert(canonical).inserted else {
                die("payload \(index) is not distinct -- a generator bug would make this suite prove nothing")
            }

            // §5: sign the UTF-8 bytes of the canonical claims string. The algorithm
            // hashes internally; pre-hashing would sign the hash of a hash.
            let raw = try manager.signRaw(Data(canonical.utf8))
            guard raw.count == 64 else {
                die("payload \(index) produced \(raw.count) signature bytes, not 64")
            }
            shortest = min(shortest, raw.count)
            longest = max(longest, raw.count)

            let planJSON = try canonicalString(plan.canonicalValue)
            let digest = Base64URL.encode(SHA256.hash(data: Data(canonical.utf8)))
            let encodedCanonical = String(
                decoding: try JSONSerialization.data(withJSONObject: [canonical], options: [])
                    .dropFirst().dropLast(),
                as: UTF8.self)

            cases.append("""
                {
                      "i": \(index),
                      "claims": \(canonical),
                      "plan": \(planJSON),
                      "canonical": \(encodedCanonical),
                      "canonical_sha256_b64url": "\(digest)",
                      "sig_b64url": "\(Base64URL.encode(raw))",
                      "now": \(issuedAt + 1)
                    }
                """)
        } catch {
            die("payload \(index) failed: \(error)")
        }
    }

    if FileManager.default.fileExists(atPath: outPath.path) && !regenerate {
        die("""
            Refusing to overwrite \(outPath.path).
            techspecsigner.md §10: never edit the vector files to make a test pass.
            Re-run with --regenerate only if the contract itself changed.
            """)
    }

    let document = """
        {
          "version": 1,
          "alg": "ES256",
          "generator": "signer/Sources/SignatureHarness",
          "key": {
            "tag": "\(KeyRole.test.tag)",
            "note": "TEST KEY -- a real Secure Enclave key without .biometryCurrentSet. The broker's RUNTIME config must use the production key from bin/export-pubkey, not this one.",
            "spki_der_b64url": "\(spki)",
            "iss": "\(issuer)"
          },
          "cases": [
            \(cases.joined(separator: ",\n    "))
          ]
        }

        """

    do {
        try FileManager.default.createDirectory(
            at: outPath.deletingLastPathComponent(), withIntermediateDirectories: true)
        try document.write(to: outPath, atomically: true, encoding: .utf8)
    } catch {
        die("could not write \(outPath.path): \(error)")
    }

    print("ok   \(count) signatures, every one exactly 64 raw bytes")
    print("ok   \(seenCanonical.count) distinct canonical payloads")
    print("wrote \(outPath.path)")

}
