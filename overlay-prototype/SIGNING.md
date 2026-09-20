# Signing subsystem

Implements `techspecsigner.md` against this repo. Three processes, three PIDs:

| Dir | Process | Port | Holds |
|---|---|---|---|
| `signer/` | Swift, Secure Enclave | 127.0.0.1:8787 | the signing key |
| `broker/` | TypeScript on Node | 127.0.0.1:8788 | connector stubs, the audit chain |
| `backend/` | Python FastAPI | 127.0.0.1:8765 | plans, behavioural data |

`packages/grant/` is the shared contract: `types.ts`, `canonical.ts`, and the
frozen vectors both languages are tested against.

## Running it

```bash
npm install && python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm run signer:build                       # swift build + ad-hoc codesign
npm run signer:check                       # canonicalizer vs the 12 vectors
npm run signer:dev                         # serves /grant, writes .runtime/launch-secret

cp broker/config/broker.config.example.json broker/config/broker.config.json
./signer/bin/export-pubkey                 # paste into signer_public_key_spki_b64u
npm run broker:dev
npm run desktop:dev
```

`npm run broker:test`, `npm run backend:test` and `npm run broker:verify-chain`
are the three suites.

## Where this departs from the spec, and why

Each of these is a place the spec could not be followed literally. None are
preferences.

**The contract did not exist.** §1 says to read `packages/grant/types.ts` and
treat it as frozen. No such directory was here, so it was written from §2–§4 and
frozen at the commit that closed §9 step 3.

**`jti` is single-use, so `max_calls` is always 1.** §7 step 5 burns the `jti` and
returns `replayed` on any reappearance, which makes §3's `low: 5` unreachable —
the second call always dies at step 5, before step 9 reads the budget. The broker
clamps whatever a token claims.

**`iss` is unimplementable as §3 writes it.** `SecKeyCopyExternalRepresentation`
returns X9.63 (65 bytes), not the SPKI DER (91) that §3 hashes and that
`crypto.subtle.importKey("spki", …)` needs. `SPKI.swift` prepends the P-256 ASN.1
header by hand.

**Object keys are ordered pairs, never a dictionary.** §4 warns that Swift sorts
by Unicode scalar where JavaScript sorts by UTF-16 code unit. It does not mention
the larger trap: Swift `String` equality is canonical-equivalence based, so
`"é"` and `"é"` compare equal and a `[String: Value]` model silently
merges two keys JavaScript keeps distinct — a shorter canonical string and an
unverifiable signature. The `non_ascii_key` vector covers both.

**The Enclave key lives in the legacy keychain.** An ad-hoc-signed binary cannot
add to the data-protection keychain (`-34018`), and a `keychain-access-groups`
entitlement makes it worse: with no team prefix to validate, the kernel SIGKILLs
the process. The legacy keychain works, but routes through CDSA, which enforces a
*per-binary* ACL — and an ad-hoc signature's designated requirement is its
cdhash. Two executables are two identities even under one `--identifier`, so the
second to touch the key blocks on a `SecurityAgent` dialog rather than returning
an error. Everything that touches the key is therefore one binary with
subcommands.

> A rebuild changes the cdhash, so the key becomes unreachable and
> `grant-signer export-pubkey --reset` is needed. §5's "generate once on first
> run" only really holds with a stable Developer ID identity.

**The 500-signature suite uses a second key.** §6 wants 500 signatures from the
real key; §5's `.biometryCurrentSet` would make that 500 Touch ID prompts. The
`local.intent.signing.test` key is a real Enclave key on the same code path
without the biometric constraint.

**`iss` and `aud` are verified.** §3 defines both and §7's ten steps check
neither, so a token minted for another audience would verify.

**`malformed_request` was added.** §2 enumerates no code for an unparseable body
or a float param — which §4 requires the canonicalizer to throw on — while §10
forbids answering with a 500.

**Two `__tamper` kinds cannot mean what they sound like.** Verification returns on
first failure, so mutating `claims.exp` dies at the signature check and mutating a
param dies at the plan hash. `exp` moves the broker's own clock instead; real
`param_mismatch` needs a token that under-binds its params, which no caller can
construct, so it lives in `tamper.json`.

**Rejected audit rows carry empty `jti` and `iss`.** §8 records rejections, but
before step 2 nothing in the token is authentic and `canonicalize` throws on null.
A row records what was presented; it never asserts an attacker's strings were real.

**The renderer never calls the signer.** Packaged, it is a `file://` document
sending `Origin: null` — which is also what any local HTML file sends, so
allowlisting it would reopen the hole §1 closes. The Electron main process makes
the call with an `app://` Origin no browser can produce, plus a 0600 launch
secret no web page can read.

**`POST /api/automation/{id}/approve` was deleted.** It wrote
`PermissionGrant(approved=True, approved_by="user")` — a boolean this process set
for itself — and `execute_plan` gated on it. A route that flips state nothing
reads is a bypass waiting to happen.
