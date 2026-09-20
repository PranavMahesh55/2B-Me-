# Hyperframes Composition Brief: 2Bᵐᵉ

## Objective

Create a short launch-style brag video for 2Bᵐᵉ, a macOS desktop companion that
finds the loops you never noticed you were running, answers questions about them
out loud, reproduces one on request, and refuses a plan you did not authorize.

## Output

- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 31.2 seconds

## Source Material

- Project root: `/Users/rishithravi/Desktop/2B-Me-/overlay-prototype`
- Primary files read: `src/Overlay.jsx`, `src/grantCopy.js`, `src/styles.css`,
  `src/Dashboard.jsx`, `backend/README.md`, `SIGNING.md`, `../README.md`
- Product name: 2Bᵐᵉ
- Tagline / strongest claim: authorization is a Secure Enclave signature over
  the exact plan you saw, verified by a separate process that cannot mint one
- Key UI to recreate: the always-on-top "Halo Strip" overlay capsule, the voice
  card in its listening and response states, and the authorization consent card
- Copy that must appear verbatim (all real strings from the product):
  - `Authorization required`
  - `High risk · expires in 0:58`
  - `Connector` / `Operation` / `Resource` / `Bound details`
  - `Signed on this Mac by the Secure Enclave.`
  - `Authorize with Touch ID`
  - `Not now`
  - `The action carried details you never authorized`
  - `The broker refused it. Nothing ran.`
  - `Active`, `Ask`, `Focused`
  - `Voice presence`, `Listening — release when you're done`, `2Bᵐᵉ response`
  - `Reproduced 3 steps: launched Jira; brought VS Code, Terminal forward.`
  - `The same sequence appeared 6 times.` (assistant, automation category)

## Creative Direction

- Tone preset: `polished`
- Creative direction: a quiet security-product film that is slightly smug about
  the refusal
- Interpretation: few ideas per scene, long holds, no flashing. Entrances are
  short (0.3–0.5s) and followed by real hold time. Two moments are allowed to be
  hard: the authorization landing, and the refusal.
- Angle: nobody asks to automate a thing they never noticed doing. The video
  opens and closes on that blind spot, and in between shows the three things a
  viewer can actually see — it hears you, it does the work, and it refuses.
- Hook: "You did this six times this week." → "You didn't notice. 2Bᵐᵉ did."
- Outro / punchline: the tampered plan is refused, then "It finds the work you
  stopped noticing." / "Then asks before it touches it."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Any redesign of the product's own UI

## Visual Identity

From `overlay-prototype/src/styles.css` `:root`.

- Background: `#102d2c` (`--deep`); panel `#113735` (`--panel-strong`)
- Text: `#f5f7f6` (`--paper`); muted `#70817f` (`--muted`)
- Accent: `#c7f36b` (`--lime`)
- Supporting: `#54a99d` (`--teal`), `#e8735f` (`--alert`)
- Display font: Inter 700/600, shipped locally at `assets/fonts/inter-*.woff2`
  (copied from the project's own build output)
- Body font: Inter 400/500
- Visual references: the capsule's live orb, the mic in its listening state, the
  ElevenLabs tag on the voice card, the lime Touch ID button, the risk pill, and
  the two-column bound-parameter grid

## Storyboard

`brag-output/brag-plan.md` is the creative contract.

1. The work you didn't notice — 4.75s — "You did this six times this week." /
   "You didn't notice. 2Bᵐᵉ did."
2. The strip — 1.59s — the Halo Strip capsule lands over an out-of-focus desktop
3. You ask it out loud — 7.88s — the ElevenLabs voice layer: mic to `Listening`,
   the transcript "What am I repeating?", then `2Bᵐᵉ response` with a locally
   grounded answer, and the loop it means arriving as chips beneath it
4. The consent card — 4.74s — every bound parameter named, then the Touch ID button
5. It actually runs — 4.74s — Touch ID lands, the three applications come forward
   one at a time, and the connector's receipt fills the card
6. The refusal — 3.69s — NEXT RUN: a fourth application added after consent; the
   broker refuses and nothing runs
7. The close — 3.81s — wordmark, "It finds the work you stopped noticing." /
   "Then asks before it touches it."

## Audio

- Audio role: low warm bed with sparse, motion-matched accents
- Audio arc: quiet under the hook → present through the build → dipped under the
  spoken answer so the voice beat reads as a voice beat → back up for the
  reproduce → ducked hard for one dry impact on the refusal → silent by the end
- Music: `assets/music/music.mp3`
  (happy-beats-business-moves-vol-11, 114.84 BPM)
- Music treatment: volume automation lane — 0.16 in, 0.30 through the build,
  0.22 under the voice answer, 0.34 through the reproduce, 0.11 across the
  refusal, fading to 0 by 31.2
- Music cue guidance: preset cues read from the skill's
  `cues/happy-beats-business-moves-vol-11-…music-cues.json`. Strong cues used:
  3.18, 5.28, 6.34, 8.44, 8.96, 9.50, 14.22, 16.86, 17.91, 19.49, 20.02, 20.54,
  21.59, 23.70, 24.23, 27.91, 28.97.
  - **Beat-locked:** capsule **5.28**, voice card **6.34**, the answer **8.44**,
    consent card **14.22**, authorization **19.49**, the tamper **23.70**
  - **Beat-grid:** chips **9.50 / 10.01 / 10.54**, consent row pairs
    **15.81 / 16.34**, application raises **19.49 / 20.02 / 20.54**
- Audio-reactive treatment: subtle. Per-frame bass band drives the live orb's
  scale (≤22% on a 16px dot) and glow radius; overall RMS drives the capsule's
  rim-light opacity. Nothing else. Data pre-extracted to `assets/audio-data.js`.
- Audio-coupled moments:
  - capsule landing — soft warm impact
  - voice card opening — quiet interface switch
  - each application chip — one quiet UI tick on the beat
  - consent card arrival — heavier warm impact
  - each consent row pair — tiny click
  - the fingerprint press — single soft interface cue
  - the authorization landing — one bell, the only success cue in the video
  - each application raise — soft click
  - the receipt — warm impact
  - tampered chip — small wrong-sounding glitch
  - refusal — one dry impact, allowed to ring over ducked music
- SFX selection guidance (all low/medium HF risk per `sfx-analysis.md`):
  - `assets/sfx/land.ogg` — impactSoft_medium_002
  - `assets/sfx/voice.ogg` — interface/switch_002
  - `assets/sfx/chip.ogg` — ui/click2
  - `assets/sfx/card.ogg` — impactSoft_heavy_002
  - `assets/sfx/row.ogg` — interface/click_003
  - `assets/sfx/touch.ogg` — interface/bong_001
  - `assets/sfx/authorized.ogg` — impactBell_heavy_000
  - `assets/sfx/receipt.ogg` — impactSoft_medium_004
  - `assets/sfx/tamper.ogg` — interface/glitch_002
  - `assets/sfx/refuse.ogg` — impactSoft_heavy_000
- Restraint rule: nothing at all under the closing two lines. The video must end
  quieter than it began, because the last thing it showed was nothing happening.

## Hyperframes Instructions

- Standalone top-level `index.html`, root `data-composition-id="main"`,
  `data-duration="31.2"`.
- One paused GSAP timeline registered at `window.__timelines["main"]`.
- Three timed clips: hook (0–4.95), app (4.75–27.65), close (22.55–31.20). The
  capsule, voice card, chip row and consent card all live inside the app clip so
  the strip stays anchored across scenes 2–6.
- Initial hidden states are authored in CSS, never as a zero-duration `tl.set`
  at position 0 — that does not render at the playhead's own position.
- Deliberate state swaps (mic idle/listening, voice listening/response, authorize
  idle/waiting/done, receipt/alert in one lane) are marked
  `data-layout-allow-overlap` so the layout audit reads them as crossfades.
- Animate inner wrappers, never the `.clip` elements.
- Inter is declared with `@font-face` against the local woff2 files.
- Run `npx hyperframes check` before render — it is brag's single gate.
