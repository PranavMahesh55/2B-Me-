# 2Bᵐᵉ local intelligence service

The backend binds only to `127.0.0.1:8765`. Electron starts it automatically and waits for `/api/system/status` before opening the renderer.

## Local setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm run desktop
```

For backend-only development:

```bash
npm run backend:dev
npm run backend:test
```

## Data policy

- `data/synthetic_behavior_sessions.csv` is loaded only as aggregate bootstrap calibration.
- Synthetic rows retain `data_origin=synthetic_bootstrap` and are never written into personal session history.
- New renderer events are stored as `live_observed`.
- The macOS collector reads only the frontmost application name through the built-in Launch Services utility; it does not request Accessibility or Screen Recording access.
- Window titles are disabled by default and the collector does not capture them in the current build.
- No raw keystrokes, clipboard contents, screenshots, passwords, tokens, or text content are accepted into the behavioral event store.
- The explanation boundary receives only a `SanitizedBehaviorContext` — scored aggregates and an allow-listed subset of evidence keys. It is the single source of recommendation and assistant wording, so a provider cannot be added on a path that skips it. `get_explainer()` in `app/llm/adapter.py` is where one would be chosen; this build always returns the deterministic local fallback.
- Known limitation: `workflow["name"]` crosses that boundary, and detector-generated names are built from application names ("Jira → Vs Code → Terminal"). That is harmless for the local fallback but would disclose the application stack to an external provider.

## Core routes

- `POST /api/events/batch`
- `POST /api/sessions/start`
- `GET /api/metrics/current`
- `GET /api/workflows`
- `GET /api/recommendations`
- `POST /api/automation/{workflow_id}/plan`
- `POST /api/automation/{plan_id}/execute`
- `GET /api/automation/chain`
- `POST /api/assistant/ask`
- `GET /api/audit`
- `GET /api/system/status`
- `WS /ws`

Automation is restricted to Level 1 preview preparation.

Execution requires a grant signed by this Mac's Secure Enclave and verified by a
separate broker process — see `../SIGNING.md`. `POST /{plan_id}/approve` was
removed: it recorded an approval boolean this process set for itself, which is
not an authorization, since anything able to write that row could also authorize
itself. `/execute` now takes `{token, plan}` and answers with a `GrantErrorCode`
when the broker refuses.

## Record and replay

```bash
.venv/bin/python -m backend.app.replay.recorder <session_id> --out session.jsonl
.venv/bin/python -m backend.app.replay.replay session.jsonl
```

The recorder writes exactly what the replayer reads. Replayed events are tagged
`replay_observed`, so a replay never masquerades as live history.
