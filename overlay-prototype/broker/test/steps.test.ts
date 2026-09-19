/**
 * §7's rejection paths, one test per reachable code, plus the fail-closed
 * properties the ordering is supposed to guarantee.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../src/contract.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import { verifyGrant } from "../src/verify.ts";
import { NOW, baseClaims, makeContext, makeTestKey, mintToken, samplePlan, signClaims } from "./helpers.ts";

const key = await makeTestKey();

async function reject(token: unknown, plan: unknown, extra = {}) {
  const outcome = await verifyGrant(token, plan, makeContext(key, extra));
  assert.equal(outcome.ok, false, "expected a rejection");
  return outcome as { code: string; detail?: string; verified: boolean };
}

test("a valid token passes every step", async () => {
  const plan = samplePlan();
  assert.equal((await verifyGrant(await mintToken(key, plan), plan, makeContext(key))).ok, true);
});

test("signature_invalid: a flipped signature byte", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);
  const flipped = token.sig.startsWith("A") ? "B" + token.sig.slice(1) : "A" + token.sig.slice(1);
  assert.equal((await reject({ ...token, sig: flipped }, plan)).code, "signature_invalid");
});

test("signature_invalid: alg, v, aud and iss are all bound", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);

  assert.equal((await reject({ ...token, alg: "ES384" }, plan)).code, "signature_invalid");

  for (const override of [{ v: 2 }, { aud: "somewhere.else" }, { iss: "another-key" }]) {
    // Signed correctly, so this is step 1 doing its job, not a signature failure.
    const claims = await baseClaims(key, plan, override as never);
    const signed = await signClaims(key, claims);
    const outcome = await reject(signed, plan);
    assert.equal(outcome.code, "signature_invalid", `for ${JSON.stringify(override)}`);
  }
});

test("not_yet_valid: iat beyond the 5s skew allowance", async () => {
  const plan = samplePlan();
  const token = await signClaims(key, await baseClaims(key, plan, { iat: NOW + 600, exp: NOW + 700 } as never));
  assert.equal((await reject(token, plan)).code, "not_yet_valid");
});

test("expired: exp in the past, and a TTL over the 300s cap", async () => {
  const plan = samplePlan();

  const past = await signClaims(key, await baseClaims(key, plan, { iat: NOW - 500, exp: NOW - 1 } as never));
  assert.equal((await reject(past, plan)).code, "expired");

  // §7 step 4's second clause. A 301s TTL is a malformed claim rather than an
  // expiry, but the spec gives it the same code.
  const tooLong = await signClaims(key, await baseClaims(key, plan, { iat: NOW, exp: NOW + 301 } as never));
  assert.equal((await reject(tooLong, plan)).code, "expired");
});

test("replayed: the same jti twice", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);
  const ctx = makeContext(key);
  assert.equal((await verifyGrant(token, plan, ctx)).ok, true);
  const second = await verifyGrant(token, plan, ctx);
  assert.equal((second as { code: string }).code, "replayed");
});

test("replayed: survives a broker restart, which is when it matters most", async () => {
  const database = new DatabaseSync(":memory:");
  const plan = samplePlan();
  const token = await mintToken(key, plan);

  const before = new SqliteSpentStore(database);
  assert.equal((await verifyGrant(token, plan, makeContext(key, { spent: before }))).ok, true);

  // A fresh store over the same file: memory is empty, SQLite is not.
  const after = new SqliteSpentStore(database);
  assert.equal(after.warm(NOW), 1, "warm() reloads the unexpired jti");
  const replay = await verifyGrant(token, plan, makeContext(key, { spent: after }));
  assert.equal((replay as { code: string }).code, "replayed");
});

test("plan_mismatch: the submitted plan differs from the signed one", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);
  assert.equal((await reject(token, { ...plan, resource: "workflow:someone_elses" })).code, "plan_mismatch");
});

test("plan_mismatch: a non-canonicalizable plan cannot be the signed one", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);
  // §4 makes the canonicalizer throw on a float rather than coerce it.
  const outcome = await reject(token, { ...plan, params: { ...plan.params, count: 1.5 } });
  assert.equal(outcome.code, "plan_mismatch");
});

test("unknown_operation: an unregistered (connector, operation) pair", async () => {
  const plan = samplePlan({ connector: "mail", operation: "wire_transfer" } as never);
  const token = await mintToken(key, plan);
  assert.equal((await reject(token, plan)).code, "unknown_operation");
});

test("param_mismatch: a bound param whose value changed", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);
  // Re-point plan_hash at the mutated plan so step 6 passes and step 8 is reached.
  const mutated = { ...plan, params: { ...plan.params, subject: "deploy is on fire" } };
  const claims = await baseClaims(key, plan, { plan_hash: await canonicalHash(mutated as never) } as never);
  assert.equal((await reject(await signClaims(key, claims), mutated)).code, "param_mismatch");
});

test("param_mismatch: an UNBOUND extra param -- the clause §7 says is omitted", async () => {
  // "Without it a grant bound to {to, subject} still authorizes a call carrying
  // an added bcc." This cannot be produced by tampering: adding bcc to the
  // submitted plan changes the plan hash and dies at step 6. It needs a token
  // whose plan_hash covers bcc while scope.param_hashes does not bind it.
  const plan = samplePlan({ params: { to: "eng@example.com", subject: "deploy", bcc: "legal@example.com" } } as never);
  const claims = await baseClaims(key, plan);
  claims.scope.param_hashes = {
    to: await canonicalHash("eng@example.com"),
    subject: await canonicalHash("deploy"),
  };
  const outcome = await reject(await signClaims(key, claims), plan);
  assert.equal(outcome.code, "param_mismatch");
  assert.equal(outcome.detail, "unbound:bcc");
});

test("param_mismatch: a bound param the submitted plan omits", async () => {
  const plan = samplePlan();
  const claims = await baseClaims(key, plan);
  const stripped = { ...plan, params: { destination: "preview_only" } };
  claims.plan_hash = await canonicalHash(stripped as never);
  const outcome = await reject(await signClaims(key, claims), stripped);
  assert.equal(outcome.code, "param_mismatch");
  assert.equal(outcome.detail, "missing:subject");
});

test("call_budget_exhausted: reachable only with max_calls 0", async () => {
  // With single-use jti, step 5 burns the token before step 9 can ever fire, so
  // step 9 is the spec's redundant assertion. A zero budget is the one way in.
  const plan = samplePlan();
  const claims = await baseClaims(key, plan);
  claims.scope.max_calls = 0;
  assert.equal((await reject(await signClaims(key, claims), plan)).code, "call_budget_exhausted");
});

test("a claimed max_calls above the cap is clamped, not honoured", async () => {
  const plan = samplePlan();
  const claims = await baseClaims(key, plan);
  claims.scope.max_calls = 5; // what §3's table would have produced for low risk
  const token = await signClaims(key, claims);
  const ctx = makeContext(key);
  assert.equal((await verifyGrant(token, plan, ctx)).ok, true);
  assert.equal((await verifyGrant(token, plan, ctx) as { code: string }).code, "replayed");
});

test("an unverified token cannot burn a legitimate jti", async () => {
  // The reason §7 puts the signature check before the spent-set insert: otherwise
  // anyone could spend someone else's grant by submitting a forgery carrying it.
  const plan = samplePlan();
  const real = await mintToken(key, plan);
  const ctx = makeContext(key);

  const forgery = { ...real, sig: ("A".repeat(86)) };
  assert.equal((await reject(forgery, plan, { spent: ctx.spent })).verified, false);

  assert.equal((await verifyGrant(real, plan, ctx)).ok, true, "the real token still works");
});
