/**
 * §7: "Broker verification — fail closed, this exact order. Return on first
 * failure. Do no work before the signature check."
 *
 * Each step is a separate function so the test suite can reach every rejection
 * path directly. Nothing here throws: an unexpected failure becomes a
 * GrantErrorCode, because §10 forbids answering with a 500.
 */
import {
  AUDIENCE,
  CLAIMS_VERSION,
  IAT_SKEW_SECONDS,
  MAX_TTL_SECONDS,
  canonicalHash,
  canonicalize,
  base64urlDecode,
  isRegisteredPair,
} from "./contract.ts";
import type { GrantClaims, GrantErrorCode, GrantToken, Plan } from "./contract.ts";

export interface SpentStore {
  /** Atomic: inserts and reports whether this jti had already been seen. */
  burn(claims: GrantClaims): "burned" | "replayed";
  calls(jti: string): number;
  recordCall(jti: string): void;
}

export interface VerifyContext {
  now: number;
  publicKey: CryptoKey;
  /** base64url(SHA-256(SPKI DER)) of the configured key — §3's `iss`. */
  expectedIssuer: string;
  spent: SpentStore;
  /** Single-use is the rule; see MAX_CALLS_BY_RISK. */
  maxCallsHardCap: number;
  onCanonical?: (label: string, canonical: string, digest: string) => void;
}

export type StepResult = { ok: true } | { ok: false; code: GrantErrorCode; detail?: string };

const OK: StepResult = { ok: true };
const fail = (code: GrantErrorCode, detail?: string): StepResult => ({ ok: false, code, detail });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE64URL_64_BYTES = /^[A-Za-z0-9_-]{86}$/;

/**
 * §7 step 1, plus the `iss`/`aud` binding §3 defines and §7 never checks.
 * Without it a token minted for another audience, or by another key that the
 * broker also trusted, would verify.
 */
export function step1Shape(token: unknown, ctx: VerifyContext): StepResult {
  if (!isPlainObject(token)) return fail("signature_invalid", "token is not an object");
  if (token.alg !== "ES256") return fail("signature_invalid", "alg is not ES256");
  if (!isPlainObject(token.claims)) return fail("signature_invalid", "claims is not an object");
  if (typeof token.sig !== "string" || !BASE64URL_64_BYTES.test(token.sig)) {
    return fail("signature_invalid", "sig is not 64 base64url bytes");
  }

  const claims = token.claims as Record<string, unknown>;
  if (claims.v !== CLAIMS_VERSION) return fail("signature_invalid", "claims.v is not 1");
  if (claims.aud !== AUDIENCE) return fail("signature_invalid", "aud is not broker.local");
  if (claims.iss !== ctx.expectedIssuer) {
    return fail("signature_invalid", "iss does not match the configured public key");
  }
  if (typeof claims.jti !== "string" || claims.jti.length === 0) {
    return fail("signature_invalid", "jti is missing");
  }
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) {
    return fail("signature_invalid", "iat/exp are not integers");
  }
  if (typeof claims.plan_hash !== "string") return fail("signature_invalid", "plan_hash is missing");
  if (!isPlainObject(claims.scope)) return fail("signature_invalid", "scope is missing");

  const scope = claims.scope as Record<string, unknown>;
  if (typeof scope.connector !== "string" || typeof scope.operation !== "string" ||
      typeof scope.resource !== "string") {
    return fail("signature_invalid", "scope is incomplete");
  }
  if (!isPlainObject(scope.param_hashes)) return fail("signature_invalid", "param_hashes is missing");
  if (Object.values(scope.param_hashes).some((value) => typeof value !== "string")) {
    return fail("signature_invalid", "param_hashes holds a non-string");
  }
  if (!Number.isSafeInteger(scope.max_calls)) return fail("signature_invalid", "max_calls is not an integer");
  if (!isPlainObject(claims.presence)) return fail("signature_invalid", "presence is missing");
  if (typeof (claims.presence as Record<string, unknown>).method !== "string") {
    return fail("signature_invalid", "presence.method is missing");
  }
  if (typeof claims.risk !== "string") return fail("signature_invalid", "risk is missing");
  return OK;
}

/**
 * §7 step 2. Nothing derived from the claims is acted on before this passes —
 * in particular the jti is not burned, or an attacker could spend a legitimate
 * grant by submitting a forgery that carries its jti.
 */
export async function step2Signature(token: GrantToken, ctx: VerifyContext): Promise<StepResult> {
  try {
    const canonical = canonicalize(token.claims as never);
    if (ctx.onCanonical) {
      // §10: log the canonical string and its SHA-256 on both sides, so "do the
      // two canonical strings differ?" is answerable in ten seconds.
      ctx.onCanonical("claims", canonical, await canonicalHash(token.claims as never));
    }
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      ctx.publicKey,
      base64urlDecode(token.sig),
      new TextEncoder().encode(canonical),
    );
    return verified ? OK : fail("signature_invalid", "signature did not verify");
  } catch (error) {
    return fail("signature_invalid", `verification threw: ${(error as Error).message}`);
  }
}

/** §7 step 3. */
export function step3NotYetValid(claims: GrantClaims, ctx: VerifyContext): StepResult {
  return claims.iat <= ctx.now + IAT_SKEW_SECONDS ? OK : fail("not_yet_valid", "iat is in the future");
}

/**
 * §7 step 4. The second clause — exp - iat <= 300 — is a malformed TTL rather
 * than an expiry, but the spec gives it the same code and the UI has copy for
 * exactly these strings, so `expired` it stays.
 */
export function step4Expiry(claims: GrantClaims, ctx: VerifyContext): StepResult {
  if (ctx.now >= claims.exp) return fail("expired", "exp has passed");
  if (claims.exp - claims.iat > MAX_TTL_SECONDS) {
    return fail("expired", `ttl ${claims.exp - claims.iat}s exceeds the ${MAX_TTL_SECONDS}s cap`);
  }
  return OK;
}

/** §7 step 5. Atomic insert; the store checks memory and SQLite. */
export function step5Replay(claims: GrantClaims, ctx: VerifyContext): StepResult {
  return ctx.spent.burn(claims) === "burned" ? OK : fail("replayed", "jti already spent");
}

/** §7 step 6. */
export async function step6PlanHash(plan: unknown, claims: GrantClaims): Promise<StepResult> {
  try {
    const derived = await canonicalHash(plan as never);
    return derived === claims.plan_hash ? OK : fail("plan_mismatch", "plan hash disagrees");
  } catch (error) {
    // A float, a null or a lone surrogate in the submitted plan makes it
    // non-canonicalizable, so it cannot be the plan that was signed.
    return fail("plan_mismatch", `plan is not canonicalizable: ${(error as Error).message}`);
  }
}

/** §7 step 7. */
export function step7Registry(plan: Plan): StepResult {
  return isRegisteredPair(plan.connector, plan.operation)
    ? OK
    : fail("unknown_operation", `${plan.connector}:${plan.operation} is not registered`);
}

/**
 * §7 step 8, both clauses. "Step 8's second clause is the one implementations
 * omit. Without it a grant bound to {to, subject} still authorizes a call
 * carrying an added bcc."
 */
export async function step8Params(plan: Plan, claims: GrantClaims): Promise<StepResult> {
  const bound = claims.scope.param_hashes;
  const submitted = plan.params ?? {};

  for (const key of Object.keys(bound)) {
    if (!Object.hasOwn(submitted, key)) {
      return fail("param_mismatch", `missing:${key}`);
    }
    try {
      if ((await canonicalHash(submitted[key] as never)) !== bound[key]) {
        return fail("param_mismatch", `param:${key}`);
      }
    } catch (error) {
      return fail("param_mismatch", `param:${key} is not canonicalizable`);
    }
  }

  for (const key of Object.keys(submitted)) {
    if (!Object.hasOwn(bound, key)) {
      return fail("param_mismatch", `unbound:${key}`);
    }
  }
  return OK;
}

/**
 * §7 step 9. With single-use jti this is unreachable in practice — step 5 has
 * already burned it — so it stands as the spec's redundant assertion. The cap
 * clamps whatever the claims ask for, so the broker is correct even against a
 * token minted with a larger max_calls.
 */
export function step9CallBudget(claims: GrantClaims, ctx: VerifyContext): StepResult {
  const budget = Math.min(claims.scope.max_calls, ctx.maxCallsHardCap);
  return ctx.spent.calls(claims.jti) < budget
    ? OK
    : fail("call_budget_exhausted", `budget ${budget} exhausted`);
}

export type VerifyOutcome =
  | { ok: true; claims: GrantClaims }
  | { ok: false; code: GrantErrorCode; detail?: string; claims: GrantClaims | null; verified: boolean };

/**
 * Steps 1–9 in order, returning on first failure. `verified` says whether the
 * signature check passed, which is what tells the audit chain whether the jti
 * and iss it is about to record can be trusted at all.
 */
export async function verifyGrant(
  token: unknown,
  plan: unknown,
  ctx: VerifyContext,
): Promise<VerifyOutcome> {
  const unverifiedClaims = isPlainObject(token) && isPlainObject(token.claims)
    ? (token.claims as unknown as GrantClaims)
    : null;

  const shape = step1Shape(token, ctx);
  if (!shape.ok) return { ...shape, claims: unverifiedClaims, verified: false };

  const grant = token as GrantToken;
  const signature = await step2Signature(grant, ctx);
  if (!signature.ok) return { ...signature, claims: unverifiedClaims, verified: false };

  // Past this line the claims are authentic.
  const claims = grant.claims;

  const ordered: StepResult[] = [
    step3NotYetValid(claims, ctx),
    step4Expiry(claims, ctx),
    step5Replay(claims, ctx),
  ];
  for (const result of ordered) {
    if (!result.ok) return { ...result, claims, verified: true };
  }

  const planHash = await step6PlanHash(plan, claims);
  if (!planHash.ok) return { ...planHash, claims, verified: true };

  const registry = step7Registry(plan as Plan);
  if (!registry.ok) return { ...registry, claims, verified: true };

  const params = await step8Params(plan as Plan, claims);
  if (!params.ok) return { ...params, claims, verified: true };

  const budget = step9CallBudget(claims, ctx);
  if (!budget.ok) return { ...budget, claims, verified: true };

  return { ok: true, claims };
}
