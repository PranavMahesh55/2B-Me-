# 2Bᵐᵉ

**A Mac app that notices the work you repeat without realising it — and then asks permission, with your fingerprint, before it does any of it for you.**

### ▶ Try it now: **[2bme-coral.vercel.app](https://2bme-coral.vercel.app)**
### 🎬 Watch the 31-second film: [`brag-output/brag.mp4`](brag-output/brag.mp4)

---

## The problem

You never file a ticket to automate the four-minute Jira → VS Code → Terminal
shuffle you do six times a week. Not because it isn't worth automating — because
you have never once thought of it as a task. It's just what opening your laptop
feels like.

Software can't fix a problem you haven't noticed. So 2Bᵐᵉ notices it for you.

And then it hits the real wall: **why would you let a background program click
things on your computer?** Most "AI agents" answer that by simply deciding they
have permission. 2Bᵐᵉ can't. That's the whole project.

---

## What it does

**1. Watches — on your machine, and only your machine.**
It sees which app is in front and how fast you're typing. Not *what* you type:
it reads a counter of how many keys have been pressed, so the words are
structurally unavailable, and it never asks for the scary macOS permissions.

**2. Finds the loop.**
Three apps in the same order, over and over, becomes a named workflow with a
count, an average duration, and a confidence score.

**3. Tells you, out loud.**
Hold the microphone and ask "what am I repeating?" It answers in a real voice
(ElevenLabs), from numbers scored on your own Mac. Your audio is never stored
and never reaches the app's own server.

**4. Does it for you — but only with your fingerprint.**
It shows you a card listing every single thing it is about to do. You press
Touch ID. It runs, and writes a receipt.

---

## The part that's actually hard

Here's a bug we shipped, found, and deleted — it explains the whole architecture.

The first version had a button that called `approve`, which set a flag in the
database saying `approved = true`. Then the code checked that flag before doing
anything.

Look at what that actually protects: **nothing.** The program set the flag for
itself. Anything that could write that row could also grant itself permission.
It looked like a security check and was a comment with extra steps.

So we deleted it, and rebuilt permission as something the software genuinely
cannot forge:

- Pressing Touch ID makes the **Secure Enclave** — a separate chip in your Mac
  that no program, including this one, can read the key out of — sign a note
  describing *that exact action*.
- A **different program** checks that signature before anything runs. It can
  verify a signature; it cannot create one.
- The signature is **bound to the specific plan you saw**. Add an app to the
  list after you approved it and it's rejected. Use the same approval twice and
  the second one is rejected.
- Every run **and every rejection** is written to a tamper-evident chain, so
  there's a log you can check afterwards.

That's the line in the film: *"The broker refused it. Nothing ran."*

Most agent demos are impressive because of what they'll do. This one is
impressive because of what it won't.

---

## Try it in 60 seconds

Go to **[2bme-coral.vercel.app](https://2bme-coral.vercel.app)** and:

1. **Look at the strip** floating over the fake mail app. That's the product —
   it sits above your work instead of being a dashboard you visit.
2. **⋯ → Open dashboard → Workflows.** It's found `Jira → VS Code → Terminal`,
   seen 19 times, 86% confidence.
3. **Create workflow → Review permissions → Authorize with Touch ID.**

That last step will refuse you: *"Open the desktop app to authorize — a browser
preview can't reach this Mac's signing key."*

**That refusal is not a broken demo. It is the product working.** A web page
genuinely cannot reach the chip in your laptop, and we didn't fake it so the
demo would look better. Everything else on that page is a real capture of the
running system; the one thing we refused to fake is the one thing that matters.

To see it succeed, watch the film — or run it for real below.

---

## Run the real thing

Needs a Mac with Touch ID, Node 22+, and Python 3.

```bash
cd overlay-prototype

npm install
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt

npm run signer:build        # Swift + Secure Enclave
npm run signer:check        # 26 cross-language checks
./collector/bin/build       # the Swift input counter

cp broker/config/broker.config.example.json broker/config/broker.config.json
./signer/bin/export-pubkey  # paste output into signer_public_key_spki_b64u
```

Then three terminals:

```bash
./signer/.build/release/grant-signer serve \
    --secret-file .runtime/launch-secret --debug   # the Touch ID prompt
npm run broker:dev          # verifies signatures, runs actions, writes the log
npm run desktop:dev         # the app (it starts the Python service itself)
```

> **One gotcha:** the signer keeps two separate keys. The default (`production`)
> asks for Touch ID — that's the one to demo. `npm run signer:dev` is a shortcut
> that uses a *different* key and skips the fingerprint entirely, so pair it with
> `./signer/bin/export-pubkey --role test` or every action will be rejected.

**Want to see it actually open your apps?** Set `"desktop_actions": true` in
`broker/config/broker.config.json`. It's off by default, because "preview only"
should mean preview only until you say otherwise.

**Voice (optional):** `export ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=...`
before launching. Without them the app runs fine and the voice panel says so.

---

## How it's built

Five separate programs, in four languages, split by what each is trusted with.
Nothing listens on the network — it is all loopback.

| Part | Language | Holds |
|---|---|---|
| Signer | Swift + Secure Enclave | the signing key, and nothing else |
| Broker | TypeScript | verification, the actions, the audit chain |
| Backend | Python (FastAPI) | scoring, workflows, plans |
| Collector | Swift | which app is in front, typing rate |
| App | Electron + React | the overlay, the dashboard, voice |

**~15,300 lines across Swift, Python, TypeScript and JavaScript.**

**103 tests, all passing:**

```bash
npm run backend:test        # 22  scoring, routes, the privacy boundary
npm run broker:test         # 47  signature checks and forgery attempts
npm run signer:check        # 26  Swift and JavaScript agreeing byte-for-byte
npm run test:sites          #  8  hosting, voice, voice security
npm run broker:verify-chain #     re-walks the audit log and reports its head
```

Those 47 broker tests are mostly attacks on ourselves: tampered signatures,
reused approvals, altered plans, swapped parameters. Each one has to fail with
the right named error *and* leave a record.

---

## Privacy, in plain terms

- Your keystrokes are counted, never read. No screenshots, no clipboard, no
  window titles, no passwords.
- Nothing is sent anywhere. The scoring runs on your Mac.
- Voice audio goes straight from the app to ElevenLabs with a single-use token
  and is never stored; our own service only ever sees the resulting text.
- Anything the AI explains is built from a small typed bundle of *scores* — it
  can't see raw events even if it wanted to, because there is no code path that
  would hand them over.
- Every source can be switched off individually, and switching one off stops the
  data being accepted, not just hidden.

---

## What isn't finished

Written down because a demo that hides its edges isn't worth trusting.

- The "Application exclusions" list in Settings is wording only — nothing
  enforces it yet. The per-source toggles next to it are real.
- Cancelling the Touch ID prompt leaves no trace in the audit log.
- "Hide overlay" has no way back — no tray icon, no shortcut.
- Rebuilding the signer invalidates the key and it must be re-exported; a paid
  Apple Developer identity would fix that.
- The backend tests share one database, so they're order-sensitive.

---

## More detail

- [`overlay-prototype/SIGNING.md`](overlay-prototype/SIGNING.md) — the nine
  places the signing spec couldn't be followed literally, and why
- [`overlay-prototype/backend/README.md`](overlay-prototype/backend/README.md) —
  routes and the data policy
- [`overlay-prototype/VOICE.md`](overlay-prototype/VOICE.md) — ElevenLabs setup
- [`brag-output/`](brag-output/) — the film and the project that renders it
