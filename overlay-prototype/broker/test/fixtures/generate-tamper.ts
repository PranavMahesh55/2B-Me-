#!/usr/bin/env node
/**
 * §9 step 6: "tamper.json: 6 mutated tokens -- each rejected with the expected
 * code."
 *
 * Six is a floor, and several codes cannot be produced by mutating a legitimate
 * token at all -- §7 returns on first failure, so any change to the claims dies
 * at the signature check and any change to the plan dies at the plan hash. These
 * are therefore MINTED: correctly signed tokens that are wrong in a specific,
 * chosen way. That needs an exportable key, which an Enclave key is not, so the
 * fixture carries its own software key.
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalHash } from "../../src/contract.ts";
import { NOW, baseClaims, makeTestKey, samplePlan, signClaims } from "../helpers.ts";

const out = new URL("../../../packages/grant/vectors/tamper.json", import.meta.url).pathname;
const regenerate = process.argv.includes("--regenerate");

if (existsSync(out) && !regenerate) {
  console.error(`Refusing to overwrite ${out}.`);
  console.error("techspecsigner.md §10: never edit the vector files to make a test pass.");
  process.exit(1);
}

const key = await makeTestKey();
const spki = Buffer.from(await crypto.subtle.exportKey("spki", key.publicKey)).toString("base64url");

const cases: unknown[] = [];
async function add(name: string, expected: string, note: string, build: () => Promise<{ token: unknown; plan: unknown }>) {
  const { token, plan } = await build();
  cases.push({ name, expected_error: expected, note, token, plan, now: NOW + 1 });
}

await add("sig_flipped", "signature_invalid", "one byte of the signature changed", async () => {
  const plan = samplePlan();
  const token = await signClaims(key, await baseClaims(key, plan));
  const sig = token.sig;
  return { token: { ...token, sig: (sig.startsWith("A") ? "B" : "A") + sig.slice(1) }, plan };
});

await add("alg_es384", "signature_invalid", "alg is not ES256, rejected at step 1 before any crypto", async () => {
  const plan = samplePlan();
  const token = await signClaims(key, await baseClaims(key, plan));
  return { token: { ...token, alg: "ES384" }, plan };
});

await add("aud_wrong", "signature_invalid", "correctly signed for a different audience; §7 never checks aud, so this is the added binding", async () => {
  const plan = samplePlan();
  return { token: await signClaims(key, await baseClaims(key, plan, { aud: "someone.else" } as never)), plan };
});

await add("iat_future", "not_yet_valid", "iat 600s ahead, well beyond the 5s skew allowance", async () => {
  const plan = samplePlan();
  return { token: await signClaims(key, await baseClaims(key, plan, { iat: NOW + 600, exp: NOW + 700 } as never)), plan };
});

await add("exp_past", "expired", "exp already behind the clock", async () => {
  const plan = samplePlan();
  return { token: await signClaims(key, await baseClaims(key, plan, { iat: NOW - 500, exp: NOW - 1 } as never)), plan };
});

await add("ttl_over_cap", "expired", "a 301s TTL: §7 step 4's second clause, a malformed claim the spec gives the expiry code", async () => {
  const plan = samplePlan();
  return { token: await signClaims(key, await baseClaims(key, plan, { iat: NOW, exp: NOW + 301 } as never)), plan };
});

await add("plan_hash_wrong", "plan_mismatch", "the submitted plan is not the one that was signed", async () => {
  const plan = samplePlan();
  const token = await signClaims(key, await baseClaims(key, plan));
  return { token, plan: { ...plan, resource: "workflow:somewhere-else" } };
});

await add("unknown_operation", "unknown_operation", "signed for an operation that is not in the registry", async () => {
  const plan = samplePlan({ connector: "mail", operation: "wire_transfer" } as never);
  return { token: await signClaims(key, await baseClaims(key, plan)), plan };
});

await add("under_bound_params", "param_mismatch", "§7 step 8's second clause: plan_hash covers bcc, scope.param_hashes does not bind it", async () => {
  const plan = samplePlan({ params: { to: "eng@example.com", subject: "deploy", bcc: "legal@example.com" } } as never);
  const claims = await baseClaims(key, plan);
  claims.scope.param_hashes = {
    to: await canonicalHash("eng@example.com"),
    subject: await canonicalHash("deploy"),
  };
  return { token: await signClaims(key, claims), plan };
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({
  version: 1,
  generator: "broker/test/fixtures/generate-tamper.ts",
  key: {
    note: "TEST KEY -- software P-256, not the Enclave key. Several of these cases require minting a correctly signed but deliberately wrong token, which an Enclave key cannot do.",
    spki_der_b64url: spki,
    iss: key.issuer,
  },
  cases,
}, null, 2)}\n`);

console.log(`wrote ${cases.length} tamper cases to ${out}`);
