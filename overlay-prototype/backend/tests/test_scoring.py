from backend.app.config.settings import ModelConfig, settings
from backend.app.scoring.engine import ScoringEngine
from backend.app.synthetic.loader import load_synthetic_baselines


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

