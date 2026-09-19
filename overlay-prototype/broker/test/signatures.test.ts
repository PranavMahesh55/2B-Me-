/**
 * §9 step 5: "Broker steps 1-9 against signatures.json -- all 500 verify."
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { base64urlDecode } from "../src/contract.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import { verifyGrant } from "../src/verify.ts";

const VECTORS = new URL("../../packages/grant/vectors/signatures.json", import.meta.url);

test("all 500 Enclave signatures pass steps 1-9", async () => {
  const file = JSON.parse(await readFile(VECTORS, "utf8"));
  assert.equal(file.cases.length, 500, "§6 asks for 500");

  const der = base64urlDecode(file.key.spki_der_b64url);
  const publicKey = await crypto.subtle.importKey(
    "spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const spent = new SqliteSpentStore(new DatabaseSync(":memory:"));

  let passed = 0;
  for (const testCase of file.cases) {
    const outcome = await verifyGrant(
      { claims: testCase.claims, sig: testCase.sig_b64url, alg: file.alg },
      testCase.plan,
      {
        // Each case carries its own clock, so a vector never expires.
        now: testCase.now,
        publicKey,
        expectedIssuer: file.key.iss,
        spent,
        maxCallsHardCap: 1,
      },
    );
    if (!outcome.ok) {
      assert.fail(`case ${testCase.i} rejected: ${outcome.code} (${outcome.detail})`);
    }
    passed += 1;
  }
  assert.equal(passed, 500);
});

test("every signature decodes to exactly 64 raw bytes", async () => {
  const file = JSON.parse(await readFile(VECTORS, "utf8"));
  // §6: a single-signature test passes ~255 times out of 256 and tells you nothing.
  const lengths = new Set(file.cases.map((c: { sig_b64url: string }) => base64urlDecode(c.sig_b64url).length));
  assert.deepEqual([...lengths], [64]);
});

test("replaying a vector is caught by the spent store", async () => {
  const file = JSON.parse(await readFile(VECTORS, "utf8"));
  const der = base64urlDecode(file.key.spki_der_b64url);
  const publicKey = await crypto.subtle.importKey(
    "spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const spent = new SqliteSpentStore(new DatabaseSync(":memory:"));
  const first = file.cases[0];
  const ctx = { now: first.now, publicKey, expectedIssuer: file.key.iss, spent, maxCallsHardCap: 1 };

  assert.equal((await verifyGrant({ claims: first.claims, sig: first.sig_b64url, alg: "ES256" }, first.plan, ctx)).ok, true);
  const replay = await verifyGrant({ claims: first.claims, sig: first.sig_b64url, alg: "ES256" }, first.plan, ctx);
  assert.equal(replay.ok, false);
  assert.equal((replay as { code: string }).code, "replayed");
});
