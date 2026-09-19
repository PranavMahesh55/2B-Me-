/**
 * §8: an append-only hash chain. "Rejected grants are recorded too. A chain
 * containing only successes proves nothing."
 *
 * The chain lives in the broker's own SQLite file, not the prototype's
 * `audit_events` table, for three reasons: that table is mutable and shared with
 * behavioural events; `record_audit()` is rolled back with the request, so a
 * rejection row would vanish exactly when it matters; and hashing has to use the
 * one canonicalizer from packages/grant, not a third implementation in Python.
 */
import { DatabaseSync } from "node:sqlite";
import { base64url, canonicalize, sha256 } from "./contract.ts";
import type { GrantErrorCode } from "./contract.ts";

/** §8: prev_hash of entry 0 is 32 zero bytes base64url. */
export const GENESIS_PREV_HASH = base64url(new Uint8Array(32));

export interface ChainEntry {
  index: number;
  prev_hash: string;
  jti: string;
  iss: string;
  connector: string;
  operation: string;
  resource: string;
  param_hashes: Record<string, string>;
  risk: string;
  outcome: "executed" | GrantErrorCode;
  at: number;
}

/**
 * §8 lists exactly these eleven fields and `canonicalize` throws on null, so an
 * unknown value is the empty string rather than a null or a new column. That
 * also settles what a rejected row holds: before the signature verifies, nothing
 * in the token is trustworthy, so `jti` and `iss` stay empty rather than carrying
 * attacker-supplied strings into the chain. The raw attempt is in the log.
 */
export const UNKNOWN = "";

export class AuditChain {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS audit_chain (
        idx          INTEGER PRIMARY KEY,
        prev_hash    TEXT NOT NULL,
        jti          TEXT NOT NULL,
        iss          TEXT NOT NULL,
        connector    TEXT NOT NULL,
        operation    TEXT NOT NULL,
        resource     TEXT NOT NULL,
        param_hashes TEXT NOT NULL,
        risk         TEXT NOT NULL,
        outcome      TEXT NOT NULL,
        at           INTEGER NOT NULL,
        hash         TEXT NOT NULL
      );

      -- Stops the broker's own bugs and casual sqlite3 edits. It does not stop
      -- someone who can drop the triggers; the hash chain is the tamper evidence
      -- and bin/verify-chain is the detector.
      CREATE TRIGGER IF NOT EXISTS audit_chain_no_update BEFORE UPDATE ON audit_chain
        BEGIN SELECT RAISE(ABORT, 'audit_chain is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_chain_no_delete BEFORE DELETE ON audit_chain
        BEGIN SELECT RAISE(ABORT, 'audit_chain is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_chain_sequential BEFORE INSERT ON audit_chain
        WHEN NEW.idx <> (SELECT IFNULL(MAX(idx) + 1, 0) FROM audit_chain)
        BEGIN SELECT RAISE(ABORT, 'non-sequential audit index'); END;
    `);
  }

  head(): { index: number; hash: string } | null {
    const row = this.#db
      .prepare("SELECT idx, hash FROM audit_chain ORDER BY idx DESC LIMIT 1")
      .get() as { idx: number; hash: string } | undefined;
    return row ? { index: row.idx, hash: row.hash } : null;
  }

  /**
   * §8: hash = base64url(SHA-256(canonicalize(entry without hash))). `index` and
   * `prev_hash` are inside the hashed object, so reordering two otherwise
   * identical entries is detectable.
   */
  static async hashOf(entry: ChainEntry): Promise<string> {
    return base64url(await sha256(new TextEncoder().encode(canonicalize(entry as never))));
  }

  async append(fields: Omit<ChainEntry, "index" | "prev_hash">): Promise<{ index: number; hash: string }> {
    const head = this.head();
    const entry: ChainEntry = {
      index: head ? head.index + 1 : 0,
      prev_hash: head ? head.hash : GENESIS_PREV_HASH,
      ...fields,
    };
    const hash = await AuditChain.hashOf(entry);
    this.#db
      .prepare(
        `INSERT INTO audit_chain
           (idx, prev_hash, jti, iss, connector, operation, resource, param_hashes, risk, outcome, at, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.index, entry.prev_hash, entry.jti, entry.iss, entry.connector,
        entry.operation, entry.resource, JSON.stringify(entry.param_hashes),
        entry.risk, entry.outcome, entry.at, hash,
      );
    return { index: entry.index, hash };
  }

  rows(): ChainEntry[] {
    const rows = this.#db.prepare("SELECT * FROM audit_chain ORDER BY idx ASC").all() as Record<string, never>[];
    return rows.map((row) => ({
      index: row.idx as unknown as number,
      prev_hash: row.prev_hash as unknown as string,
      jti: row.jti as unknown as string,
      iss: row.iss as unknown as string,
      connector: row.connector as unknown as string,
      operation: row.operation as unknown as string,
      resource: row.resource as unknown as string,
      param_hashes: JSON.parse(row.param_hashes as unknown as string) as Record<string, string>,
      risk: row.risk as unknown as string,
      outcome: row.outcome as unknown as ChainEntry["outcome"],
      at: row.at as unknown as number,
    }));
  }

  /** Recomputes every link; reports the first break. */
  async verify(): Promise<
    { ok: true; count: number; head: string | null } | { ok: false; index: number; reason: string }
  > {
    const stored = this.#db
      .prepare("SELECT idx, hash FROM audit_chain ORDER BY idx ASC")
      .all() as { idx: number; hash: string }[];
    const entries = this.rows();

    let previous = GENESIS_PREV_HASH;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.index !== i) {
        return { ok: false, index: i, reason: `non-sequential index (expected ${i}, got ${entry.index})` };
      }
      if (entry.prev_hash !== previous) {
        return { ok: false, index: i, reason: `prev_hash expected ${previous}, got ${entry.prev_hash}` };
      }
      const recomputed = await AuditChain.hashOf(entry);
      if (recomputed !== stored[i].hash) {
        return { ok: false, index: i, reason: "hash mismatch (entry content was modified)" };
      }
      previous = stored[i].hash;
    }
    return { ok: true, count: entries.length, head: stored.at(-1)?.hash ?? null };
  }
}
