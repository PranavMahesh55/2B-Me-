/**
 * The grant contract. Frozen once generated — see techspecsigner.md §10.
 *
 * Deliberately free of `enum`, `namespace` and decorators so the broker can run
 * these files directly under Node's type stripping, with no build step and no
 * dependencies.
 */

/** The JSON subset the canonicalizer accepts. No null, no floats — see §4. */
export type JsonValue =
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Risk = "low" | "medium" | "high";

/** §3: exp = iat + TTL_BY_RISK[risk], in seconds. */
export const TTL_BY_RISK: Record<Risk, number> = {
  low: 300,
  medium: 120,
  high: 60,
};

/**
 * §3 gives low: 5, but §7 step 5 burns the jti on first use and returns
 * `replayed` on any reappearance, which makes any value above 1 unreachable.
 * Single-use is the rule; the field stays for forward compatibility.
 */
export const MAX_CALLS_BY_RISK: Record<Risk, number> = {
  low: 1,
  medium: 1,
  high: 1,
};

/** AutomationPlan.safety_level (1 = preview-only) maps onto the spec's risk. */
export const RISK_BY_SAFETY_LEVEL: Record<number, Risk> = {
  1: "low",
  2: "medium",
  3: "high",
};

/**
 * The operation registry — §7 step 7 checks the (connector, operation) pair.
 *
 * These are the prototype's own ALLOWED_ACTIONS from
 * backend/app/automation/service.py, not the spec's illustrative Slack example.
 * `permission` ties each operation back to ALLOWED_PERMISSIONS so a plan's
 * required_permissions stays derivable.
 */
export const OPERATIONS = {
  open_application: {
    connector: "desktop",
    permission: "open_application",
    description: "Open an application",
  },
  prepare_context: {
    connector: "workflow",
    permission: "read_active_window",
    description: "Prepare workflow context",
  },
  draft_response: {
    connector: "mail",
    permission: "draft_email",
    description: "Draft a response for review",
  },
} as const;

export type Operation = keyof typeof OPERATIONS;
export type Connector = (typeof OPERATIONS)[Operation]["connector"];

export function isOperation(value: unknown): value is Operation {
  return typeof value === "string" && Object.hasOwn(OPERATIONS, value);
}

/** True only when the pair is registered — §7 step 7. */
export function isRegisteredPair(connector: string, operation: string): boolean {
  return isOperation(operation) && OPERATIONS[operation].connector === connector;
}

export interface Plan {
  connector: Connector;
  operation: Operation;
  resource: string;
  params: Record<string, JsonValue>;
}

export interface GrantScope {
  connector: Connector;
  operation: Operation;
  resource: string;
  /** key -> base64url(SHA-256(canonicalize(value))) */
  param_hashes: Record<string, string>;
  max_calls: number;
}

export interface GrantPresence {
  method: "touchid";
  /** unix seconds at which LAContext succeeded */
  at: number;
}

export interface GrantClaims {
  v: 1;
  /** base64url(SHA-256(public key in SPKI DER)) */
  iss: string;
  aud: "broker.local";
  /** base64url(16 random bytes) */
  jti: string;
  iat: number;
  exp: number;
  /** base64url(SHA-256(canonicalize(plan))) */
  plan_hash: string;
  scope: GrantScope;
  presence: GrantPresence;
  risk: Risk;
}

export interface GrantToken {
  claims: GrantClaims;
  /** base64url of raw r||s, exactly 64 bytes — §6 */
  sig: string;
  alg: "ES256";
}

export const AUDIENCE = "broker.local";
export const CLAIMS_VERSION = 1;
/** §7 step 4's upper bound on exp - iat. */
export const MAX_TTL_SECONDS = 300;
/** §7 step 3's clock-skew allowance. */
export const IAT_SKEW_SECONDS = 5;

/** Reachable on POST 127.0.0.1:8787/grant — §2. */
export const SIGNER_ERROR_CODES = [
  "presence_cancelled",
  "presence_failed",
  "key_missing",
  "biometry_changed",
  "unknown_operation",
] as const;

/** Reachable on POST 127.0.0.1:8788/execute — §2. */
export const BROKER_ERROR_CODES = [
  "signature_invalid",
  "expired",
  "not_yet_valid",
  "replayed",
  "plan_mismatch",
  "unknown_operation",
  "param_mismatch",
  "call_budget_exhausted",
  "connector_failed",
] as const;

/**
 * §2 enumerates no code for an unparseable body, a missing field, or the
 * float/null that §4 requires the canonicalizer to throw on — while §10 forbids
 * answering with a 500. Both ports can return this one.
 */
export const SHARED_ERROR_CODES = ["malformed_request"] as const;

export type SignerErrorCode = (typeof SIGNER_ERROR_CODES)[number];
export type BrokerErrorCode = (typeof BROKER_ERROR_CODES)[number];
export type SharedErrorCode = (typeof SHARED_ERROR_CODES)[number];
export type GrantErrorCode = SignerErrorCode | BrokerErrorCode | SharedErrorCode;

export const ALL_ERROR_CODES: readonly GrantErrorCode[] = [
  ...SIGNER_ERROR_CODES,
  ...BROKER_ERROR_CODES,
  ...SHARED_ERROR_CODES,
];

export interface GrantErrorResponse {
  error: GrantErrorCode;
  message?: string;
}

/** The tamper kinds the broker applies to itself for the demo — §7. */
export const TAMPER_KINDS = ["resource", "param", "exp", "sig"] as const;
export type TamperKind = (typeof TAMPER_KINDS)[number];
