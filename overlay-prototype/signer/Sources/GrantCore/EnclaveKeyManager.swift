import Foundation
import Security
import CryptoKit
import LocalAuthentication

public struct KeyRole: Sendable {
    public let tag: String
    public let requiresBiometry: Bool

    /// §5's key. `.biometryCurrentSet` invalidates it if the enrolled fingerprint
    /// set changes, which is what makes `biometry_changed` distinguishable.
    public static let production = KeyRole(tag: "local.intent.signing.v1", requiresBiometry: true)

    /// §6 asks for 500 signatures with the real Enclave key, which under
    /// `.biometryCurrentSet` means 500 Touch ID prompts and no unattended run.
    /// This role is a real Secure Enclave key with the same code path, minus the
    /// biometric constraint, so the suite exercises DER->raw 500 times in CI.
    public static let test = KeyRole(tag: "local.intent.signing.test", requiresBiometry: false)

    public init(tag: String, requiresBiometry: Bool) {
        self.tag = tag
        self.requiresBiometry = requiresBiometry
    }
}

public final class EnclaveKeyManager {
    public let role: KeyRole

    public init(role: KeyRole) {
        self.role = role
    }

    private var tagData: Data { Data(role.tag.utf8) }

    /// Verified empirically on macOS 26.4 / M5 Pro with Command Line Tools:
    ///
    ///   - `kSecUseDataProtectionKeychain: true` (which §5 implies) fails with
    ///     -34018 errSecMissingEntitlement when adding the key, because an
    ///     ad-hoc-signed binary has no provisioned keychain access group.
    ///   - Adding a `keychain-access-groups` entitlement to work around that is
    ///     worse: with `codesign -s -` there is no team prefix to validate, and
    ///     the kernel SIGKILLs the process on launch (exit 137).
    ///   - The legacy file keychain accepts the Secure Enclave key for both roles
    ///     and it survives across processes.
    ///
    /// The key is still Enclave-backed and still governed by the SecAccessControl
    /// below; only the keychain that holds the reference differs.
    private static let useDataProtectionKeychain = false

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecUseDataProtectionKeychain as String: Self.useDataProtectionKeychain,
        ]
    }

    private func accessControl() throws -> SecAccessControl {
        var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
        if role.requiresBiometry { flags.insert(.biometryCurrentSet) }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            flags,
            &error
        ) else {
            throw SignerError(.keyMissing,
                              "SecAccessControlCreateWithFlags failed: \(String(describing: error?.takeRetainedValue()))")
        }
        return access
    }

    /// Looks the key up without raising a prompt. Retrieving a reference and
    /// copying the public key never require presence; only signing does.
    public func loadExisting(context: LAContext? = nil) throws -> SecKey {
        var query = baseQuery()
        query[kSecReturnRef as String] = true
        if let context {
            query[kSecUseAuthenticationContext as String] = context
        } else {
            let silent = LAContext()
            silent.interactionNotAllowed = true
            query[kSecUseAuthenticationContext as String] = silent
        }

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let item else { throw SignerError(.keyMissing, "lookup returned no reference") }
            return item as! SecKey
        case errSecItemNotFound:
            throw SignerError(.keyMissing, "no key for tag \(role.tag)")
        default:
            throw SignerError(.keyMissing, "SecItemCopyMatching failed: \(Self.describe(status))")
        }
    }

    /// §5: generate once on first run, look it up on every start, generate only
    /// if absent.
    @discardableResult
    public func loadOrCreate() throws -> SecKey {
        if let existing = try? loadExisting() { return existing }

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecUseDataProtectionKeychain as String: Self.useDataProtectionKeychain,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tagData,
                kSecAttrAccessControl as String: try accessControl(),
            ],
        ]

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            let detail = String(describing: error?.takeRetainedValue())
            throw SignerError(.keyMissing, "SecKeyCreateRandomKey failed: \(detail)")
        }
        return key
    }

    public func publicKeyX963() throws -> Data {
        let key = try loadExisting()
        guard let publicKey = SecKeyCopyPublicKey(key) else {
            throw SignerError(.keyMissing, "SecKeyCopyPublicKey returned nil")
        }
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw SignerError(.keyMissing,
                              "SecKeyCopyExternalRepresentation failed: \(String(describing: error?.takeRetainedValue()))")
        }
        return data
    }

    /// The 91-byte SPKI DER the broker imports, and what §3 hashes for `iss`.
    public func publicKeySPKIDER() throws -> Data {
        do {
            return try SPKI.fromX963(try publicKeyX963())
        } catch let error as SPKI.SPKIError {
            throw SignerError(.keyMissing, "could not build SPKI: \(error)")
        }
    }

    public func issuer() throws -> String {
        Base64URL.encode(SHA256.hash(data: try publicKeySPKIDER()))
    }

    /// §5: sign the UTF-8 bytes of the canonical claims string with
    /// `.ecdsaSignatureMessageX962SHA256`, which hashes internally -- do not
    /// pre-hash. §6: convert the DER result to raw r||s before base64url.
    public func signRaw(_ message: Data, context: LAContext? = nil) throws -> Data {
        let key: SecKey
        do {
            key = try loadExisting(context: context)
        } catch {
            throw SignerError(.keyMissing, "key unavailable for signing: \(error)")
        }

        var error: Unmanaged<CFError>?
        guard let der = SecKeyCreateSignature(
            key, .ecdsaSignatureMessageX962SHA256, message as CFData, &error
        ) as Data? else {
            throw Self.mapSigningFailure(error?.takeRetainedValue())
        }

        do {
            return try DERSignature.derToRaw(der)
        } catch {
            throw SignerError(.presenceFailed, "signature conversion failed: \(error)")
        }
    }

    /// §5: "When a sign operation fails with `errSecAuthFailed` after the key was
    /// previously usable, return `biometry_changed`, not `presence_failed` -- the
    /// UI has distinct copy for it."
    ///
    /// With `.biometryCurrentSet` a changed fingerprint set leaves the item in the
    /// keychain but makes it unusable, so lookup succeeds and signing fails. That
    /// is why this is decided here, at the signing failure, rather than from a
    /// persisted flag.
    static func mapSigningFailure(_ error: Error?) -> SignerError {
        let nsError = error as NSError?
        let code = nsError?.code ?? 0
        let detail = nsError?.localizedDescription ?? "unknown signing failure"

        if let laCode = LAError.Code(rawValue: code), nsError?.domain == LAError.errorDomain {
            switch laCode {
            case .userCancel, .appCancel, .systemCancel, .userFallback:
                return SignerError(.presenceCancelled, detail)
            case .biometryNotEnrolled, .biometryLockout, .invalidContext:
                return SignerError(.biometryChanged, detail)
            case .authenticationFailed:
                return SignerError(.presenceFailed, detail)
            default:
                return SignerError(.presenceFailed, detail)
            }
        }

        switch OSStatus(code) {
        case errSecUserCanceled:
            return SignerError(.presenceCancelled, detail)
        case errSecAuthFailed, errSecInteractionNotAllowed, errSecItemNotFound:
            // Lookup already succeeded, so the key exists; failing here means the
            // access control no longer admits it.
            return SignerError(.biometryChanged, detail)
        default:
            return SignerError(.presenceFailed, detail)
        }
    }

    /// Only used by the checks, to keep a run from leaking keychain state.
    public func deleteForTesting() {
        SecItemDelete(baseQuery() as CFDictionary)
    }

    static func describe(_ status: OSStatus) -> String {
        "OSStatus \(status) (\(SecCopyErrorMessageString(status, nil) as String? ?? "?"))"
    }
}
