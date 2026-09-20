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
- The optional LLM boundary receives only sanitized scores and aggregate evidence. The deterministic local fallback keeps analytics working without an external AI service.

## Core routes

- `POST /api/events/batch`
- `POST /api/sessions/start`
- `GET /api/metrics/current`
- `GET /api/workflows`
- `GET /api/recommendations`
- `POST /api/automation/{workflow_id}/plan`
- `POST /api/automation/{plan_id}/approve`
- `POST /api/automation/{plan_id}/execute`
- `GET /api/audit`
- `GET /api/system/status`
- `WS /ws`

Automation is restricted to Level 1 preview preparation. Execution is blocked until every scoped permission is explicitly approved.
