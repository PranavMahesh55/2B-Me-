from backend.app.config.settings import ModelConfig, settings
from backend.app.scoring.engine import ScoringEngine
from backend.app.synthetic.loader import load_synthetic_baselines
from backend.app.llm.privacy import ContextSanitizer
from backend.app.workflows.detector import _candidate


def test_synthetic_loader_preserves_expected_shape():
    baselines = load_synthetic_baselines(settings.synthetic_data_path)
    assert sum(item["session_count"] for item in baselines.values()) == 3000
    assert set(baselines) == {
        "coding_debugging",
        "deep_work",
        "repetitive_admin",
        "research_browsing",
        "support_lookup",
    }


def test_synthetic_regression_ordering():
    baselines = load_synthetic_baselines(settings.synthetic_data_path)
    config = ModelConfig.load(settings.model_path)
    engine = ScoringEngine(config)
    scores = {
        workflow: engine.score(
            {
                **values["averages"],
                "duration_over_baseline": 1.0,
                "sustained_active_ratio": 1.0 - values["averages"]["idle_ratio"],
            }
        )
        for workflow, values in baselines.items()
    }
    assert scores["repetitive_admin"].automation_potential > scores["coding_debugging"].automation_potential
    assert scores["deep_work"].focus > scores["coding_debugging"].focus
    assert baselines["coding_debugging"]["averages"]["correction_rate"] > baselines["deep_work"]["averages"]["correction_rate"]


def test_configured_scores_are_bounded():
    engine = ScoringEngine(ModelConfig.load(settings.model_path))
    score = engine.score(
        {
            "duration_s": 99999,
            "app_switches_per_min": 99,
            "backtrack_rate": 4,
            "repeated_action_ratio": 4,
            "correction_rate": 4,
            "hesitation_ms_p50": 99999,
            "idle_ratio": 2,
            "navigation_efficiency": -4,
            "action_sequence_entropy": 4,
            "workflow_repeat_count": 99,
            "predictable_sequence_score": 4,
            "duration_over_baseline": 99,
            "sustained_active_ratio": -1,
        }
    )
    assert 0 <= score.friction <= 1
    assert 0 <= score.focus <= 1
    assert 0 <= score.automation_potential <= 1
    assert 0 <= score.confidence <= 0.99


def test_llm_context_excludes_raw_content_and_identifiers():
    sanitized = ContextSanitizer().sanitize(
        {"name": "Customer lookup", "repeat_count": 8, "average_duration_s": 92, "customer_email": "private@example.com"},
        {
            "friction": 0.61,
            "focus": 0.55,
            "automation_potential": 0.78,
            "confidence": 0.88,
            "evidence": {
                "app_switches_per_min": 4.2,
                "workflow_repeat_count": 8,
                "clipboard_contents": "secret",
            },
        },
    ).model_dump()
    rendered = str(sanitized)
    assert "private@example.com" not in rendered
    assert "secret" not in rendered
    assert sanitized["evidence"]["workflow_repeat_count"] == 8


def test_workflow_candidate_rejects_passive_repetition_and_counts_non_overlapping_traces():
    passive = ["APP:CHATGPT|ACTION:ACTIVE"] * 12
    assert _candidate(passive) is None

    trace = [
        "APP:CHROME|ACTION:OPEN_DOCS",
        "APP:CODE|ACTION:EDIT_FILE",
        "APP:TERMINAL|ACTION:RUN_TEST",
    ]
    candidate = _candidate(trace * 3)
    assert candidate is not None
    assert candidate[0] == tuple(trace)
    assert candidate[1] == 3


def test_explainer_covers_every_recommendation_class_it_is_asked_for():
    from backend.app.llm.adapter import get_explainer

    context = ContextSanitizer().sanitize(
        {"name": "Customer lookup", "repeat_count": 8, "average_duration_s": 92},
        {
            "friction": 0.61,
            "focus": 0.55,
            "automation_potential": 0.78,
            "confidence": 0.88,
            "evidence": {"app_switches_per_min": 4.2, "backtrack_rate": 0.5},
        },
    )
    explainer = get_explainer()
    titles = {
        kind: explainer.explain(context, kind).title
        for kind in ("automation", "workflow_consolidation", "friction_reduction")
    }
    # Every class the recommendations service can pick must get its own wording,
    # or one of them silently falls back to the automation text.
    assert len(set(titles.values())) == 3
    assert all(explainer.explain(context, kind).confidence == 0.88 for kind in titles)


def test_keystroke_momentum_raises_focus_for_identical_navigation():
    """Two sessions with the same application behaviour, differing only in typing
    volume, must not score the same. Before keystroke_timing was collected, focus
    could only see switching and idling, so a session where the user was
    producing looked identical to one where they were merely not switching."""
    from backend.app.runtime import runtime

    def focus_for(keystrokes_per_min: float) -> float:
        return runtime.scoring.score(
            {
                "duration_s": 600.0,
                "app_switches_per_min": 2.0,
                "backtrack_rate": 0.2,
                "repeated_action_ratio": 0.3,
                "correction_rate": 0.05,
                "hesitation_ms_p50": 400.0,
                "idle_ratio": 0.2,
                "navigation_efficiency": 0.8,
                "action_sequence_entropy": 0.5,
                "workflow_repeat_count": 2,
                "predictable_sequence_score": 0.5,
                "duration_over_baseline": 0.7,
                "sustained_active_ratio": 0.8,
                "keystrokes_per_min": keystrokes_per_min,
            }
        ).as_dict()["focus"]

    quiet = focus_for(0.0)
    typing = focus_for(120.0)
    heavy = focus_for(220.0)

    assert typing > quiet, "typing should register as momentum"
    assert heavy > typing, "more typing should register as more momentum"
    # The weight is 0.18, so the full span is bounded and cannot swamp the
    # navigation signal.
    assert 0.17 < (heavy - quiet) < 0.19
    assert runtime.scoring.score({"keystrokes_per_min": 500.0}).as_dict()["focus"] <= 1.0


def test_keystroke_feature_counts_only_volume():
    """The extractor reads a count out of metadata and nothing else, so a
    keyboard_activity event cannot smuggle content into the feature vector."""
    from datetime import UTC, datetime, timedelta

    from backend.app.db.models import RawEvent
    from backend.app.features.extractor import extract_features

    start = datetime.now(UTC)
    events = [
        RawEvent(
            event_id=f"evt_k_{index}",
            timestamp=start + timedelta(seconds=index * 30),
            session_id="s",
            task_id="t",
            device_id="d",
            application="VS Code",
            window_context=None,
            event_type="keyboard_activity",
            action="input_burst",
            duration_ms=30000,
            metadata_json={"keys": 60, "clicks": 2, "typed": "secret text"},
            data_origin="live_observed",
        )
        for index in range(4)
    ]
    features = extract_features(events)
    assert features["keystrokes_per_min"] > 0
    assert "secret text" not in str(features)
    assert "typed" not in features
