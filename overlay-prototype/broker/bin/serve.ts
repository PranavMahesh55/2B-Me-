#!/usr/bin/env node
/**
 * §1: a separate PID from the signer, holding the connector credentials and the
 * audit chain. If the signing key and these ever share an address space, the
 * security claim collapses.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AuditChain } from "../src/audit.ts";
import { SqliteSpentStore } from "../src/spent.ts";
import { configureConnectors } from "../src/connectors.ts";
import { createBrokerServer, listen } from "../src/server.ts";
import { loadConfig, loadConfigFile } from "../src/config.ts";
import type { RawConfig } from "../src/config.ts";

const configPath = process.env.BROKER_CONFIG ?? "./config/broker.config.json";

let raw: RawConfig;
try {
  raw = loadConfigFile(configPath);
} catch {
  console.error(`could not read ${configPath}. Copy config/broker.config.example.json and paste`);
  console.error("the output of signer/bin/export-pubkey into signer_public_key_spki_b64u.");
  process.exit(2);
}

const config = await loadConfig(raw);
configureConnectors({ desktopActions: config.desktopActions });
mkdirSync(dirname(config.auditDbPath), { recursive: true });

const database = new DatabaseSync(config.auditDbPath);
const spent = new SqliteSpentStore(database);
const chain = new AuditChain(database);

const warmed = spent.warm(Math.floor(Date.now() / 1000));
const head = chain.head();

const server = createBrokerServer({
  config,
  spent,
  chain,
  log: (line) => console.error(`[broker] ${line}`),
});
await listen(server, config);

console.error(`[broker] listening on ${config.host}:${config.port}`);
console.error(`[broker] issuer ${config.expectedIssuer}`);
console.error(`[broker] ${warmed} unexpired jti warmed; chain head ${head ? "#" + head.index : "(empty)"}`);
console.error(`[broker] origins ${config.allowedOrigins.join(", ")}`);
console.error(`[broker] desktop actions ${config.desktopActions ? "ENABLED" : "disabled (preview only)"}`);
