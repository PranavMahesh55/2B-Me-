/**
 * §7 step 10 and §8: run the connector, append to the chain, return the receipt.
 * Every path appends -- "Rejected grants are recorded too. A chain containing
 * only successes proves nothing."
 */
import { AuditChain, UNKNOWN } from "./audit.ts";
import { ConnectorFailed, execute as runConnector, isRegistered } from "./connectors.ts";
import { applyTamper, isTamperKind } from "./tamper.ts";
import { verifyGrant } from "./verify.ts";
import type { GrantClaims, GrantErrorCode, Plan } from "./contract.ts";
import type { SpentStore } from "./verify.ts";

export interface ExecuteDeps {
  now: () => number;
  publicKey: CryptoKey;
  expectedIssuer: string;
  spent: SpentStore;
  chain: AuditChain;
  maxCallsHardCap: number;
  onCanonical?: (label: string, canonical: string, digest: string) => void;
}

export interface Receipt {
  jti: string;
  audit_index: number;
  audit_hash: string;
  connector_result: Record<string, unknown>;
  executed_at: number;
  tampered?: string;
}

export type ExecuteOutcome =
  | { ok: true; status: 200; body: Receipt }
  | { ok: false; status: number; body: { error: GrantErrorCode; message?: string; tampered?: string } };

/**
 * Only the fields §8 lists, and only from sources we can trust.
 *
 * Before step 2 passes, nothing in the token is authentic, so `jti` and `iss`
 * stay empty rather than carrying an attacker's strings into the chain. §8 has
 * no field for "these claims are unverified" and `canonicalize` throws on null,
 * so an empty string is how the chain says "not known". The raw attempt goes to
 * the log, not the ledger.
 */
function chainFields(
  claims: GrantClaims | null,
  verified: boolean,
  plan: unknown,
  outcome: "executed" | GrantErrorCode,
  at: number,
) {
  const submitted = (plan ?? {}) as Partial<Plan>;
  const scope = verified ? claims?.scope : undefined;
  return {
    jti: verified ? claims?.jti ?? UNKNOWN : UNKNOWN,
    iss: verified ? claims?.iss ?? UNKNOWN : UNKNOWN,
    connector: scope?.connector ?? (typeof submitted.connector === "string" ? submitted.connector : UNKNOWN),
    operation: scope?.operation ?? (typeof submitted.operation === "string" ? submitted.operation : UNKNOWN),
    resource: scope?.resource ?? (typeof submitted.resource === "string" ? submitted.resource : UNKNOWN),
    param_hashes: scope?.param_hashes ?? {},
    risk: verified ? claims?.risk ?? UNKNOWN : UNKNOWN,
    outcome,
    at,
  };
}

export async function executeGrant(
  rawToken: unknown,
  rawPlan: unknown,
  rawTamper: unknown,
  deps: ExecuteDeps,
): Promise<ExecuteOutcome> {
  let token = rawToken;
  let plan = rawPlan;
  let now = deps.now();
  let tampered: string | undefined;

  // §7: the mutation happens inside the broker, after receipt and before
  // verification, so the demo shows the broker rejecting rather than the UI
  // declining to send.
  if (rawTamper !== undefined && rawTamper !== null) {
    if (!isTamperKind(rawTamper)) {
      return { ok: false, status: 400, body: { error: "malformed_request", message: "unknown __tamper kind" } };
    }
    const result = applyTamper(rawTamper, token, plan);
    token = result.token;
    plan = result.plan;
    if (result.nowOverride !== undefined) now = result.nowOverride;
    tampered = rawTamper;
  }

  const outcome = await verifyGrant(token, plan, {
    now,
    publicKey: deps.publicKey,
    expectedIssuer: deps.expectedIssuer,
    spent: deps.spent,
    maxCallsHardCap: deps.maxCallsHardCap,
    onCanonical: deps.onCanonical,
  });

  const at = deps.now();

  if (!outcome.ok) {
    const entry = await deps.chain.append(chainFields(outcome.claims, outcome.verified, plan, outcome.code, at));
    return {
      ok: false,
      status: 403,
      body: { error: outcome.code, message: outcome.detail, tampered },
    };
  }

  const claims = outcome.claims;

  // A registry gap here would mean step 7 passed but nothing can run it.
  if (!isRegistered(claims.scope.connector, claims.scope.operation)) {
    await deps.chain.append(chainFields(claims, true, plan, "unknown_operation", at));
    return { ok: false, status: 403, body: { error: "unknown_operation", tampered } };
  }

  let connectorResult: Record<string, unknown>;
  try {
    connectorResult = await runConnector(plan as Plan, claims);
  } catch (error) {
    await deps.chain.append(chainFields(claims, true, plan, "connector_failed", at));
    return {
      ok: false,
      status: 502,
      body: {
        error: "connector_failed",
        message: error instanceof ConnectorFailed ? error.message : undefined,
        tampered,
      },
    };
  }

  deps.spent.recordCall(claims.jti);
  const entry = await deps.chain.append(chainFields(claims, true, plan, "executed", at));

  return {
    ok: true,
    status: 200,
    body: {
      jti: claims.jti,
      audit_index: entry.index,
      audit_hash: entry.hash,
      connector_result: connectorResult,
      executed_at: at,
      tampered,
    },
  };
}
