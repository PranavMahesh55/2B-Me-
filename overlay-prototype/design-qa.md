# Design QA — 2Bᵐᵉ Desktop Overlay

Date: 2026-09-19

## Sources compared

- Selected design reference: `/Users/pranav/.codex/generated_images/01a0bb49-2a58-7730-93e3-1b70ca09b5a8/exec-fb125939-440c-4db5-b4dd-257aa9fa4132.png`
- Reference size: 1586 × 992 px
- Browser implementation: `http://127.0.0.1:4173/`
- Native implementation: `/Users/pranav/Behavioral AI/overlay-prototype/dist/client/index.html?native=1`
- Implementation capture: live Codex browser and native Electron window captures reviewed at 1440 × 900 CSS px, DPR 1
- State: overlay expanded over an email application; native window also checked collapsed and in full-dashboard mode

## Full-view comparison

- The implementation preserves the selected composition: a compact top activity capsule connected visually to a rounded expanded panel.
- Deep teal, lime status/accent color, soft shadow, translucent desktop context, and compact always-on-top footprint closely match the reference.
- Visual hierarchy remains consistent: current activity first, then momentum/insight, the 60-minute rhythm, and two primary actions.
- Copy was adapted to the attached behavioral-AI specification so the UI communicates inferred activity, evidence, privacy, and tracking state rather than presenting placeholder wellness data.
- The browser canvas uses a deliberately blurred email backdrop only to demonstrate overlay behavior. The production Electron surface is transparent and floats over the user's real applications.

## Focused regions

- Header capsule: brand, live inferred activity, momentum state, timer, tracking state, overflow actions, and collapse control all remain legible at native size.
- Insight region: the primary insight has strong contrast and the “Why this?” control exposes supporting evidence.
- Rhythm chart: chart line, labels, current application context, and time anchors remain readable without competing with the insight.
- Footer controls: Start focus, Capture note, drag affordance, tracking state, and settings are reachable and visually balanced.
- Dashboard handoff: opening the dashboard resizes the native window and preserves the same visual language while exposing Overview, Activity, Workflows, Insights, AI Assistant, and Settings.

## Interaction and implementation checks

- Native production bundle loads successfully through `file://` with portable asset paths.
- Expand/collapse resizes the native always-on-top window correctly.
- Overlay menu opens and the dashboard transition works.
- Browser prototype checks passed for note capture, tracking pause/resume, evidence reveal, workflow navigation, privacy switches, and grounded assistant responses.
- Browser console: no warnings or errors.
- Production build: passed.
- Portable preview/package checks: 4 of 4 passed.

## QA revision history

1. The first native pass inherited the browser's narrow responsive breakpoint and hid the tracking/menu controls. Mobile rules were scoped to the browser preview only.
2. Post-fix native inspection confirmed that all header and footer controls are present in expanded mode and that collapsed mode keeps the complete activity capsule.
3. The Vite base path was changed to a relative path so the packaged Electron build loads correctly outside the development server.

final result: passed
