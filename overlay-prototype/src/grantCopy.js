// Shared by the overlay consent card and the dashboard workflow builder.
// Both can surface the same GrantErrorCode, and a raw developer string in one
// of them ("no response within 60s") is not what the other shows for the very
// same failure.
/**
 * One entry per GrantErrorCode the UI can receive. §5 is explicit that
 * biometry_changed needs copy of its own -- "try again" is wrong advice when the
 * key is gone -- and connector_failed must not read like a denial, because the
 * authorization succeeded and only the action failed.
 */
export const GRANT_COPY = {
  presence_cancelled: { title: "Authorization cancelled", body: "Nothing ran.", retry: true },
  presence_failed: { title: "Touch ID didn't recognise you", body: "Try again.", retry: true },
  biometry_changed: {
    title: "Your fingerprint enrolment changed",
    body: "The signing key on this Mac was invalidated the moment Touch ID enrolment changed. That is deliberate. It has to be re-created before anything can be authorized.",
    retry: false,
  },
  key_missing: { title: "No signing key on this Mac", body: "2Bᵐᵉ will create one the next time the signer starts.", retry: false },
  unknown_operation: { title: "Not an approved operation", body: "This action isn't in the allowed list, so 2Bᵐᵉ won't sign it.", retry: false },
  malformed_request: { title: "2Bᵐᵉ couldn't build a valid request", body: "Nothing was authorized.", retry: false },
  signature_invalid: { title: "The authorization didn't verify", body: "Nothing ran. The broker could not confirm this came from your Mac's key.", retry: false },
  expired: { title: "That authorization expired", body: "Authorizations are deliberately short-lived. Authorize again.", retry: true },
  not_yet_valid: { title: "Clock mismatch", body: "Your Mac and the broker disagree about the time. Nothing ran.", retry: false },
  replayed: { title: "Already used", body: "Each authorization signs exactly one action.", retry: true },
  plan_mismatch: { title: "The action changed after you authorized it", body: "The broker refused it. Nothing ran.", retry: true },
  param_mismatch: { title: "The action carried details you never authorized", body: "The broker refused it. Nothing ran.", retry: true },
  call_budget_exhausted: { title: "That authorization is spent", body: "Authorize again.", retry: true },
  connector_failed: { title: "You authorized it \u2014 the action failed", body: "The authorization was valid; the action itself did not complete.", retry: true },
  broker_unavailable: { title: "The local broker isn't running", body: "Nothing ran. Start it and try again.", retry: true },
  signer_unavailable: { title: "Open the desktop app to authorize", body: "A browser preview can't reach this Mac's signing key.", retry: false },
};

export function grantCopy(code) {
  // Any code the UI does not recognise still declines safely.
  return GRANT_COPY[code] || { title: "Authorization declined", body: `Nothing ran (${code}).`, retry: false };
}
