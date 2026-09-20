import { readFileSync } from "node:fs";
import { base64url, base64urlDecode, sha256 } from "./contract.ts";

export interface BrokerConfig {
  host: string;
  port: number;
  /** §1: reject any request whose Origin is not the overlay's. */
  allowedOrigins: string[];
  /**
   * An Origin header is set by the caller, so on loopback it proves nothing on
   * its own -- its real job is that a browser cannot forge one, which is the
   * attack §1 names. The shared secret is what actually authenticates the
   * caller: the Electron main process reads it from a 0600 file no web page can.
   */
  launchSecret: string | null;
  audience: string;
  publicKey: CryptoKey;
  expectedIssuer: string;
  maxCallsHardCap: number;
  maxBodyBytes: number;
  auditDbPath: string;
  debugCanonical: boolean;
}

export interface RawConfig {
  host?: string;
  port?: number;
  allowed_origins?: string[];
  launch_secret_path?: string;
  audience?: string;
  signer_public_key_spki_b64u?: string;
  max_calls_hard_cap?: number;
  max_body_bytes?: number;
  audit_db_path?: string;
  debug_canonical?: boolean;
}

export async function loadConfig(raw: RawConfig): Promise<BrokerConfig> {
  const spki = raw.signer_public_key_spki_b64u?.trim();
  if (!spki) {
    // §10 forbids a 500 with a stack trace, but a broker that listens without a
    // key would reject every grant as signature_invalid and look like a crypto
    // bug. Refusing to start is the honest failure.
    throw new Error("signer_public_key_spki_b64u is missing -- run signer/bin/export-pubkey");
  }
  const der = base64urlDecode(spki);
  const publicKey = await crypto.subtle.importKey(
    "spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );

  let launchSecret: string | null = null;
  if (raw.launch_secret_path) {
    try {
      launchSecret = readFileSync(raw.launch_secret_path, "utf8").trim() || null;
    } catch {
      throw new Error(`could not read launch secret at ${raw.launch_secret_path}`);
    }
  }

  return {
    host: raw.host ?? "127.0.0.1",
    port: raw.port ?? 8788,
    allowedOrigins: raw.allowed_origins ?? ["app://2bme-backend"],
    launchSecret,
    audience: raw.audience ?? "broker.local",
    publicKey,
    expectedIssuer: base64url(await sha256(der)),
    maxCallsHardCap: raw.max_calls_hard_cap ?? 1,
    maxBodyBytes: raw.max_body_bytes ?? 65_536,
    auditDbPath: raw.audit_db_path ?? "./data/audit.db",
    debugCanonical: raw.debug_canonical ?? false,
  };
}

export function loadConfigFile(path: string): RawConfig {
  return JSON.parse(readFileSync(path, "utf8")) as RawConfig;
}
