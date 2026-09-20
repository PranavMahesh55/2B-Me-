#!/usr/bin/env node
/**
 * §8: "broker/bin/verify-chain recomputes every link and exits non-zero on the
 * first break."
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditChain } from "../src/audit.ts";
import { loadConfigFile } from "../src/config.ts";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const asJSON = args.includes("--json");

const brokerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Follow the same config the broker runs with, rather than guessing a path
 *  relative to whatever directory npm happened to start in. */
function resolveDbPath(): string {
  if (dbIndex >= 0) return args[dbIndex + 1];
  if (process.env.BROKER_AUDIT_DB) return process.env.BROKER_AUDIT_DB;
  const configPath = process.env.BROKER_CONFIG ?? resolve(brokerDir, "config/broker.config.json");
  try {
    const configured = loadConfigFile(configPath).audit_db_path;
    if (configured) return resolve(dirname(configPath), "..", configured.replace(/^\.\//, ""));
  } catch {
    // fall through to the default
  }
  return resolve(brokerDir, "data/audit.db");
}

const dbPath = resolveDbPath();

if (!existsSync(dbPath)) {
  console.error(`no audit database at ${dbPath}`);
  console.error("pass --db, set BROKER_AUDIT_DB, or point BROKER_CONFIG at the broker's config.");
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
