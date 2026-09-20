# What changed

Everything below lands in `overlay-prototype/`. It builds on `8711450 Built
backend service` and keeps that work intact — the collector, the workflow
builder and the LLM boundary are all still there, wired differently in places.

## Read this first if you have a client

**`POST /api/automation/{plan_id}/approve` is gone.** Anything still calling it
gets a 404.

It recorded `PermissionGrant(approved=True, approved_by="user")` — a boolean
this process set for itself — and `execute_plan` gated on nothing more. Anything
able to write that row could also authorize itself, so it was not an
authorization. `POST /{plan_id}/execute` now takes `{token, plan}` and answers
with a `GrantErrorCode` when the broker refuses.

The Dashboard workflow builder keeps its three stages; its last step calls
`authorizeAndExecute()` instead, which raises Touch ID. The permission
checkboxes are an acknowledgement of what will be bound, not the thing that
authorizes it.

`PermissionGrant` is superseded by a new `grant_receipts` table rather than
altered. `initialize_database()` only calls `create_all()`, which adds missing
tables but never columns, and there are no alembic migrations — altering the old
table would have silently done nothing on any existing database.

## The signing subsystem

Implements `techspecsigner.md`. Three processes, three PIDs:

| Dir | Process | Port | Holds |
|---|---|---|---|
| `signer/` | Swift, Secure Enclave | 127.0.0.1:8787 | the signing key |
| `broker/` | TypeScript on Node | 127.0.0.1:8788 | connectors, the audit chain |
| `backend/` | Python FastAPI | 127.0.0.1:8765 | plans, behavioural data |

`packages/grant/` is the shared contract: `types.ts`, `canonical.ts`, and frozen
vectors both languages are tested against. An action is authorized by a
short-lived, plan-bound, single-use token signed by this Mac's Secure Enclave
after a Touch ID prompt, and verified by a separate process before anything
runs. Rejections are recorded in a hash chain alongside successes.

`overlay-prototype/SIGNING.md` records every place the spec could not be
followed literally — there are nine, and several were only findable by running
it. The short version: `iss` is unimplementable as written because the Security
framework returns X9.63 rather than SPKI DER; an ad-hoc-signed binary cannot use
the data-protection keychain and is SIGKILLed if you give it a
`keychain-access-groups` entitlement; and Swift's `String` equality is
canonical-equivalence based, so a `[String: Value]` object model silently merges
two JSON keys that JavaScript keeps distinct.

## Other changes

**Three subsystems from `8711450` were unreachable.** `LocalFallbackAdapter`
had no callers, `record_session()` had no entry point, and the assistant
composed answers in the renderer by string-matching against raw metrics, which
skipped the sanitizer entirely. All three are connected now, and
`POST /api/assistant/ask` returns the `SanitizedBehaviorContext` it used as
`grounded_in`, which the UI renders under "What this is based on".

**Keyboard timing is collected.** `DEFAULT_PRIVACY` has carried
`keyboard_timing: True` since the beginning and nothing ever collected it.
`collector/` is a small SwiftPM package reading `CGEventSource` counters —
totals since boot, so differences give a rate. Not an event tap: no keycodes, no
characters, no Accessibility permission. `focus` gains a `keystroke_momentum`
term at 0.18 with the other weights rebalanced to sum to 1.

**`GET /api/metrics/rhythm` is new.** `/metrics/history` is not a rhythm: every
`BehaviorScore` re-aggregates the whole session, so consecutive points are
near-identical and the 60-minute chart was a flat line. Measured over 60 stored
points, `focus` held 17 distinct values inside 0.71–0.73 and `duration_s` held
exactly one. The new endpoint scores a trailing window at each step.

**A workflow can be reproduced.** The ordered application list is a bound grant
param, so the broker can only reopen what the consent card showed; adding one
afterwards is `param_mismatch`. `execFile("/usr/bin/open", ["-a", name])` runs
no shell. **Real desktop actions are off by default** (`desktop_actions: false`)
— "preview only" is a promise the UI makes, so launching applications is opt-in
per deployment. The mail step opens a `mailto:` draft and never sends.

**Synthetic labelling removed from the UI**, at your request. Worth knowing:
scores are still blended with a synthetic baseline, weighted by observed task
count — `bootstrap 0.8 / personal 0.2` under 10 tasks, reaching fully personal
at 60. The labels were accurate rather than stale, and `AGENTS.md:17` asks for
prototype data to be labelled illustrative. `backend/README.md` documents the
blend.

## Running it

```bash
npm install && python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm run signer:build && npm run signer:check
./collector/bin/build
cp broker/config/broker.config.example.json broker/config/broker.config.json
./signer/bin/export-pubkey        # paste into signer_public_key_spki_b64u
npm run signer:dev                # serves /grant, writes .runtime/launch-secret
npm run broker:dev
npm run desktop:dev
```

Suites: `npm run backend:test`, `npm run broker:test`, `npm run signer:check`,
`npm run broker:verify-chain`, plus `npm run test:sites` and `npm run build`,
which the Sites handoff in `AGENTS.md` depends on. Currently 18 / 46 / 26 / 4.

## Known gaps, not fixed

- `permission_request` is fire-and-forget over the WebSocket. A plan created
  while the renderer is reconnecting is never shown and cannot be reached.
- A failed or cancelled Touch ID leaves no trace in the chain or in
  `audit_events` — it happens entirely in the Electron→signer path.
- The overlay menu has "Hide overlay" with no way back: no tray icon, no global
  shortcut, and `preload.cjs` exposes `hide` but not `show`.
- `conftest.py` gives the whole backend suite one database, so tests are
  order-sensitive.
- The workflow detector title-cases application names for display and stores
  that, so `ChatGPT` is recorded as `Chatgpt`. Harmless on macOS, which resolves
  application names case-insensitively.
- Ad-hoc code signing means the Enclave key becomes unreachable after every
  rebuild; `grant-signer export-pubkey --reset` handles it in development. §5's
  "generate once on first run" needs a stable Developer ID identity.
