# Brag Plan: 2Bᵐᵉ

## What is this app?

A macOS desktop companion that watches how you work — locally — finds the loops
you never noticed you were running, answers questions about them out loud, and
will reproduce one for you only after a Touch ID prompt produces a Secure
Enclave signature that a *separate process* verifies before anything runs.

## The angle

Nobody asks to automate a thing they never noticed doing. That is the gap this
product sits in: you do not file a ticket for the four-minute Jira → VS Code →
Terminal shuffle you run six times a week, because you have never once thought
of it as a task.

So the video is a loop: it opens on **the work you did not notice** and closes on
it. In between it does three things a viewer can see — it *hears* you (the
ElevenLabs voice layer answering a spoken question from locally-grounded
aggregates), it *does* the work (the workflow actually reproduced, with a
receipt), and it *refuses* (the same plan tampered with afterwards, rejected).

Every string on screen is real product copy — `src/grantCopy.js`,
`src/Overlay.jsx`, `backend/app/api/assistant.py`, `broker/src/connectors.ts`.

## Hook (first 2-3 seconds)

Two lines on near-black teal:

> You did this six times this week.

hold, then in electric lime:

> You didn't notice. 2Bᵐᵉ did.

It earns the next thirty seconds because it names a thing the viewer recognises
in themselves before it names a product.

## Key moments (the middle)

- **The Halo Strip assembles.** The real always-on-top overlay capsule — 2Bᵐᵉ
  wordmark, pulsing live orb, "Reviewing pull request · Focused · 14:32", the
  Ask mic, the "Active" pill.
- **You ask it out loud.** The mic goes to `Listening`, the voice card opens
  with the real ElevenLabs transport chrome, the transcript "What am I
  repeating?" appears, and the card turns into `2Bᵐᵉ response` with an answer
  composed from the sanitized context — *"The same sequence appeared 6 times.
  Automation potential 74, 87% confidence."* — footed by
  `Audio never stored · answer grounded locally`.
- **It shows the loop it heard about.** `Jira → VS Code → Terminal` arrive one
  by one beneath the answer, so the spoken claim has a picture.
- **The consent card.** Every bound parameter named: Connector, Operation,
  Resource, Bound details, the Secure Enclave footnote, the lime
  **Authorize with Touch ID** button.
- **It actually runs.** Touch ID lands, the three chips light green one at a
  time as the applications come forward, the desktop behind re-stacks, and a
  receipt fills the card: *"Reproduced 3 steps: launched Jira; brought VS Code,
  Terminal forward."* with `written to the audit chain · head oR1bembz…`.

## Outro / punchline

**NEXT RUN.** A fourth application is quietly added to the plan. Bound details
turns red. The green receipt is replaced by the real `param_mismatch` copy:

> **The action carried details you never authorized**
> The broker refused it. Nothing ran.

Then the wordmark, and the bookend:
**It finds the work you stopped noticing.** / **Then asks before it touches it.**

## User flow worth showing

Entry → key action → result, exactly as the product runs it:

1. The strip is up while you work, observing locally.
2. You ask it a question out loud; it answers from scored local aggregates and
   surfaces the repeated sequence it found.
3. It asks permission with every parameter bound, you authorize with Touch ID,
   and it reproduces the workflow and writes a receipt.
4. On the next run the plan carries a step you never authorized, and the broker
   refuses it.

## Tone

- Preset: `polished`
- Creative direction: a quiet security-product film that is slightly smug about
  the refusal
- Interpretation: few ideas per scene, long holds, no flashing. Entrances are
  short (0.3–0.5s) and followed by real hold time. Two moments are allowed to be
  hard: the authorization landing, and the refusal.

## Format: landscape — 1920x1080
## Duration: 31.2 seconds

> **Note on the 15–25s creative law.** This cut is 31.2s. The added voice layer,
> the automation payoff, and the bookended "work you never noticed" framing are
> three more beats than the previous 24.6s cut carried, and each carries copy
> that has to be readable. Compressing to 25s would have meant pulling text off
> screen before it can be read, which the same law forbids. The reason is
> recorded here rather than silently ignored.

## Visual identity (from the project)

Taken from `overlay-prototype/src/styles.css` `:root`.

- Background: `#102d2c` (`--deep`), panel `#113735` (`--panel-strong`)
- Accent: `#c7f36b` (`--lime`), deepened `#93bf3f` (`--lime-deep`)
- Text: `#f5f7f6` (`--paper`) on dark, `#142b29` (`--ink`) on light
- Supporting: `#54a99d` (`--teal`), `#e8735f` (`--alert`), `#70817f` (`--muted`)
- Display font: Inter 700 / 600 (shipped locally, woff2 from the project's build)
- Body font: Inter 400 / 500
- Strongest visual elements: the Halo Strip capsule, the voice card, and the
  authorization consent card with its lime Touch ID button

## Share copy (draft)

You don't file a ticket for the four-minute app shuffle you run six times a
week, because you never noticed doing it. 2Bᵐᵉ notices, tells you out loud, and
then asks — with Touch ID — before it touches anything.

## Audio direction

- Role: low warm bed with sparse, motion-matched accents
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM)
- Music treatment: 0.16 in, ~0.30 through the build, dipped slightly under the
  spoken answer so the voice beat reads as a voice beat, back up for the
  reproduce, ducked hard to 0.11 across the refusal, faded to 0 by 31.2
- Music cue guidance: preset read from
  `cues/happy-beats-business-moves-vol-11-…music-cues.json`.
  Strong cues in window: **3.18, 5.28, 6.34, 8.44, 8.96, 9.50, 12.65, 14.22,
  16.86, 17.91, 19.49, 20.02, 20.54, 23.70, 24.23, 27.39, 27.91, 28.97**.
  - **Beat-locked:** capsule at **5.28**, voice card at **6.34**, the answer at
    **8.44**, consent card at **14.22**, authorization at **19.49**, the tamper
    at **23.70**
  - **Beat-grid:** application chips at **9.50 / 10.01 / 10.54**, consent rows in
    pairs at **15.81 / 16.34**, the three app raises at **19.49 / 20.02 / 20.54**
- Audio-reactive treatment: subtle. Bass drives the live orb's scale and glow;
  RMS drives the capsule rim. During the voice scene the orb's reactivity is
  allowed to read as the microphone being live. Nothing else.
- SFX posture: sparse, motion-matched. One warm impact per major arrival, tiny
  ticks for sequential items, a single bell for the authorization, one dry
  impact for the refusal.
- Restraint rule: nothing under the closing two lines. The video ends quieter
  than it started, because the last thing it showed was nothing happening.

## Storyboard

### Scene 1 — The work you didn't notice — 0.00–4.75 (4.75s)

Full-frame `#102d2c`. "You did this six times this week." enters at 0.30 and
settles by 0.70, holding to 2.65, where it dims back and "You didn't notice.
2Bᵐᵉ did." lands in `#c7f36b` beneath it.
Sequential/interaction: two lines, the second beat-aligned to 2.65.
Audio intent: the bed is already running, quiet. Nothing punctuates the claim.
Music: low warm bed.
Transition mood: clean → Scene 2

### Scene 2 — The strip — 4.75–6.34 (1.59s)

A dimmed, out-of-focus desktop. The Halo Strip capsule slams down into the
top-center position at **5.28** and its internals light left to right: wordmark,
live orb, "Reviewing pull request / Focused · 14:32", the Ask mic, the "Active"
pill.
Sequential/interaction: yes — capsule lands as one object, internals stagger.
Audio intent: one quiet, confident placement.
Audio-coupled idea: soft warm impact on the landing; the orb tracks bass.
Transition mood: soft → Scene 3

### Scene 3 — You ask it out loud — 6.34–14.22 (7.88s)

The mic button in the capsule switches to its `Listening` state and the voice
card opens beneath at **6.34**, carrying the real chrome: the lime
`VOICE PRESENCE` eyebrow, an `ElevenLabs` tag on the right, and the live line
*"Listening — release when you're done"* with a waveform.

At 6.86 the transcript settles: **"What am I repeating?"**

At **8.44** the card turns into `2Bᵐᵉ response` and the answer lands:
**"The same sequence appeared 6 times. Automation potential 74, 87%
confidence."**

Beneath it, at 9.50 / 10.01 / 10.54, the application chips arrive one by one —
**Jira → VS Code → Terminal** — so the spoken claim has a picture. At 11.06 the
footer chip settles: `Audio never stored · answer grounded locally`.

Sequential/interaction: yes — a simulated press-and-release on the mic, then
three chips on the beat grid.
Audio intent: the music dips slightly so this reads as the moment something
speaks.
Audio-coupled idea: a soft switch on the card opening; one quiet tick per chip.
Transition mood: clean → Scene 4

### Scene 4 — The consent card — 14.22–18.96 (4.74s)

Beat-locked to **14.22**. The authorization card rises and expands under the
voice card, which recedes to 40%. In order: the `Authorization required` lime
eyebrow with the `High risk · expires in 0:58` pill (14.22), the headline
"2Bᵐᵉ wants to reproduce this workflow" (14.76), the bound rows in two pairs —
Connector / Operation then Resource / Bound details (15.81, 16.34) — the shield
footnote "Signed on this Mac by the Secure Enclave." (16.86), and the lime
**Authorize with Touch ID** button (17.91).
Sequential/interaction: rows arrive in pairs, deliberately not four singles, so
each pair has time to be read at 115 BPM.
Audio intent: precise and procedural. This must feel engineered.
Audio-coupled idea: warm impact on the card, a tiny tick per row pair.
Transition mood: hard → Scene 5

### Scene 5 — It actually runs — 18.96–23.70 (4.74s)

At 18.96 the button reads **"Waiting for Touch ID…"** and the fingerprint
pulses. At **19.49** the authorization lands: the button turns to a filled
check, and the three application chips light lime one at a time at **19.49 /
20.02 / 20.54** as each application comes forward — the blurred desktop behind
re-stacks with them, so something visibly happened on the machine.

At 21.07 the card's lane fills with the real connector receipt:
**"Reproduced 3 steps: launched Jira; brought VS Code, Terminal forward."**
and at 21.59 a mono chip beneath it: `written to the audit chain · head
oR1bembz…`

Sequential/interaction: yes — three application raises, one per strong cue.
Audio intent: a single bell on the authorization, then two soft clicks for the
remaining raises, then a warm impact under the receipt. This is the only place
in the video allowed to feel like a payoff.
Transition mood: hard → Scene 6

### Scene 6 — The refusal — 23.70–27.39 (3.69s)

A small lime `NEXT RUN` eyebrow appears over the chip row and a fourth chip —
**Slack**, tinted `#e8735f` — drops in at **23.70**, visibly *after* the card
was shown. At 24.23 Bound details turns red: `applications, order, Slack`.

At 24.75 the green receipt is replaced in the same lane by:

> **The action carried details you never authorized**

and at 25.29 the second line settles:

> The broker refused it. Nothing ran.

The Touch ID button goes flat and disabled. Everything holds to 27.39.
Sequential/interaction: yes — the tampering is shown as an action, then answered.
Audio intent: a small wrong-sounding glitch on the added chip, then one dry
impact with the music ducked underneath. Nothing rises afterward.
Transition mood: soft → Scene 7

### Scene 7 — The close — 27.39–31.20 (3.81s)

The stage dims back. The 2Bᵐᵉ wordmark resolves at 27.91, then
**"It finds the work you stopped noticing."** at 28.43 and
**"Then asks before it touches it."** at 28.97. Music fades to nothing by 31.20.
Sequential/interaction: none — three elements, staggered, then stillness.
Audio intent: the video ends quieter than it started. No logo sting.

**Music mood for this video:** restrained upbeat bed used as support, not energy
**Audio summary:** a low warm bed runs the whole way with sparse motion-matched
ticks, dips under the spoken answer, pays off with a single bell when the
authorization lands, ducks for one dry impact on the refusal, and fades to
silence under the closing lines.
