/**
 * Test-only token minting with a software P-256 key.
 *
 * §7 step 8's second clause is only reachable with a token whose
 * `scope.param_hashes` binds fewer params than `plan_hash` covers. A caller
 * cannot produce that by tampering -- adding a param to the submitted plan
 * changes the plan hash and dies at step 6 -- so the suite has to be able to
 * mint deliberately wrong but correctly signed tokens. That needs an exportable
 * key, which the Enclave by definition is not.
 */
import { DatabaseSync } from "node:sqlite";
import { base64url, base64urlDecode, canonicalHash, canonicalize, sha256 } from "../src/contract.ts";
import type { GrantClaims, Plan } from "../src/contract.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import type { VerifyContext } from "../src/verify.ts";

export interface TestKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  issuer: string;
}

export async function makeTestKey(): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, issuer: base64url(await sha256(spki)) };
}

export const NOW = 1_758_300_000;

export function samplePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    connector: "mail",
    operation: "draft_response",
    resource: "workflow:wf_7f3a",
    params: { destination: "preview_only", subject: "deploy is green" },
    ...overrides,
  } as Plan;
}

export async function baseClaims(key: TestKey, plan: Plan, overrides: Partial<GrantClaims> = {}) {
  const paramHashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(plan.params)) {
    paramHashes[name] = await canonicalHash(value as never);
  }
  const claims: GrantClaims = {
    v: 1,
    iss: key.issuer,
    aud: "broker.local",
    jti: base64url(crypto.getRandomValues(new Uint8Array(16))),
    iat: NOW,
    exp: NOW + 120,
    plan_hash: await canonicalHash(plan as never),
    scope: {
      connector: plan.connector,
      operation: plan.operation,
      resource: plan.resource,
      param_hashes: paramHashes,
      max_calls: 1,
    },
    presence: { method: "touchid", at: NOW - 2 },
    risk: "medium",
    ...overrides,
  } as GrantClaims;
  return claims;
}

export async function signClaims(key: TestKey, claims: GrantClaims, alg = "ES256") {
  const canonical = canonicalize(claims as never);
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(canonical),
  ));
  return { claims, sig: base64url(raw), alg };
}

export async function mintToken(key: TestKey, plan: Plan, overrides: Partial<GrantClaims> = {}) {
  return signClaims(key, await baseClaims(key, plan, overrides));
}

export function makeContext(key: TestKey, extra: Partial<VerifyContext> = {}): VerifyContext {
  return {
    now: NOW + 1,
    publicKey: key.publicKey,
    expectedIssuer: key.issuer,
    spent: new SqliteSpentStore(new DatabaseSync(":memory:")),
    maxCallsHardCap: 1,
    ...extra,
  };
}

export { base64urlDecode };
