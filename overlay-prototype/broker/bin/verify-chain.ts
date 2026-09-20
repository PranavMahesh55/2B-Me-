#!/usr/bin/env node
/**
 * §8: "broker/bin/verify-chain recomputes every link and exits non-zero on the
 * first break."
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { AuditChain } from "../src/audit.ts";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : (process.env.BROKER_AUDIT_DB ?? "./data/audit.db");
const asJSON = args.includes("--json");

if (!existsSync(dbPath)) {
  console.error(`no audit database at ${dbPath}`);
  process.exit(2);
}

const chain = new AuditChain(new DatabaseSync(dbPath));
const result = await chain.verify();

if (asJSON) {
  console.log(JSON.stringify(result));
} else if (result.ok) {
  console.log(`chain ok - ${result.count} entries, head=${result.head ?? "(empty)"}`);
} else {
  console.error(`chain BROKEN at index ${result.index}: ${result.reason}`);
}
process.exit(result.ok ? 0 : 1);
