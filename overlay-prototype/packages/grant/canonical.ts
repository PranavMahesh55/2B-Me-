/**
 * The restricted JCS subset from techspecsigner.md §4.
 *
 * The Swift port in signer/Sources/GrantSigner/Canonical.swift must reproduce
 * this byte for byte. CanonicalTests.swift proves it against vectors/canonical.json.
 */

import type { JsonValue } from "./types.ts";

export type CanonicalErrorReason =
  | "null"
  | "float"
  | "nan"
  | "infinity"
  | "unsafe_integer"
  | "lone_surrogate"
  | "unsupported";

export class CanonicalError extends Error {
  readonly reason: CanonicalErrorReason;
  readonly path: string;

  constructor(reason: CanonicalErrorReason, path: string, detail: string) {
    super(`canonicalize: ${detail} at ${path || "<root>"}`);
    this.name = "CanonicalError";
    this.reason = reason;
    this.path = path;
  }
}

const TWO_CHAR_ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * §4: the listed characters become two-character sequences, other code points
 * below 0x20 become \u00xx with LOWERCASE hex, everything else stays raw.
 */
function encodeString(value: string, path: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const code = value.charCodeAt(i);
    const escape = TWO_CHAR_ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // A lone surrogate has no UTF-8 encoding, so JavaScript and Swift would
      // silently disagree on the bytes. §4's rule is to throw, never coerce.
      const isHigh = code <= 0xdbff;
      const next = isHigh ? value.charCodeAt(i + 1) : Number.NaN;
      if (isHigh && next >= 0xdc00 && next <= 0xdfff) {
        out += char + value[i + 1];
        i += 1;
      } else {
        throw new CanonicalError(
          "lone_surrogate",
          path,
          `unpaired surrogate \\u${code.toString(16).padStart(4, "0")}`,
        );
      }
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

/** §4: integers only — no exponent, no decimal point, no sign on positives. */
function encodeNumber(value: number, path: string): string {
  if (Number.isNaN(value)) throw new CanonicalError("nan", path, "NaN is not encodable");
  if (!Number.isFinite(value)) {
    throw new CanonicalError("infinity", path, "Infinity is not encodable");
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalError("float", path, `${value} is not an integer`);
  }
  if (!Number.isSafeInteger(value)) {
    // Beyond 2^53 JavaScript cannot round-trip the value, so the Swift Int64
    // port would print different digits.
    throw new CanonicalError("unsafe_integer", path, `${value} exceeds the safe integer range`);
  }
  // String(-0) is "0", which is what we want.
  return String(value);
}

function encode(value: unknown, path: string): string {
  if (value === null) {
    throw new CanonicalError("null", path, "null is not encodable");
  }
  switch (typeof value) {
    case "string":
      return encodeString(value, path);
    case "number":
      return encodeNumber(value, path);
    case "boolean":
      return value ? "true" : "false";
    case "object":
      break;
    default:
      throw new CanonicalError("unsupported", path, `${typeof value} is not encodable`);
  }

  if (Array.isArray(value)) {
    // §4: arrays keep their order.
    const items = value.map((item, index) => encode(item, `${path}[${index}]`));
    return `[${items.join(",")}]`;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new CanonicalError("unsupported", path, "only plain objects are encodable");
  }

  // §4: keys sorted by UTF-16 code unit. Array.prototype.sort() compares
  // strings exactly that way, so the default sort is already correct here.
  // It is the Swift port that needs an explicit Array(s.utf16) comparison.
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    const child = (value as Record<string, unknown>)[key];
    const childPath = path ? `${path}.${key}` : key;
    if (child === undefined) {
      throw new CanonicalError("unsupported", childPath, "undefined is not encodable");
    }
    return `${encodeString(key, childPath)}:${encode(child, childPath)}`;
  });
  // §4: no whitespace anywhere.
  return `{${entries.join(",")}}`;
}

/** The canonical string whose UTF-8 bytes are signed and hashed. */
export function canonicalize(value: JsonValue): string {
  return encode(value, "");
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** base64url(SHA-256(canonicalize(value))) — the form every hash in §3 takes. */
export async function canonicalHash(value: JsonValue): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  return base64url(await sha256(bytes));
}
