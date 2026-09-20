# 2Bᵐᵉ

A macOS desktop companion that watches how you work — locally — and turns the
loops it finds into actions you can authorize with Touch ID.

The product lives in **`overlay-prototype/`**. It is a real multi-process
application, not a clickable mock: a Swift collector, a Python scoring service,
a TypeScript grant broker, a Swift Secure Enclave signer, and an Electron shell
that renders a top-center always-on-top overlay plus a fuller dashboard.

---

## What it does

**Observes.** A macOS collector reports the frontmost application name and,
separately, keyboard/mouse/scroll *counters* read from `CGEventSource` — rates,
not keystrokes. No Accessibility permission, no event tap, no key content, no
window titles, no screenshots, no clipboard text.

**Scores.** `backend/app/scoring/engine.py` turns those events into four
numbers per task — `friction`, `focus`, `automation_potential`, `confidence` —
from a weights file you can read (`config/behavior_model_v0.json`), not an
opaque model. Early scores are blended with a synthetic bootstrap baseline and
shift to fully personal at 60 observed tasks.

**Detects.** Repeated three-step application sequences become named workflows
with a repeat count, an average duration, and a confidence.

**Explains.** Every recommendation and assistant answer is composed from a
`SanitizedBehaviorContext` — scored aggregates plus an allow-listed set of
evidence keys. The UI renders that exact object under "What this is based on",
so a claim about your behavior can always be traced to the numbers behind it.

**Acts, but only with a signed grant.** Reproducing a workflow raises a Touch ID
prompt. What you get back is a short-lived, plan-bound, single-use token signed
by this Mac's Secure Enclave, verified by a *separate process* before anything
runs, and recorded — successes and refusals alike — in a hash chain.

**Talks.** Optional ElevenLabs voice: push-to-talk or click-to-latch input, and
a spoken briefing composed locally from the same sanitized context. The
long-lived API key never leaves the Electron main process.

---

## Where the value lands

The pitch is not "another analytics dashboard." Time-tracking tools tell you
where the hours went; 2Bᵐᵉ identifies the specific repeated sequence that is
costing them and offers to run it for you.

- **Revenue / product:** a per-seat desktop companion for knowledge workers, and
  a natural wedge for teams — the same engine that scores an individual's
  friction aggregates into where a team's tooling actually hurts.
- **Cost savings:** the unit of savings is a detected loop, not an estimate. A
  workflow carries its own `repeat_count × average_duration_s`, so the value of
  automating it is measured from observed behavior rather than asserted.
- **Risk reduction:** this is the part enterprises buy. Behavioral telemetry is
  normally a compliance problem. Here the raw data never leaves the machine, the
  explanation boundary is a typed object that a provider cannot see around, and
  every automated action leaves a tamper-evident receipt naming what was
  authorized, by whom, and when. That is an audit story, not a privacy policy.
- **Why it can be sold to security review:** the authorization model is the
  product's spine, not a setting. Removing consent would mean removing a
  process.

---

## How it is built

Five processes, deliberately separated by what each one is trusted with:

| Component | Stack | Port | Holds |
|---|---|---|---|
| `signer/` | Swift, Secure Enclave | `127.0.0.1:8787` | the signing key — nothing else |
| `broker/` | TypeScript on Node | `127.0.0.1:8788` | connectors, the audit chain |
| `backend/` | Python FastAPI + SQLite | `127.0.0.1:8765` | plans, scores, behavioral data |
| `collector/` | Swift (SwiftPM) | — | input counters, frontmost app |
| `electron/` + `src/` | Electron + React 19 + Vite | `127.0.0.1:4173` | overlay, dashboard, voice transport |

Everything binds to loopback. Nothing listens on a network interface.

### The decisions worth defending

**Authorization is a signature, not a boolean.** An earlier build had
`POST /api/automation/{plan_id}/approve`, which wrote `approved=True` — a flag
the process set for itself. Anything able to write that row could authorize
itself, so it was not an authorization. It was deleted rather than patched.
`/execute` now takes `{token, plan}` and the broker answers with a typed
`GrantErrorCode` when it refuses.

**The verifier is a different process from the signer and from the app.** The
renderer never talks to the signer at all: packaged, it is a `file://` document
whose fetches carry `Origin: null` — which is also what any HTML file you
double-click sends. The Electron main process sends an `app://` origin no
browser document can forge, plus a launch secret from a `0600` file, and keeps
the token out of renderer JavaScript entirely.

**Grants are bound to their plan.** The ordered application list is a signed
param, so the broker can only reopen what the consent card showed; adding a step
afterwards fails as `param_mismatch`. The clipboard step binds a SHA-256 of the
content you consented to, and refuses if the clipboard changed underneath it.

**Real desktop actions are opt-in per deployment** (`desktop_actions`, default
off) and content egress has its own separate switch (`content_actions`) —
opening an app changes nothing outside the machine; sending your clipboard to a
website is a different kind of act. `execFile("/usr/bin/open", [...])` runs no
shell, so a bound name can never become a command. The mail connector opens a
`mailto:` draft and never sends.

**The canonicalizer is tested across two languages against frozen vectors.**
`packages/grant/` holds the shared contract; Swift and JavaScript both produce
byte-identical canonical JSON for all 12 vectors, including the trap where
Swift's canonical-equivalence `String` comparison would silently merge two keys
JavaScript keeps distinct.

**Rejections are recorded, not just successes.** `broker:verify-chain` walks the
hash chain and fails loudly if any link is broken.

**Scalability, honestly:** the architecture scales by staying local — scoring
cost is per-device, and the server-side surface a vendor would have to operate
is zero. The parts that would need work before fleet deployment are written
down in *Known gaps* rather than glossed over.

---

## Running it

macOS with a Touch ID Mac is required for the full flow. Node ≥ 22 and Python 3
are required for everything else.

### The full desktop app

```bash
cd overlay-prototype

npm install
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt

npm run signer:build          # swift build + ad-hoc codesign
npm run signer:check          # canonicalizer vs the frozen vectors
./collector/bin/build         # the Swift input counter

cp broker/config/broker.config.example.json broker/config/broker.config.json
./signer/bin/export-pubkey    # paste the output into signer_public_key_spki_b64u
```

Then three terminals:

```bash
./signer/.build/release/grant-signer serve \
    --secret-file .runtime/launch-secret --debug   # /grant, with the Touch ID prompt
npm run broker:dev            # verifies grants, runs connectors, writes the chain
npm run desktop:dev           # Vite + Electron; starts the Python backend itself
```

Electron spawns the FastAPI backend from `.venv` and waits for
`/api/system/status` before showing a window, so there is no fourth terminal.

**Mind the signer role.** The signer keeps two Enclave keys. `production` (the
default for both `serve` and `export-pubkey`) requires biometry — that is the
Touch ID prompt, and it is the one to demo. `npm run signer:dev` is a
convenience that passes `--role test`, which uses a *different* key and skips
the presence check entirely; pair it with `./signer/bin/export-pubkey --role
test` or the broker will reject every grant as `signature_invalid`. Whichever
role you serve, the key in `broker.config.json` must come from the matching
`export-pubkey`.

To let a reproduced workflow actually open applications, set
`"desktop_actions": true` in `broker/config/broker.config.json` and restart the
broker. Leave it off and every connector stops at `preview_only`.

Rebuilding the signer makes the Enclave key unreachable (a consequence of
ad-hoc code signing). In development, `./signer/bin/export-pubkey --reset`
re-mints it — then paste the new key into the broker config again.

### Browser-only preview

The fastest way to see the interface, without Electron, Touch ID or a grant:

```bash
cd overlay-prototype
npm install
npm run dev                   # http://127.0.0.1:5173
```

Run `npm run backend:dev` alongside it for live scoring against the local
service; without it the UI renders illustrative data from `src/data.js`.

### Voice (optional)

```bash
export ELEVENLABS_API_KEY="..."
export ELEVENLABS_VOICE_ID="..."
npm run desktop:dev
```

Without those two variables the app runs normally and the voice panel reports
that it is unconfigured. See `overlay-prototype/VOICE.md`.

### Tests

```bash
npm run backend:test          # 22 — FastAPI routes, scoring, sanitizer
npm run broker:test           # 47 — verification pipeline, tamper vectors, chain
npm run signer:check          # 26 — canonical JSON checks, Swift side
npm run test:sites            #  8 — Sites worker, voice interaction, voice security
npm run broker:verify-chain   # walks the audit chain and reports the head
```

All five pass on a configured machine; the counts above were taken from a run,
not from memory.

---

## What a reviewer can actually try

1. **Watch the overlay respond.** Switch between a few applications and type.
   The headline momentum and the rhythm chart move with what you are doing now
   — `GET /api/metrics/rhythm` scores a trailing window at each step rather than
   re-aggregating the whole session.
2. **Let it find a workflow.** Repeat a three-application sequence a few times.
   It appears under *Workflows* with a repeat count and a confidence.
3. **Build a plan and authorize it.** The dashboard's three-stage builder ends
   in a consent card naming the connector, the operation, the resource, and
   every bound parameter. Approving raises Touch ID.
4. **Try to break it.** Change the plan between the consent card and `/execute`
   — add an application to the bound list — and it fails `param_mismatch`. Send
   the same token twice and the second fails `replayed`. Both refusals are
   recorded: `npm run broker:test` drives every case in
   `packages/grant/vectors/tamper.json`, and `GET /api/automation/chain` shows
   what landed.
5. **Ask why.** Any recommendation or assistant answer expands into the exact
   sanitized aggregates it was composed from.
6. **Turn things off.** *Settings → Privacy* disables each source
   independently and the backend stops accepting it at ingestion; the overlay's
   own control pauses collection outright.

---

## What is novel here

- **Consent that survives inspection.** Most "AI agent" demos authorize
  themselves. Here the thing that makes an action legal is a Secure Enclave
  signature over the specific plan you saw, checked by a process that cannot
  mint one.
- **A privacy boundary that is a type, not a promise.** Recommendations, the
  assistant and the spoken briefing all draw from one
  `SanitizedBehaviorContext`. There is no second path a model provider could be
  bolted onto.
- **Keyboard timing without an event tap.** Reading `CGEventSource` counters
  gives typing *rate* while making key content structurally unavailable — and
  prompts for no permission at all.
- **An always-on-top strip, not a dashboard you visit.** The primary surface is
  a draggable top-center overlay that expands downward without covering the app
  you are using.
- **Refusals are first-class.** A tamper attempt produces a typed error code and
  a chain entry, which is why the tamper suite can assert on them.

---

## Repository layout

```
overlay-prototype/        the product
  src/                    React overlay + dashboard
  electron/               main process, collector manager, voice proxy
  backend/                FastAPI: scoring, workflows, recommendations, assistant
  broker/                 grant verification, connectors, audit chain
  signer/                 Swift Secure Enclave signer
  collector/              Swift input counter
  packages/grant/         shared canonicalizer, types, frozen vectors
  config/, data/          scoring weights, synthetic bootstrap rows
  AGENTS.md               product direction and design rules
  SIGNING.md              where the signing spec could not be followed, and why
  VOICE.md                ElevenLabs setup
  backend/README.md       routes, data policy, record/replay
CHANGES.md                what changed in the most recent pass
techspecsigner.md         the signing specification being implemented
app/, components/         an earlier web-dashboard pass on a vinext starter,
                          superseded by overlay-prototype and kept for reference
```

The root `app/` surface is a static Next/vinext mock from the first commit — it
fetches nothing. Run it with `npm install && npm run dev` from the repository
root if you want to see it; it is not the demo.

---

## Privacy, concretely

- No raw keystrokes, clipboard contents, screenshots, passwords, tokens or text
  content are accepted into the event store.
- Window titles are disabled by default and this build does not capture them.
- Synthetic bootstrap rows keep `data_origin=synthetic_bootstrap` and are never
  written into personal history; replayed events are tagged `replay_observed`,
  so a replay cannot masquerade as live.
- Voice audio never reaches the Python service. Electron mints a single-use
  ElevenLabs token and proxies audio; only the resulting transcript is sent on,
  and neither transcripts nor briefing text are written to the audit log.
  Requests set `enable_logging=false`, and if the account is not eligible for
  provider-side zero retention, the app surfaces that warning rather than hiding
  it.
- Each privacy toggle is enforced at ingestion, in
  `backend/app/ingestion/service.py` — turning off application activity stores
  `"Private application"`, and a disabled source's events are dropped before
  they reach the store, not filtered on the way out.

One known leak, written down rather than hidden: detector-generated workflow
names are built from application names ("Jira → Vs Code → Terminal") and cross
the explanation boundary. Harmless for the local fallback explainer, but it
would disclose the application stack to an external provider.

---

## Known gaps

- `permission_request` is fire-and-forget over the WebSocket, so a plan created
  while the renderer is reconnecting is never shown and cannot be reached.
- A cancelled or failed Touch ID leaves no trace in the chain or in
  `audit_events` — it happens entirely in the Electron→signer path.
- The overlay's "Hide overlay" has no way back: no tray icon, no global
  shortcut, and `preload.cjs` exposes `hide` but not `show`.
- `conftest.py` gives the whole backend suite one database, so the tests are
  order-sensitive.
- The workflow detector title-cases application names before storing them, so
  `ChatGPT` is recorded as `Chatgpt`. Harmless on macOS, which resolves
  application names case-insensitively.
- Ad-hoc code signing means the Enclave key must be re-minted after every signer
  rebuild; a stable Developer ID identity would fix it.
- *Settings → Application exclusions* ("Password Manager, Banking, Personal
  Messages…") is copy, not behavior: nothing enforces a per-application
  exclusion list yet and "Manage exclusions" is inert. The per-source privacy
  toggles beside it are real.
