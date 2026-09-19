import Foundation
import GrantCore

/// §5: writes SPKI DER base64url to stdout. The broker reads it from config.
func runExportPubKey(_ args: [String]) {
    // §5: "Expose the public key: signer/bin/export-pubkey writes SPKI DER base64url
    // to stdout. The broker reads it from config at startup."
    //
    //   export-pubkey [--role production|test] [--json]

    var role = KeyRole.production
    var asJSON = false
    var reset = false

    var arguments = args
    while let argument = arguments.first {
        arguments.removeFirst()
        switch argument {
        case "--role":
            guard let value = arguments.first else {
                FileHandle.standardError.write(Data("--role needs a value\n".utf8))
                exit(2)
            }
            arguments.removeFirst()
            switch value {
            case "production": role = .production
            case "test": role = .test
            default:
                FileHandle.standardError.write(Data("unknown role \(value)\n".utf8))
                exit(2)
            }
        case "--json":
            asJSON = true
        case "--reset":
            // Drops the key so the next call regenerates it. Needed when the code
            // signing identity changes: the legacy keychain binds an item's ACL to
            // the identity that created it, and a mismatch raises a blocking
            // authorization dialog instead of an error.
            reset = true
        case "--help", "-h":
            print("usage: export-pubkey [--role production|test] [--json] [--reset]")
            exit(0)
        default:
            FileHandle.standardError.write(Data("unknown argument \(argument)\n".utf8))
            exit(2)
        }
    }

    let manager = EnclaveKeyManager(role: role)
    if reset {
        manager.deleteForTesting()
        FileHandle.standardError.write(Data("deleted key for tag \(role.tag)\n".utf8))
    }
    do {
        // §5: look it up on every start, generate only if absent.
        try manager.loadOrCreate()
        let spki = try manager.publicKeySPKIDER()
        let encoded = Base64URL.encode(spki)
        if asJSON {
            let payload: [String: String] = [
                "spki_der_b64url": encoded,
                "iss": try manager.issuer(),
                "tag": role.tag,
            ]
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            print(String(decoding: data, as: UTF8.self))
        } else {
            print(encoded)
        }
    } catch let error as SignerError {
        FileHandle.standardError.write(Data("\(error.code.rawValue): \(error.message)\n".utf8))
        exit(1)
    } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        exit(1)
    }

}
