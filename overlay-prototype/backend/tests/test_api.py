from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.db.models import RawEvent
from backend.app.db.session import SessionLocal
from backend.app.main import app


def event_batch(session_id: str, task_id: str) -> list[dict]:
    started = datetime.now(UTC)
    sequence = [
        ("Jira", "open_ticket"),
        ("VS Code", "open_handler"),
        ("Terminal", "run_test"),
        ("Browser", "open_docs"),
    ]
    events = []
    for index, (application, action) in enumerate(sequence * 4):
        events.append(
            {
                "event_id": f"evt_test_{index:03d}",
                "timestamp": (started + timedelta(seconds=index * 4)).isoformat(),
                "session_id": session_id,
                "task_id": task_id,
                "device_id": "device_test",
                "application": application,
                "window_context": "privacy-safe-context",
                "event_type": "navigation" if action == "open_docs" else "application_transition",
                "action": action,
                "duration_ms": 1200,
                "metadata": {"content": "must not persist", "safe_count": index},
                "data_origin": "live_observed",
            }
        )
    return events


def test_end_to_end_local_intelligence_loop():
    with TestClient(app) as client:
        status = client.get("/api/system/status")
        assert status.status_code == 200
        assert status.json()["local_only"] is True
        assert status.json()["seeded_baseline_sessions"] == 3000

        started = client.post(
            "/api/sessions/start",
            json={"title": "Backend integration test", "workflow_type": "coding_debugging"},
        )
        assert started.status_code == 200
        session = started.json()

        batch = client.post(
            "/api/events/batch",
            json={"events": event_batch(session["id"], session["task_id"])},
        )
        assert batch.status_code == 200, batch.text
        metrics = batch.json()
        assert metrics["accepted"] == 16
        assert metrics["has_live_data"] is True
        assert metrics["data_origin"] == "live_observed"
        assert metrics["model_version"] == "behavior-model-v0.1-synthetic-bootstrap"
        assert 0 <= metrics["friction"] <= 1
        assert 0 <= metrics["focus"] <= 1

        current = client.get("/api/metrics/current").json()
        assert current["session_id"] == session["id"]
        assert current["evidence"]["bootstrap_baseline_weight"] == 0.8

        workflows = client.get("/api/workflows").json()
        assert workflows
        assert workflows[0]["repeat_count"] >= 2

        plan = client.post(f"/api/automation/{workflows[0]['id']}/plan")
        assert plan.status_code == 200
        plan_payload = plan.json()

        # The plan now carries what the user will actually authorize.
        assert plan_payload["intent"]["operation"] in {"draft_response", "prepare_context", "open_application"}
        assert plan_payload["risk"] == "low"

        blocked = client.post(f"/api/automation/{plan_payload['id']}/execute")
        assert blocked.status_code == 403

        # /approve is gone: it wrote an approval boolean this process set for
        # itself, which execute_plan no longer reads.
        stale = client.post(
            f"/api/automation/{plan_payload['id']}/approve",
            json={"permissions": plan_payload["required_permissions"]},
        )
        assert stale.status_code == 404

        audit = client.get("/api/audit").json()
        audit_types = {item["event"] for item in audit}
        assert {"workflow_detected", "automation_planned"}.issubset(audit_types)

    with SessionLocal() as db:
        raw_event = db.scalar(select(RawEvent).where(RawEvent.event_id == "evt_test_000"))
        assert "content" not in raw_event.metadata_json
        assert raw_event.metadata_json["safe_count"] == 0


def test_websocket_reports_explicit_system_state():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            message = websocket.receive_json()
            assert message["type"] == "system_status"
            assert message["payload"]["status"] in {"READY", "COLLECTING"}



async def _fake_broker(*, token, plan, tamper=None):
    """Stands in for the broker process.

    The broker's own suite proves §7 steps 1-9; these tests prove FastAPI
    proxies correctly, so they need no signer, no Touch ID and no second
    process.
    """
    return (
        {
            "jti": "jti_test_0001",
            "audit_index": 0,
            "audit_hash": "AAAA",
            "connector_result": {
                "mode": "preview_only",
                "prepared": True,
                "message": "A response draft and workflow context were prepared for user review.",
            },
            "executed_at": 1758300000,
        },
        None,
        200,
    )


def _plan_for(client) -> dict:
    client.post("/api/events/batch", json={"events": event_batch("s_grant", "t_grant")})
    workflows = client.get("/api/workflows").json()
    return client.post(f"/api/automation/{workflows[0]['id']}/plan").json()


def _token_for(plan_payload: dict) -> dict:
    return {"token": {"claims": {"v": 1}, "sig": "x", "alg": "ES256"}, "plan": plan_payload["intent"]}


def test_execute_requires_a_verified_grant(monkeypatch):
    monkeypatch.setattr("backend.app.api.automation.broker_execute", _fake_broker)
    with TestClient(app) as client:
        plan_payload = _plan_for(client)
        plan_id = plan_payload["id"]

        assert client.post(f"/api/automation/{plan_id}/execute").status_code == 403

        executed = client.post(f"/api/automation/{plan_id}/execute", json=_token_for(plan_payload))
        assert executed.status_code == 200
        body = executed.json()
        assert body["result"]["mode"] == "preview_only"
        assert body["jti"] == "jti_test_0001"
        assert body["audit_hash"] == "AAAA"

        audit_types = {item["event"] for item in client.get("/api/audit").json()}
        assert "permission_granted" in audit_types

        # One grant, one execution.
        replay = client.post(f"/api/automation/{plan_id}/execute", json=_token_for(plan_payload))
        assert replay.status_code == 403
        assert replay.json()["detail"]["error"] == "replayed"


def test_execute_rejects_a_plan_the_user_did_not_authorize(monkeypatch):
    called = False

    async def _should_not_run(**kwargs):
        nonlocal called
        called = True
        return (None, "connector_failed", 403)

    monkeypatch.setattr("backend.app.api.automation.broker_execute", _should_not_run)
    with TestClient(app) as client:
        plan_payload = _plan_for(client)
        tampered = _token_for(plan_payload)
        tampered["plan"] = {**tampered["plan"], "resource": "workflow:somewhere-else"}

        response = client.post(f"/api/automation/{plan_payload['id']}/execute", json=tampered)
        assert response.status_code == 403
        assert response.json()["detail"]["error"] == "plan_mismatch"
        assert called is False, "a mismatch must not reach the broker or burn the grant"


def test_execute_surfaces_broker_error_codes(monkeypatch):
    async def _expired(**kwargs):
        return (None, "expired", 403)

    monkeypatch.setattr("backend.app.api.automation.broker_execute", _expired)
    with TestClient(app) as client:
        plan_payload = _plan_for(client)
        response = client.post(f"/api/automation/{plan_payload['id']}/execute", json=_token_for(plan_payload))
        assert response.status_code == 403
        assert response.json()["detail"]["error"] == "expired"

        denied = {item["event"] for item in client.get("/api/audit").json()}
        assert "permission_denied" in denied
