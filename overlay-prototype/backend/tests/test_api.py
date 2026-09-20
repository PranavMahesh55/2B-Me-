from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.db.models import RawEvent
from backend.app.db.session import SessionLocal
from backend.app.llm.privacy import ContextSanitizer
from backend.app.main import app


def event_batch(session_id: str, task_id: str, prefix: str = "test") -> list[dict]:
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
                "event_id": f"evt_{prefix}_{index:03d}",
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
        assert metrics["model_version"] == "behavior-model-v0.1"
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


def test_assistant_refuses_to_invent_history_before_there_is_evidence():
    with TestClient(app) as client:
        reply = client.post(
            "/api/assistant/ask",
            json={"question": "What should I automate?", "session_id": "sess_never_observed"},
        ).json()
        assert reply["has_live_data"] is False
        assert reply["grounded_in"] is None
        assert "baseline" in reply["answer"].lower()


def test_assistant_answers_from_sanitized_evidence_only():
    with TestClient(app) as client:
        session = client.post(
            "/api/sessions/start",
            json={"title": "t", "workflow_type": "coding_debugging", "device_id": "device_local"},
        ).json()
        client.post(
            "/api/events/batch",
            json={"events": event_batch(session["id"], session["task_id"], prefix="assistant")},
        )

        categories = {}
        for question in ["What should I automate?", "What slowed me down?", "When was I most focused?"]:
            reply = client.post("/api/assistant/ask", json={"question": question}).json()
            assert reply["has_live_data"] is True
            categories[reply["category"]] = reply

        assert set(categories) == {"automation", "friction", "focus"}

        grounding = categories["automation"]["grounded_in"]
        # The whole point of the boundary: only scored aggregates cross it.
        assert set(grounding) == {"workflow", "behavior", "evidence"}
        assert set(grounding["evidence"]).issubset(ContextSanitizer.allowed_evidence)
        rendered = str(grounding)
        for leaked in [session["id"], session["task_id"], "device_local"]:
            assert leaked not in rendered
        # Note: workflow["name"] does cross the boundary, and detector-generated
        # names are built from application names ("Jira -> Vs Code -> Terminal").
        # Harmless for the local fallback; it would disclose the user's app stack
        # to an external provider. Flagged rather than changed, because the name
        # is what makes an explanation legible.

        audit_types = {item["event"] for item in client.get("/api/audit").json()}
        assert "assistant_answered" in audit_types


def test_recorded_session_replays_into_a_fresh_store(tmp_path):
    from backend.app.replay.recorder import record_session
    from backend.app.replay.replay import replay

    with TestClient(app) as client:
        session = client.post(
            "/api/sessions/start",
            json={"title": "t", "workflow_type": "coding_debugging", "device_id": "device_local"},
        ).json()
        client.post(
            "/api/events/batch",
            json={"events": event_batch(session["id"], session["task_id"], prefix="replay")},
        )

    path = tmp_path / "session.jsonl"
    with SessionLocal() as db:
        written = record_session(db, session["id"], path)
    assert written == 16

    # The recorder writes exactly what the replayer reads; if the two halves ever
    # drift, NormalizedEvent validation fails here rather than in the field.
    result = replay(path)
    assert result["duplicates"] == written


def test_assistant_never_quotes_a_repeat_count_its_grounding_does_not_show():
    """WorkflowDefinition is global and has no session link, so the newest score
    and the strongest workflow can come from different sessions. Pairing them
    produced an answer that said "appeared 4 times" above a grounding panel
    reading "workflow repeat count 0"."""
    with TestClient(app) as client:
        session = client.post(
            "/api/sessions/start",
            json={"title": "t", "workflow_type": "coding_debugging", "device_id": "device_local"},
        ).json()
        client.post(
            "/api/events/batch",
            json={"events": event_batch(session["id"], session["task_id"], prefix="consistency")},
        )

        reply = client.post(
            "/api/assistant/ask",
            json={"question": "What should I automate?", "session_id": session["id"]},
        ).json()
        grounding = reply["grounded_in"]
        observed = int(grounding["evidence"].get("workflow_repeat_count", 0))

        if observed:
            assert grounding["workflow"]["repeat_count"] == observed
            assert f"appeared {observed} times" in reply["answer"]
        else:
            # No repetition in the evidence means no repetition may be claimed.
            assert "appeared" not in reply["answer"]
            assert grounding["workflow"]["repeat_count"] == 0


def test_rhythm_is_windowed_where_history_is_cumulative():
    """The 60-minute rhythm chart was a flat line because /metrics/history is
    not a rhythm: every BehaviorScore re-aggregates the whole session, so 60
    stored points can hold a single distinct focus value. /metrics/rhythm scores
    a trailing window at each step instead."""
    from datetime import UTC, datetime, timedelta

    with TestClient(app) as client:
        session = client.post(
            "/api/sessions/start",
            json={"title": "t", "workflow_type": "coding_debugging", "device_id": "device_rhythm"},
        ).json()

        # An hour alternating between calm and fragmented stretches.
        start = datetime.now(UTC) - timedelta(hours=1)
        applications = ["VS Code", "Terminal", "Chrome", "Slack", "Jira"]
        events = []
        moment = start
        index = 0
        for phase, per_minute in enumerate([0.6, 3.4, 0.8, 4.6, 1.0, 2.4]):
            phase_end = start + timedelta(minutes=10 * (phase + 1))
            gap = timedelta(seconds=60 / per_minute)
            while moment < phase_end:
                events.append({
                    "event_id": f"evt_rhythm_{index:04d}",
                    "timestamp": moment.isoformat(),
                    "session_id": session["id"],
                    "task_id": session["task_id"],
                    "device_id": "device_rhythm",
                    "application": applications[index % len(applications)],
                    "window_context": "work",
                    "event_type": "application_transition",
                    "action": "focus",
                    "duration_ms": int(gap.total_seconds() * 1000),
                    "metadata": {},
                    "data_origin": "live_observed",
                })
                moment += gap
                index += 1
        for offset in range(0, len(events), 100):
            client.post("/api/events/batch", json={"events": events[offset : offset + 100]})

        rhythm = client.get(
            "/api/metrics/rhythm", params={"session_id": session["id"], "points": 36}
        ).json()
        assert rhythm["session_id"] == session["id"]
        assert len(rhythm["points"]) >= 20

        windowed = {round(point["focus"], 3) for point in rhythm["points"]}
        history = client.get(
            "/api/metrics/history", params={"session_id": session["id"], "limit": 60}
        ).json()
        cumulative = {round(item["focus"], 3) for item in history}

        assert len(windowed) > len(cumulative), (
            f"rhythm should vary more than history: {len(windowed)} vs {len(cumulative)}"
        )
        assert len(windowed) >= 4, "a 60-minute rhythm with six density phases should not be flat"

        # Each point is a measurement over several events, not one transition.
        assert min(point["events"] for point in rhythm["points"]) >= 2
        assert rhythm["points"][0]["minutes_ago"] > rhythm["points"][-1]["minutes_ago"]


def test_windowed_focus_responds_to_typing_where_the_session_score_cannot():
    """"Current session" has to mean current.

    backend.metrics.focus re-aggregates the whole session, so after half an hour
    it barely moves however hard the user is working -- typing for a minute
    cannot shift a thirty-minute average, which is why the overlay's headline
    number looked frozen. The windowed series is the same scorer over a trailing
    window, so it tracks what is happening now.
    """
    from datetime import UTC, datetime, timedelta

    with TestClient(app) as client:
        session = client.post(
            "/api/sessions/start",
            json={"title": "t", "workflow_type": "coding_debugging", "device_id": "device_burst"},
        ).json()

        start = datetime.now(UTC) - timedelta(minutes=30)
        events = []
        index = 0
        for minute in range(30):
            at = (start + timedelta(minutes=minute)).isoformat()
            events.append({
                "event_id": f"evt_burst_{index:04d}", "timestamp": at,
                "session_id": session["id"], "task_id": session["task_id"],
                "device_id": "device_burst", "application": ["VS Code", "Chrome"][minute % 2],
                "window_context": "w", "event_type": "application_transition", "action": "focus",
                "duration_ms": 60000, "metadata": {}, "data_origin": "live_observed",
            })
            index += 1
            # Twenty quiet minutes, then ten of heavy typing. Application
            # behaviour is identical throughout.
            if minute >= 20:
                events.append({
                    "event_id": f"evt_burst_{index:04d}", "timestamp": at,
                    "session_id": session["id"], "task_id": session["task_id"],
                    "device_id": "device_burst", "application": "VS Code",
                    "window_context": "w", "event_type": "keyboard_activity", "action": "input_burst",
                    "duration_ms": 60000, "metadata": {"keys": 160, "clicks": 2},
                    "data_origin": "live_observed",
                })
                index += 1
        for offset in range(0, len(events), 100):
            client.post("/api/events/batch", json={"events": events[offset : offset + 100]})

        points = client.get(
            "/api/metrics/rhythm", params={"session_id": session["id"], "points": 12}
        ).json()["points"]
        assert len(points) >= 8

        quiet = [p for p in points if p["keystrokes_per_min"] == 0]
        typing = [p for p in points if p["keystrokes_per_min"] > 100]
        assert quiet and typing, "the fixture must contain both stretches"

        best_quiet = max(p["focus"] for p in quiet)
        best_typing = max(p["focus"] for p in typing)
        assert best_typing > best_quiet, (
            f"typing must raise windowed focus: {best_typing} vs {best_quiet}"
        )

        # And the reason the headline looked frozen: one number for the lot.
        whole_session = client.get(
            "/api/metrics/current", params={"session_id": session["id"]}
        ).json()["focus"]
        assert min(p["focus"] for p in points) <= whole_session <= max(p["focus"] for p in points)
