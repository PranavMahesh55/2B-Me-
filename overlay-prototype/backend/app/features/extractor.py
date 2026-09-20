from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime
from typing import Iterable

from backend.app.db.models import RawEvent


def _ratio(numerator: float, denominator: float, default: float = 0.0) -> float:
    return numerator / denominator if denominator else default


def _entropy(values: Iterable[str]) -> float:
    values = list(values)
    if len(values) < 2:
        return 0.0
    counts = Counter(values)
    if len(counts) == 1:
        return 0.0
    total = len(values)
    raw = -sum((count / total) * math.log2(count / total) for count in counts.values())
    return raw / math.log2(len(counts))


def _token(event: RawEvent) -> str:
    application = (event.application or "UNKNOWN").upper().replace(" ", "_")
    action = (event.action or event.event_type).upper().replace(" ", "_")
    return f"APP:{application}|ACTION:{action}"


def _workflow_tokens(events: list[RawEvent]) -> list[str]:
    eligible_types = {
        "application_transition",
        "navigation",
        "click",
        "keyboard_activity",
        "correction",
        "clipboard_action",
        "automation_action",
    }
    ignored_apps = {"2BME", "ELECTRON"}
    result: list[str] = []
    for event in events:
        if event.event_type not in eligible_types:
            continue
        application = (event.application or "UNKNOWN").upper().replace(" ", "_")
        if application in ignored_apps:
            continue
        token = _token(event)
        if not result or result[-1] != token:
            result.append(token)
    return result


def extract_features(
    events: list[RawEvent],
    *,
    baseline_duration_s: float = 900.0,
    known_workflow_repeats: int = 0,
) -> dict[str, float | bool | list[str]]:
    if not events:
        return {
            "duration_s": 0.0,
            "app_switches_per_min": 0.0,
            "backtrack_rate": 0.0,
            "repeated_action_ratio": 0.0,
            "correction_rate": 0.0,
            "hesitation_ms_p50": 0.0,
            "idle_ratio": 0.0,
            "navigation_efficiency": 1.0,
            "action_sequence_entropy": 0.0,
            "workflow_repeat_count": known_workflow_repeats,
            "predictable_sequence_score": 0.0,
            "duration_over_baseline": 0.0,
            "completion_success": False,
            "sustained_active_ratio": 1.0,
            "keystrokes_per_min": 0.0,
            "tokens": [],
            "workflow_tokens": [],
        }

    ordered = sorted(events, key=lambda item: item.timestamp)
    timestamps: list[datetime] = [event.timestamp for event in ordered]
    elapsed_ms = max(
        1.0,
        (timestamps[-1] - timestamps[0]).total_seconds() * 1000
        + max(ordered[-1].duration_ms, 1),
    )
    duration_s = elapsed_ms / 1000
    applications = [event.application for event in ordered if event.application]
    transitions = [
        (applications[index - 1], applications[index])
        for index in range(1, len(applications))
        if applications[index - 1] != applications[index]
    ]
    app_switches = len(transitions)
    backtracks = sum(
        1
        for index in range(2, len(applications))
        if applications[index] == applications[index - 2]
        and applications[index] != applications[index - 1]
    )

    tokens = [_token(event) for event in ordered]
    workflow_tokens = _workflow_tokens(ordered)
    token_counts = Counter(tokens)
    repeated_actions = sum(count for count in token_counts.values() if count > 1)
    relevant_actions = sum(
        1
        for event in ordered
        if event.event_type
        in {"keyboard_activity", "click", "navigation", "correction", "clipboard_action"}
    )
    corrections = sum(1 for event in ordered if event.event_type == "correction")
    idle_ms = sum(
        event.duration_ms for event in ordered if event.event_type == "idle" or event.action == "idle"
    )
    deltas = [
        max(0.0, (timestamps[index] - timestamps[index - 1]).total_seconds() * 1000)
        for index in range(1, len(timestamps))
    ]
    hesitation_ms_p50 = statistics.median(deltas) if deltas else 0.0

    navigation = [event for event in ordered if event.event_type == "navigation"]
    nav_states = [event.window_context or event.action for event in navigation]
    unique_nav_states = len(set(nav_states))
    navigation_efficiency = min(1.0, _ratio(unique_nav_states, len(nav_states), 1.0))

    transition_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for previous, current in zip(tokens, tokens[1:]):
        transition_counts[previous][current] += 1
    predictable_edges = sum(max(counts.values()) for counts in transition_counts.values())
    total_edges = max(1, len(tokens) - 1)
    predictable_sequence_score = predictable_edges / total_edges if transition_counts else 0.0

    completion_success = any(
        event.event_type == "task_marker" and event.action in {"complete", "completed", "stop"}
        for event in ordered
    )

    # Typing volume, from CGEventSource counters the collector diffs between
    # samples. metadata holds counts only -- no keycodes, no characters.
    keystrokes = sum(
        int((event.metadata_json or {}).get("keys", 0) or 0)
        for event in ordered
        if event.event_type == "keyboard_activity"
    )

    return {
        "duration_s": round(duration_s, 4),
        "keystrokes_per_min": round(keystrokes / max(duration_s / 60, 1 / 60), 4),
        "app_switches_per_min": round(app_switches / max(duration_s / 60, 1 / 60), 4),
        "backtrack_rate": round(_ratio(backtracks, max(1, len(transitions))), 4),
        "repeated_action_ratio": round(_ratio(repeated_actions, len(tokens)), 4),
        "correction_rate": round(_ratio(corrections, max(1, relevant_actions)), 4),
        "hesitation_ms_p50": round(hesitation_ms_p50, 4),
        "idle_ratio": round(min(1.0, idle_ms / elapsed_ms), 4),
        "navigation_efficiency": round(navigation_efficiency, 4),
        "action_sequence_entropy": round(_entropy(tokens), 4),
        "workflow_repeat_count": known_workflow_repeats,
        "predictable_sequence_score": round(min(1.0, predictable_sequence_score), 4),
        "duration_over_baseline": round(duration_s / max(baseline_duration_s, 1.0), 4),
        "completion_success": completion_success,
        "sustained_active_ratio": round(max(0.0, 1.0 - idle_ms / elapsed_ms), 4),
        "tokens": tokens,
        "workflow_tokens": workflow_tokens,
    }
