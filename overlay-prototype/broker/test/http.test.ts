/**
 * §1 (loopback + Origin), §7 (__tamper inside the broker) and §10 (never a 500
 * with a stack trace).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import { AuditChain } from "../src/audit.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import { createBrokerServer } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";
import { TAMPER_EXPECTATIONS } from "../src/tamper.ts";
import { makeTestKey, mintToken, samplePlan, NOW } from "./helpers.ts";

const ORIGIN = "app://2bme-backend";
const SECRET = "test-launch-secret";

const key = await makeTestKey();
const spki = Buffer.from(await crypto.subtle.exportKey("spki", key.publicKey)).toString("base64url");
const database = new DatabaseSync(":memory:");
const chain = new AuditChain(database);

const config = await loadConfig({
  host: "127.0.0.1",
  port: 0,
  allowed_origins: [ORIGIN],
  signer_public_key_spki_b64u: spki,
});
// loadConfig reads the secret from a 0600 file in production; injected here.
(config as { launchSecret: string | null }).launchSecret = SECRET;

const server = createBrokerServer({
  config,
  spent: new SqliteSpentStore(database),
  chain,
  now: () => NOW + 1,
});

let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1", "§1: loopback explicitly, never 0.0.0.0");
  base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-2bme-launch-secret": SECRET, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("a valid grant returns the §2 receipt shape", async () => {
  const plan = samplePlan();
  const response = await post({ token: await mintToken(key, plan), plan });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.deepEqual(
    Object.keys(receipt).filter((k) => k !== "tampered").sort(),
    ["audit_hash", "audit_index", "connector_result", "executed_at", "jti"],
  );
  assert.equal(receipt.connector_result.mode, "preview_only");
});

test("Origin must be present and allowlisted", async () => {
  const plan = samplePlan();
  const token = await mintToken(key, plan);

  for (const headers of [{ origin: "" }, { origin: "null" }, { origin: "http://evil.test" },
                         { origin: "http://127.0.0.1:4173" }]) {
    const response = await post({ token, plan }, headers as Record<string, string>);
    assert.equal(response.status, 403, `for origin ${JSON.stringify(headers)}`);
    assert.equal((await response.json()).error, "origin_rejected");
    assert.equal(response.headers.get("access-control-allow-origin"), null,
                 "a rejected caller learns nothing");
  }

  // A missing Origin header entirely.
  const bare = await fetch(`${base}/execute`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(bare.status, 403);
});

test("the launch secret is required even with a correct Origin", async () => {
  const plan = samplePlan();
  const response = await post({ token: await mintToken(key, plan), plan },
                              { "x-2bme-launch-secret": "wrong" });
  assert.equal(response.status, 403);
});

test("§10: malformed input gets an enumerated code, never a stack", async () => {
  const cases: [unknown, number][] = [
    ["not json at all", 400],
    [{ plan: samplePlan() }, 400],
    [{ token: {} }, 400],
    [{ token: null, plan: null }, 403],
  ];
  for (const [body, status] of cases) {
    const response = await post(body);
    assert.equal(response.status, status, `for ${JSON.stringify(body)}`);
    const text = await response.text();
    assert.doesNotMatch(text, /stack|at Object|\.ts:\d+/, "no stack in the body");
    const parsed = JSON.parse(text);
    assert.ok(typeof parsed.error === "string" && parsed.error.length > 0);
  }
});

test("a body over the cap is rejected without being parsed", async () => {
  const response = await post({ token: {}, plan: {}, padding: "x".repeat(70_000) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "malformed_request");
});

test("GET /execute is not found; the chain is readable", async () => {
  const notFound = await fetch(`${base}/execute`, { headers: { origin: ORIGIN, "x-2bme-launch-secret": SECRET } });
  assert.equal(notFound.status, 404);

  const chainResponse = await fetch(`${base}/audit/chain`, {
    headers: { origin: ORIGIN, "x-2bme-launch-secret": SECRET },
  });
  assert.equal(chainResponse.status, 200);
  const body = await chainResponse.json();
  assert.equal(body.verification.ok, true);
  assert.ok(body.entries.length > 0);
});

test("__tamper is applied inside the broker and rejected there", async () => {
  // §7: "The demo must show the broker rejecting something, not the UI declining
  // to send." Each request below carries a genuinely valid token.
  for (const [kind, expected] of Object.entries(TAMPER_EXPECTATIONS)) {
    const plan = samplePlan();
    const token = await mintToken(key, plan);
    const response = await post({ token, plan, __tamper: kind });
    assert.equal(response.status, 403, `${kind} should be rejected`);
    const body = await response.json();
    assert.equal(body.error, expected, `${kind} -> ${expected}`);
    assert.equal(body.tampered, kind, "the response names what the broker did to itself");
  }
});

test("the chain still verifies after all of that", async () => {
  assert.equal((await chain.verify()).ok, true);
});
