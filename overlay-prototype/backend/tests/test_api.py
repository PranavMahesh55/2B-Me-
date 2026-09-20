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
        privacy = client.get("/api/privacy").json()
        assert privacy["window_titles"] is False
        assert privacy["clipboard_metadata"] is False
        assert privacy["visual_interpretation"] is False

        started = client.post(
            "/api/sessions/start",
            json={"title": "Backend integration test", "workflow_type": "coding_debugging"},
        )
        assert started.status_code == 200
        session = started.json()
        assert sum(
            item["status"] == "active"
            for item in client.get("/api/sessions?limit=100").json()
            if item["device_id"] == "device_local"
        ) == 1

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

        active = client.get(
            "/api/sessions/active",
            params={"device_id": "device_local", "workflow_type": "coding_debugging"},
        )
        assert active.status_code == 200
        assert active.json()["id"] == session["id"]
        assert active.json()["task_id"] == session["task_id"]

        scoped_current = client.get(
            "/api/metrics/current", params={"session_id": session["id"]}
        ).json()
        assert scoped_current["session_id"] == session["id"]
        scoped_history = client.get(
            "/api/metrics/history", params={"session_id": session["id"], "limit": 10}
        ).json()
        assert scoped_history
        assert {item["session_id"] for item in scoped_history} == {session["id"]}

        workflows = client.get("/api/workflows").json()
        assert workflows
        assert workflows[0]["repeat_count"] >= 2

        plan = client.post(f"/api/automation/{workflows[0]['id']}/plan")
        assert plan.status_code == 200
        plan_payload = plan.json()

        blocked = client.post(f"/api/automation/{plan_payload['id']}/execute")
        assert blocked.status_code == 403

        approved = client.post(
            f"/api/automation/{plan_payload['id']}/approve",
            json={"permissions": plan_payload["required_permissions"]},
        )
        assert approved.status_code == 200
        executed = client.post(f"/api/automation/{plan_payload['id']}/execute")
        assert executed.status_code == 200
        assert executed.json()["result"]["mode"] == "preview_only"

        audit = client.get("/api/audit").json()
        audit_types = {item["event"] for item in audit}
        assert {"workflow_detected", "automation_planned", "permission_granted", "automation_completed"}.issubset(audit_types)

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
