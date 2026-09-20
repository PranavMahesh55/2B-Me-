import Foundation
import LocalAuthentication

public struct PresenceResult {
    public let method: String
    public let at: Int64
    public let context: LAContext
}

public enum Presence {
    /// §5: "The biometric reason string passed to the prompt must contain the
    /// human description of the action, so the OS dialog itself names what is
    /// being authorized."
    ///
    /// The same LAContext is handed to the keychain lookup afterwards, so the
    /// signature does not raise a second prompt for one authorization.
    /// The signer owns the timeout, not the caller.
    ///
    /// Without one, an untouched prompt sits open forever: the client gives up
    /// and tells the user something wrong, the OS dialog stays on screen, a
    /// later touch mints a token nobody collects, and -- worst -- the serial
    /// grant queue stays blocked, so every subsequent request hangs behind it.
    public static func require(reason: String, timeout: TimeInterval = 60) throws -> PresenceResult {
        let context = LAContext()
        context.localizedReason = reason

        var authError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) else {
            let code = (authError as NSError?)?.code ?? 0
            if let laCode = LAError.Code(rawValue: code),
               laCode == .biometryNotEnrolled || laCode == .biometryLockout {
                throw SignerError(.biometryChanged, authError?.localizedDescription ?? "biometry unavailable")
            }
            throw SignerError(.presenceFailed, authError?.localizedDescription ?? "cannot evaluate biometry")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var failure: Error?
        var succeeded = false

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, error in
            succeeded = ok
            failure = error
            semaphore.signal()
        }

        if semaphore.wait(timeout: .now() + timeout) == .timedOut {
            // Closes the dialog and releases the queue. Nothing was attempted,
            // so this is a cancellation, not a rejected fingerprint.
            context.invalidate()
            throw SignerError(.presenceCancelled, "no response within \(Int(timeout))s")
        }

        guard succeeded else {
            throw EnclaveKeyManager.mapSigningFailure(failure)
        }
        return PresenceResult(method: "touchid", at: Int64(Date().timeIntervalSince1970), context: context)
    }
}
