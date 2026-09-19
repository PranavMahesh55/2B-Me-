import Foundation
import GrantCore

// One binary for everything that touches the Secure Enclave key, deliberately.
//
// Verified on macOS 26.4: an ad-hoc-signed binary cannot use the data-protection
// keychain (-34018) and cannot carry a keychain-access-groups entitlement (the
// kernel SIGKILLs it, exit 137), so the key lives in the legacy keychain. That
// keychain routes through the old CDSA stack, which enforces a PER-BINARY ACL --
// and because `codesign -s -` has no signing authority, a binary's designated
// requirement is its cdhash. Two executables sharing one --identifier are still
// two identities, so the second one to touch the key raises a blocking
// SecurityAgent dialog rather than an error.
//
// Collapsing every key-touching entry point into one binary removes the
// cross-binary case entirely. A rebuild still changes the cdhash, which is what
// `export-pubkey --reset` is for during development; a real deployment signs
// with a Developer ID, whose designated requirement is stable across rebuilds.
//
// §5 says nothing about any of this.

let arguments = Array(CommandLine.arguments.dropFirst())

func usage() -> Never {
    print("""
        usage: grant-signer <command> [options]

          export-pubkey [--role production|test] [--json] [--reset]
              Write the public key as SPKI DER base64url (§5).

          vectors [--count N] [--out PATH] [--regenerate]
              Sign N distinct payloads with the test key and write
              packages/grant/vectors/signatures.json (§6).
        """)
    exit(2)
}

guard let command = arguments.first else { usage() }
let rest = Array(arguments.dropFirst())

switch command {
case "export-pubkey": runExportPubKey(rest)
case "vectors": runVectors(rest)
case "--help", "-h", "help": usage()
default:
    FileHandle.standardError.write(Data("unknown command \(command)\n".utf8))
    usage()
}
