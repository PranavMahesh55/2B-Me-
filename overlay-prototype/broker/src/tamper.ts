/**
 * §7: "The `__tamper` field mutates the token or plan **inside the broker**,
 * after receipt and before verification, then runs the normal path. The demo
 * must show the broker rejecting something, not the UI declining to send."
 *
 * Two of the four kinds cannot mean what they sound like, because §7 returns on
 * first failure:
 *
 *   - Mutating `claims.exp` breaks the signature, so it dies at step 2 as
 *     `signature_invalid` and never reaches the expiry check. To demonstrate
 *     step 4 honestly, "exp" moves the broker's clock instead -- still a
 *     mutation inside the broker, and it genuinely reaches `expired`.
 *   - Mutating a param changes the plan hash, so it dies at step 6 as
 *     `plan_mismatch`, not `param_mismatch`. Step 8 is only reachable with a
 *     token that under-binds its params, which a caller cannot produce; that
 *     case lives in the tamper.json fixture instead.
 */
import { TAMPER_KINDS } from "./contract.ts";
import type { GrantErrorCode, TamperKind } from "./contract.ts";

export interface TamperResult {
  token: unknown;
  plan: unknown;
  nowOverride?: number;
  note: string;
}

/** What each kind actually produces, asserted by the tests and shown in the demo. */
export const TAMPER_EXPECTATIONS: Record<TamperKind, GrantErrorCode> = {
  resource: "plan_mismatch",
  param: "plan_mismatch",
  exp: "expired",
  sig: "signature_invalid",
};

export function isTamperKind(value: unknown): value is TamperKind {
  return typeof value === "string" && (TAMPER_KINDS as readonly string[]).includes(value);
}

export function applyTamper(kind: TamperKind, token: unknown, plan: unknown): TamperResult {
  const t = structuredClone(token) as Record<string, never>;
  const p = structuredClone(plan) as Record<string, never>;

  switch (kind) {
    case "resource": {
      (p as Record<string, unknown>).resource = "workflow:somewhere-else";
      return { token: t, plan: p, note: "broker rewrote plan.resource before verifying" };
    }
    case "param": {
      const params = ((p as Record<string, unknown>).params ?? {}) as Record<string, unknown>;
      const key = Object.keys(params)[0];
      if (key) params[key] = `${String(params[key])} (tampered)`;
      else params.injected = "tampered";
      (p as Record<string, unknown>).params = params;
      return { token: t, plan: p, note: "broker rewrote a plan param before verifying" };
    }
    case "exp": {
      const claims = (t as Record<string, unknown>).claims as { exp?: number } | undefined;
      const beyond = typeof claims?.exp === "number" ? claims.exp + 1 : Math.floor(Date.now() / 1000);
      return {
        token: t, plan: p, nowOverride: beyond,
        note: "broker moved its own clock past exp (mutating exp would only break the signature)",
      };
    }
    case "sig": {
      const sig = String((t as Record<string, unknown>).sig ?? "");
      (t as Record<string, unknown>).sig = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
      return { token: t, plan: p, note: "broker flipped a signature byte before verifying" };
    }
  }
}
