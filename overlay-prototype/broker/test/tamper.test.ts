/** §9 step 6: each mutated token rejected with the expected code. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { base64urlDecode } from "../src/contract.ts";
import { AuditChain } from "../src/audit.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import { executeGrant } from "../src/execute.ts";

const FIXTURE = new URL("../../packages/grant/vectors/tamper.json", import.meta.url);

test("every tamper.json case is rejected with its expected code, and recorded", async (t) => {
  const file = JSON.parse(await readFile(FIXTURE, "utf8"));
  assert.ok(file.cases.length >= 6, "§9 step 6 asks for at least 6");

  const der = base64urlDecode(file.key.spki_der_b64url);
  const publicKey = await crypto.subtle.importKey(
    "spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const database = new DatabaseSync(":memory:");
  const spent = new SqliteSpentStore(database);
  const chain = new AuditChain(database);

  for (const testCase of file.cases) {
    await t.test(`${testCase.name} -> ${testCase.expected_error}`, async () => {
      const before = chain.head()?.index ?? -1;
      const outcome = await executeGrant(testCase.token, testCase.plan, undefined, {
        now: () => testCase.now,
        publicKey,
        expectedIssuer: file.key.iss,
        spent,
        chain,
        maxCallsHardCap: 1,
      });
      assert.equal(outcome.ok, false, testCase.note);
      assert.equal((outcome.body as { error: string }).error, testCase.expected_error);
      // §8: rejected grants are recorded too.
      assert.equal(chain.head()?.index, before + 1, "a rejection must still append");
    });
  }

  assert.equal((await chain.verify()).ok, true, "the chain of rejections still verifies");
});

test("an unverified rejection never writes attacker-supplied jti or iss", async () => {
  const file = JSON.parse(await readFile(FIXTURE, "utf8"));
  const der = base64urlDecode(file.key.spki_der_b64url);
  const publicKey = await crypto.subtle.importKey(
    "spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const database = new DatabaseSync(":memory:");
  const chain = new AuditChain(database);

  const flipped = file.cases.find((c: { name: string }) => c.name === "sig_flipped");
  await executeGrant(flipped.token, flipped.plan, undefined, {
    now: () => flipped.now,
    publicKey,
    expectedIssuer: file.key.iss,
    spent: new SqliteSpentStore(database),
    chain,
    maxCallsHardCap: 1,
  });

  const [row] = chain.rows();
  assert.equal(row.outcome, "signature_invalid");
  assert.equal(row.jti, "", "the token's jti was never verified, so it is not recorded as fact");
  assert.equal(row.iss, "");
  // A verified rejection, by contrast, does carry them.
  const expired = file.cases.find((c: { name: string }) => c.name === "exp_past");
  await executeGrant(expired.token, expired.plan, undefined, {
    now: () => expired.now,
    publicKey,
    expectedIssuer: file.key.iss,
    spent: new SqliteSpentStore(database),
    chain,
    maxCallsHardCap: 1,
  });
  const verifiedRow = chain.rows()[1];
  assert.equal(verifiedRow.outcome, "expired");
  assert.notEqual(verifiedRow.jti, "", "past step 2 the claims are authentic");
});
