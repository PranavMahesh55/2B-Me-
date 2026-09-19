#!/usr/bin/env node
/**
 * Generates packages/grant/vectors/canonical.json — the cross-language
 * byte-equality fixture for the Swift canonicalizer (techspecsigner.md §4).
 *
 * §10 forbids editing the vector files to make a test pass, so this refuses to
 * overwrite an existing file unless you pass --regenerate and mean it.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalize, canonicalHash } from "../packages/grant/canonical.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "packages", "grant", "vectors");
const outFile = path.join(outDir, "canonical.json");

function deepNest(depth) {
  let node = { leaf: depth };
  for (let i = depth - 1; i >= 0; i -= 1) node = { [`level_${i}`]: node };
  return node;
}

/** The 12 cases §4 enumerates, in that order. */
const CASES = [
  {
    name: "nested_objects",
    description: "objects inside objects, keys sorted at every level",
    value: { outer: { inner: { z: 1, a: 2 }, b: 3 }, a: 4 },
  },
  {
    name: "arrays",
    description: "arrays keep their order and may hold mixed element types",
    value: { list: [3, 1, 2], mixed: ["b", 1, true, { k: "v" }, []], empty: [] },
  },
  { name: "empty_object", description: "the empty object", value: {} },
  {
    name: "empty_string",
    description: "empty strings as both key and value",
    value: { "": "", k: "" },
  },
  {
    name: "key_ordering_mixed_case_underscores",
    description:
      "UTF-16 ordering puts uppercase before underscore before lowercase",
    value: {
      alpha_beta: 5,
      alpha: 4,
      _alpha: 3,
      Alpha: 2,
      ALPHA: 1,
      "alpha-beta": 6,
      alphaBeta: 7,
    },
  },
  {
    name: "non_ascii_key",
    description:
      "Two independent cross-language traps in one object. (a) An astral-plane key beside a " +
      "BMP key: UTF-16 code-unit ordering puts the emoji FIRST, Unicode scalar ordering would " +
      "put it last \u2014 the case \u00A74 warns about. (b) The same letter precomposed (NFC, " +
      "U+00E9) and decomposed (NFD, U+0065 U+0301): JavaScript treats these as two distinct " +
      "keys, but Swift String equality is canonical-equivalence based and would MERGE them. A " +
      "Swift port modelling objects as [String: Value] emits five keys where JavaScript emits " +
      "six, producing a signature the broker cannot verify.",
    // Written as escapes so no editor or filesystem can normalize them apart.
    value: {
      "\u{1F600}": "astral",
      "ｚ": "fullwidth",
      "z": "ascii",
      "é": "nfc-precomposed",
      "é": "nfd-decomposed",
      "e": "plain",
    },
  },
  {
    name: "non_ascii_value",
    description: "non-ASCII values are left raw, never escaped",
    value: {
      accented: "café",
      cyrillic: "привет",
      cjk: "你好",
      emoji: "deploy \u{1F680} green",
      combining: "é",
    },
  },
  {
    name: "control_characters",
    description:
      "the seven two-character escapes, plus other sub-0x20 code points as lowercase \\u00xx",
    value: {
      two_char: '"\\\b\f\n\r\t',
      low: "\u0000\u0001\u0007\u000B\u000E\u001F",
      mixed: "a\u0000b\nc\u001Fd",
      del_stays_raw: "\u007F",
    },
  },
  {
    name: "negative_integers",
    description: "negative integers carry a sign, positives do not, zero is bare",
    value: { neg: -42, negOne: -1, zero: 0, negZero: -0, pos: 42, big: 9007199254740991, negBig: -9007199254740991 },
  },
  {
    name: "booleans",
    description: "booleans render unquoted",
    value: { yes: true, no: false, list: [true, false], nested: { flag: true } },
  },
  {
    name: "deeply_nested_object",
    description: "twelve levels of nesting",
    value: deepNest(12),
  },
  {
    name: "realistic_grant_claims",
    description: "a full GrantClaims object as the signer actually builds it (§3)",
    value: {
      v: 1,
      iss: "kP3nQvZ1x8Yw2LbR7aTsE9dGhJkMnPqUvXyZ0123456",
      aud: "broker.local",
      jti: "9Q2vXhT4mKpL7sRdEwNbYg",
      iat: 1758300000,
      exp: 1758300120,
      plan_hash: "AVq9f1zFei3ZS3WQ8ErYCEJzkF7jPsXOvq5iJ2qX-GI",
      scope: {
        connector: "mail",
        operation: "draft_response",
        resource: "preview_only",
        param_hashes: {
          destination: "3bF9xQ2LmNpRsTvWyZ0aBcDeFgHiJkLmNoPqRsTuVwY",
          workflow_id: "7hJ2kL9mNpQrStUvWxYz0aBcDeFgHiJkLmNoPqRsTuV",
        },
        max_calls: 1,
      },
      presence: { method: "touchid", at: 1758299998 },
      risk: "medium",
    },
  },
];

if (CASES.length !== 12) {
  throw new Error(`§4 requires exactly 12 vectors, got ${CASES.length}`);
}

if (existsSync(outFile) && !process.argv.includes("--regenerate")) {
  console.error(
    `Refusing to overwrite ${path.relative(root, outFile)}.\n` +
      "techspecsigner.md §10: never edit the vector files to make a test pass.\n" +
      "If the contract itself changed, re-run with --regenerate.",
  );
  process.exit(1);
}

const vectors = [];
for (const testCase of CASES) {
  const canonical = canonicalize(testCase.value);
  vectors.push({
    name: testCase.name,
    description: testCase.description,
    value: testCase.value,
    // The raw JSON text the Swift port parses. Kept separate from `value` so the
    // input crosses the language boundary as bytes rather than as a re-encoded tree.
    input_json: JSON.stringify(testCase.value),
    canonical,
    // Authoritative. `canonical` is for human eyes: it passes through the vector
    // file's own JSON escaping layer, which is an easy place to gain or lose a
    // backslash. Hex has no such layer.
    canonical_utf8_hex: Buffer.from(canonical, "utf8").toString("hex"),
    canonical_utf8_length: Buffer.byteLength(canonical, "utf8"),
    sha256_base64url: await canonicalHash(testCase.value),
  });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  `${JSON.stringify({ version: 1, generator: "scripts/gen-vectors.mjs", vectors }, null, 2)}\n`,
);
console.log(`Wrote ${vectors.length} vectors to ${path.relative(root, outFile)}`);
