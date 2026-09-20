/** §8 and §9 step 7: the chain verifies after 20 grants, and detects tampering. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuditChain, GENESIS_PREV_HASH } from "../src/audit.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import { executeGrant } from "../src/execute.ts";
import { makeContext, makeTestKey, mintToken, samplePlan, NOW } from "./helpers.ts";

const VERIFY_CHAIN = new URL("../bin/verify-chain.ts", import.meta.url).pathname;

async function twentyGrants(dbPath: string) {
  const key = await makeTestKey();
  const database = new DatabaseSync(dbPath);
  const spent = new SqliteSpentStore(database);
  const chain = new AuditChain(database);
  const deps = {
    now: () => NOW + 1,
    publicKey: key.publicKey,
    expectedIssuer: key.issuer,
    spent,
    chain,
    maxCallsHardCap: 1,
  };

  let executed = 0;
  let rejected = 0;
  for (let i = 0; i < 20; i += 1) {
    const plan = samplePlan({ resource: `workflow:wf_${i}` } as never);
    const token = await mintToken(key, plan);
    // Interleave failures, so the chain is not a wall of successes.
    const outcome = i % 3 === 1
      ? await executeGrant(token, { ...plan, resource: "elsewhere" }, undefined, deps)
      : await executeGrant(token, plan, undefined, deps);
    if (outcome.ok) executed += 1;
    else rejected += 1;
  }
  return { chain, executed, rejected, database };
}

test("the chain verifies after 20 grants, successes and rejections alike", async () => {
  const dir = mkdtempSync(join(tmpdir(), "2bme-chain-"));
  const dbPath = join(dir, "audit.db");
  const { chain, executed, rejected } = await twentyGrants(dbPath);

  assert.equal(executed + rejected, 20);
  assert.ok(rejected > 0, "§8: a chain containing only successes proves nothing");

  const result = await chain.verify();
  assert.equal(result.ok, true);
  assert.equal((result as { count: number }).count, 20);
  assert.equal(chain.rows()[0].prev_hash, GENESIS_PREV_HASH, "§8: entry 0's prev_hash is 32 zero bytes");

  const cli = spawnSync(process.execPath, [VERIFY_CHAIN, "--db", dbPath], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /chain ok - 20 entries/);
});

test("the table refuses updates and deletes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "2bme-chain-"));
  const dbPath = join(dir, "audit.db");
  const { database } = await twentyGrants(dbPath);

  assert.throws(() => database.prepare("UPDATE audit_chain SET resource = 'x' WHERE idx = 7").run(),
                /append-only/);
  assert.throws(() => database.prepare("DELETE FROM audit_chain WHERE idx = 7").run(),
                /append-only/);
  assert.throws(() => database.prepare(
    "INSERT INTO audit_chain (idx, prev_hash, jti, iss, connector, operation, resource, param_hashes, risk, outcome, at, hash) VALUES (99,'','','','','','','{}','','executed',0,'')",
  ).run(), /non-sequential/);
});

test("verify-chain exits non-zero when an entry is modified behind the triggers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "2bme-chain-"));
  const dbPath = join(dir, "audit.db");
  await twentyGrants(dbPath);

  // The triggers stop the broker's own bugs and casual edits; they do not stop
  // someone who can drop them. The hash chain is the evidence, verify-chain the
  // detector -- which is exactly what this proves.
  const copy = join(dir, "tampered.db");
  copyFileSync(dbPath, copy);
  const database = new DatabaseSync(copy);
  database.exec("DROP TRIGGER audit_chain_no_update");
  database.prepare("UPDATE audit_chain SET resource = 'workflow:injected' WHERE idx = 7").run();
  database.close();

  const cli = spawnSync(process.execPath, [VERIFY_CHAIN, "--db", copy], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /chain BROKEN at index 7/);
});

test("reordering two entries is detected, because index and prev_hash are hashed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "2bme-chain-"));
  const dbPath = join(dir, "audit.db");
  await twentyGrants(dbPath);

  const copy = join(dir, "swapped.db");
  copyFileSync(dbPath, copy);
  const database = new DatabaseSync(copy);
  database.exec("DROP TRIGGER audit_chain_no_update");
  const rows = database.prepare("SELECT idx, resource FROM audit_chain WHERE idx IN (4,5) ORDER BY idx").all() as
    { idx: number; resource: string }[];
  database.prepare("UPDATE audit_chain SET resource = ? WHERE idx = 4").run(rows[1].resource);
  database.prepare("UPDATE audit_chain SET resource = ? WHERE idx = 5").run(rows[0].resource);
  database.close();

  const cli = spawnSync(process.execPath, [VERIFY_CHAIN, "--db", copy], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /chain BROKEN at index 4/);
});
