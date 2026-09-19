/**
 * §7 step 5: "Spent `jti` lives in memory **and** in SQLite, checked against
 * both, because a replay is most plausible immediately after a broker restart."
 */
import { DatabaseSync } from "node:sqlite";
import type { GrantClaims } from "./contract.ts";
import type { SpentStore } from "./verify.ts";

export class SqliteSpentStore implements SpentStore {
  readonly #db: DatabaseSync;
  readonly #memory = new Set<string>();

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS spent_jti (
        jti        TEXT PRIMARY KEY,
        iss        TEXT NOT NULL,
        exp        INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        calls      INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  /** Loads unexpired jti into memory at boot — the restart case §7 names. */
  warm(now: number): number {
    const rows = this.#db.prepare("SELECT jti FROM spent_jti WHERE exp > ?").all(now) as { jti: string }[];
    for (const row of rows) this.#memory.add(row.jti);
    return rows.length;
  }

  has(jti: string): boolean {
    if (this.#memory.has(jti)) return true;
    const row = this.#db.prepare("SELECT 1 FROM spent_jti WHERE jti = ?").get(jti);
    return row !== undefined;
  }

  /**
   * SQLite first, memory second. The PRIMARY KEY conflict *is* the atomicity
   * mechanism — a check-then-insert would leave a window open — and writing to
   * the durable store first means a crash between the two cannot lose a burn.
   */
  burn(claims: GrantClaims): "burned" | "replayed" {
    const now = Math.floor(Date.now() / 1000);
    const changed = this.#db
      .prepare(
        `INSERT INTO spent_jti (jti, iss, exp, first_seen, calls)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(jti) DO NOTHING`,
      )
      .run(claims.jti, claims.iss, claims.exp, now);
    if (changed.changes === 0) {
      this.#memory.add(claims.jti);
      return "replayed";
    }
    this.#memory.add(claims.jti);
    return "burned";
  }

  calls(jti: string): number {
    const row = this.#db.prepare("SELECT calls FROM spent_jti WHERE jti = ?").get(jti) as
      | { calls: number }
      | undefined;
    return row?.calls ?? 0;
  }

  recordCall(jti: string): void {
    this.#db.prepare("UPDATE spent_jti SET calls = calls + 1 WHERE jti = ?").run(jti);
  }
}
