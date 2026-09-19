# Build brief — signing subsystem

You are implementing two processes. The UI already exists and is finished; it talks to you
over two loopback HTTP endpoints defined in §2. Do not modify the UI, and do not modify
anything in `packages/grant/` — those files are the contract.

Read `packages/grant/types.ts` and `packages/grant/canonical.ts` before writing code. They
define every field name, every unit, and the exact canonical byte encoding you must
reproduce in Swift.

---

## 1. What you are building

| Dir | Process | Language | Holds |
|---|---|---|---|
| `signer/` | LaunchAgent on `127.0.0.1:8787` | Swift 5.9+, macOS 14+ | Secure Enclave key |
| `broker/` | separate PID on `127.0.0.1:8788` | TypeScript (Bun) | connector creds, audit chain |

These must be separate processes with separate PIDs. If the signing key and the connector
credentials ever live in the same address space, the entire security claim collapses and
the work is worthless. This is not a style preference.

Both bind loopback explicitly. Never `0.0.0.0`. Both reject any request carrying an
`Origin` header that is not the overlay's, so a web page on the machine cannot reach them.

---

## 2. The two endpoints — frozen

### `POST 127.0.0.1:8787/grant`

Request:
```json
{
  "plan": {
    "connector": "slack",
    "operation": "message.send",
    "resource": "#eng-standup",
    "params": { "text": "deploy is green", "thread_ts": "1726...": }
  },
  "risk": "medium"
}
```

Response `200`:
```json
{ "token": { "claims": { ... }, "sig": "<base64url 64 bytes>", "alg": "ES256" } }
```

Response `4xx`: `{ "error": "<GrantErrorCode>", "message": "optional human text" }`

Signer-reachable error codes, exactly these strings: `presence_cancelled`,
`presence_failed`, `key_missing`, `biometry_changed`, `unknown_operation`.

### `POST 127.0.0.1:8788/execute`

Request: `{ "token": <GrantToken>, "plan": <Plan> }`
Optional demo field: `"__tamper": "resource" | "param" | "exp" | "sig"` (§7).

Response `200`:
```json
{ "jti": "...", "audit_index": 12, "audit_hash": "...",
  "connector_result": { ... }, "executed_at": 1758300000 }
```

Response `4xx`: `{ "error": "<GrantErrorCode>" }`

Broker-reachable error codes: `signature_invalid`, `expired`, `not_yet_valid`,
`replayed`, `plan_mismatch`, `unknown_operation`, `param_mismatch`,
`call_budget_exhausted`, `connector_failed`.

---

## 3. Claims construction (signer)

```
v          = 1
iss        = base64url(SHA-256(public key in SPKI DER))
aud        = "broker.local"
jti        = base64url(16 random bytes from SecRandomCopyBytes)
iat        = unix seconds now
exp        = iat + TTL_BY_RISK[risk]        // low 300, medium 120, high 60
plan_hash  = base64url(SHA-256(canonicalize(plan)))
scope      = { connector, operation, resource,
               param_hashes: { k: base64url(SHA-256(canonicalize(v))) for each param },
               max_calls: MAX_CALLS_BY_RISK[risk] }   // low 5, medium 1, high 1
presence   = { method: "touchid", at: <unix seconds at which LAContext succeeded> }
risk       = as requested
```

`canonicalize(plan)` hashes the whole `Plan` object including `params`. Each param value is
canonicalized and hashed individually as well. A string param canonicalizes to a quoted
JSON string, so `canonicalize("abc")` is `"abc"` with the quotes — five bytes, not three.
Get this wrong and the broker's independent re-derivation will disagree.

Validate `operation` against the `OPERATIONS` list in `types.ts` before prompting. An
unknown operation returns `unknown_operation` without raising a biometric prompt.

---

## 4. The Swift canonicalizer — build this first

Port `packages/grant/canonical.ts` to Swift. Same restricted JCS subset:

- object keys sorted by **UTF-16 code unit** (Swift's default `String` `<` is Unicode
  scalar ordering and will differ for characters above the BMP — sort on `Array(s.utf16)`
  lexicographically, or you will disagree with JavaScript on emoji keys)
- no whitespace anywhere
- arrays keep their order
- strings: escape `"` `\` `\b` `\f` `\n` `\r` `\t` as two-character sequences; escape other
  code points below `0x20` as `\u00xx` with **lowercase** hex; leave all other Unicode raw
- integers only, printed with no sign for positives, no exponent, no decimal point
- **throw** on floats, null, NaN, infinity — never coerce

Write `signer/Tests/CanonicalTests.swift` that loads
`packages/grant/vectors/canonical.json` and asserts byte-equality for every case. Generate
that file first with a small Node script that runs the TypeScript canonicalizer over 12
claim objects covering: nested objects, arrays, empty object, empty string, key ordering
with mixed case and underscores, a non-ASCII key, a non-ASCII value, control characters,
negative integers, booleans, a deeply nested object, and a realistic full `GrantClaims`.

This cross-language byte-equality test is the highest-value test in the project. A silent
disagreement here presents as an invalid signature and will be misdiagnosed as a crypto
bug for hours.

---

## 5. The Secure Enclave key

Generate once on first run, keyed by application tag `local.intent.signing.v1`. Look it up
on every start; generate only if absent.

```swift
let access = SecAccessControlCreateWithFlags(
    kCFAllocatorDefault,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    [.privateKeyUsage, .biometryCurrentSet],
    &error)

let attrs: [String: Any] = [
    kSecAttrKeyType as String:       kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeySizeInBits as String: 256,
    kSecAttrTokenID as String:       kSecAttrTokenIDSecureEnclave,
    kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String:    true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrAccessControl as String:  access,
    ],
]
```

`.biometryCurrentSet` invalidates the key if the enrolled fingerprint set changes. When a
sign operation fails with `errSecAuthFailed` after the key was previously usable, return
`biometry_changed`, not `presence_failed` — the UI has distinct copy for it.

Sign with `SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data)` where `data`
is the **UTF-8 bytes of the canonical claims string**. That algorithm hashes internally;
do not pre-hash, or you will be signing the hash of a hash.

The biometric reason string passed to the prompt must contain the human description of
the action, so the OS dialog itself names what is being authorized.

Expose the public key: `signer/bin/export-pubkey` writes SPKI DER base64url to stdout.
The broker reads it from config at startup.

---

## 6. DER to raw — the bug that will cost you the demo

`SecKeyCreateSignature` returns X9.62 DER: `30 len 02 len r 02 len s`. WebCrypto's ECDSA
verify in the broker requires **raw `r‖s`, exactly 64 bytes**. Convert in the signer
before base64url encoding.

DER omits leading zero bytes and prepends one when the high bit is set, so `r` arrives as
31, 32, or 33 bytes. Strip leading zeros, then left-pad with zeros to exactly 32. Same for
`s`. Reject anything that does not parse.

**Test requirement:** `signer/Tests/SignatureTests.swift` signs 500 distinct payloads with
the real Enclave key and asserts every output is exactly 64 bytes. A single-signature test
passes about 255 times out of 256 and tells you nothing. Write the 500 pairs to
`packages/grant/vectors/signatures.json` for the broker's test suite to consume.

---

## 7. Broker verification — fail closed, this exact order

Return on first failure. Do no work before the signature check.

1. `alg === "ES256"` and `claims.v === 1` → else `signature_invalid`
2. signature verifies over `canonicalize(claims)` against the configured public key → else `signature_invalid`
3. `claims.iat <= now + 5` → else `not_yet_valid`
4. `now < claims.exp` **and** `claims.exp - claims.iat <= 300` → else `expired`
5. `jti` not in spent set → insert → else `replayed`
6. `canonicalHash(submitted plan) === claims.plan_hash` → else `plan_mismatch`
7. `(connector, operation)` in registry → else `unknown_operation`
8. every bound param hash matches **and the submitted plan has no params beyond those
   bound** → else `param_mismatch`
9. calls recorded for this `jti` < `scope.max_calls` → else `call_budget_exhausted`
10. execute connector, append audit entry, return receipt

Step 8's second clause is the one implementations omit. Without it a grant bound to
`{to, subject}` still authorizes a call carrying an added `bcc`. Test it explicitly.

Spent `jti` lives in memory **and** in SQLite, checked against both, because a replay is
most plausible immediately after a broker restart.

The `__tamper` field mutates the token or plan **inside the broker**, after receipt and
before verification, then runs the normal path. The demo must show the broker rejecting
something, not the UI declining to send.

---

## 8. Audit chain

Append-only SQLite table. Each entry:

```
{ index, prev_hash, jti, iss, connector, operation, resource,
  param_hashes, risk, outcome: "executed" | "<GrantErrorCode>", at }
```

`hash = base64url(SHA-256(canonicalize(entry without hash)))`, `prev_hash` of entry 0 is
32 zero bytes base64url. No parameter values, no content — hashes only.

Rejected grants are recorded too. A chain containing only successes proves nothing.

`broker/bin/verify-chain` recomputes every link and exits non-zero on the first break.

---

## 9. Order of work

| # | Deliverable | Green when |
|---|---|---|
| 1 | `canonical.json` generator + Swift canonicalizer | byte-equal on all 12 vectors |
| 2 | Key generation + `export-pubkey` | key found again after process restart |
| 3 | Sign + `derToRaw` + 500-signature suite | all 64 bytes |
| 4 | Signer HTTP endpoint | UI reaches `authorizing` and gets a token |
| 5 | Broker steps 1–9 against `signatures.json` | all 500 verify |
| 6 | `tamper.json`: 6 mutated tokens | each rejected with the expected code |
| 7 | Stub connector + audit chain + `verify-chain` | chain verifies after 20 grants |
| 8 | `__tamper` path | rejection visible end to end |

Do not start #5 until #3 is green. Do not add a real connector until #8 is green.

---

## 10. Rules

- Commit at each green step.
- Never edit `packages/grant/*` or the vector files to make a test pass. If you believe
  the contract is wrong, stop and say so.
- No cryptography dependencies beyond Apple's Security framework and WebCrypto. No
  `node-jose`, no `jsonwebtoken`. This is not a JWT; do not make it one.
- Every error path returns one of the enumerated codes. A 500 with a stack trace is a bug.
- Log the canonical string and its SHA-256 on both sides at debug level. When a signature
  fails to verify, the first question is always whether the two canonical strings differ,
  and you want to be able to answer it in ten seconds.