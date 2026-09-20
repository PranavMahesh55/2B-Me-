"""The behavioral assistant.

The answer is built on the backend from a SanitizedBehaviorContext, not in the
renderer. That matters for the reason the README gives: the explanation boundary
is supposed to see sanitized scores and aggregate evidence and nothing else. An
assistant that composes its reply in the browser out of raw `backend.metrics`
bypasses that boundary entirely, so the guarantee would only hold on paths
nobody uses.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.db.models import BehaviorScore, WorkflowDefinition
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import AssistantQuestion
from backend.app.llm.adapter import get_explainer
from backend.app.llm.privacy import ContextSanitizer, SanitizedBehaviorContext
from backend.app.runtime import runtime


router = APIRouter(prefix="/api/assistant", tags=["assistant"])

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "automation": ("automat", "repeat", "workflow", "same thing"),
    "friction": ("slow", "friction", "stuck", "switch", "distract"),
    "focus": ("focus", "concentrat", "productive", "deep work", "best"),
}


def classify(question: str) -> str:
    lowered = question.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in lowered for keyword in keywords):
            return category
    return "behavior"


def compose(category: str, context: SanitizedBehaviorContext) -> str:
    """Every number here comes from the sanitized context, never from the score
    record directly, so the assistant cannot quote something the boundary would
    have stripped."""
    behavior = context.behavior
    evidence = context.evidence
    repeat_count = int(context.workflow.get("repeat_count", 0))

    if category == "automation":
        if repeat_count:
            explanation = get_explainer().explain(context, "automation")
            return (
                f"{explanation.observation} {explanation.reason} "
                f"{explanation.recommendation} Automation potential is "
                f"{round(behavior['automation_potential'] * 100)} with "
                f"{round(behavior['confidence'] * 100)}% model confidence."
            )
        return "No repeated sequence has crossed the workflow threshold yet."

    if category == "friction":
        switches = float(evidence.get("app_switches_per_min", 0.0))
        return (
            f"Current friction is {round(behavior['friction'] * 100)}. "
            f"The strongest evidence is {switches:.1f} application switches per minute, "
            f"scored at {round(behavior['confidence'] * 100)}% confidence."
        )

    if category == "focus":
        return (
            f"Current focus is {round(behavior['focus'] * 100)} with "
            f"{round(behavior['confidence'] * 100)}% model confidence. "
            "This is scored from interaction timing, not from anything you typed or read."
        )

    return (
        f"Focus is {round(behavior['focus'] * 100)} and friction is "
        f"{round(behavior['friction'] * 100)}, at "
        f"{round(behavior['confidence'] * 100)}% model confidence. "
        "This explanation uses scored local events, not raw content."
    )


def current_context(
    db: Session, session_id: str | None = None
) -> tuple[BehaviorScore | None, WorkflowDefinition | None, SanitizedBehaviorContext | None]:
    """Return the newest live score through the one sanctioned privacy boundary.

    Voice briefings use this too. Keeping the lookup here prevents a second
    feature from quietly constructing a wider context than the assistant.
    """
    query = select(BehaviorScore)
    if session_id:
        query = query.where(BehaviorScore.session_id == session_id)
    score = db.scalar(query.order_by(desc(BehaviorScore.created_at)))
    if not score or score.data_origin != "live_observed":
        return score, None, None

    evidence = score.evidence or {}
    observed_repeats = int(evidence.get("workflow_repeat_count", 0) or 0)
    workflow = (
        db.scalar(select(WorkflowDefinition).order_by(desc(WorkflowDefinition.automation_potential)))
        if observed_repeats > 0
        else None
    )
    context = ContextSanitizer().sanitize(
        {
            "name": workflow.name,
            "repeat_count": observed_repeats,
            "average_duration_s": workflow.average_duration_s,
        }
        if workflow
        else None,
        {
            "friction": score.friction,
            "focus": score.focus,
            "automation_potential": score.automation_potential,
            "confidence": score.confidence,
            "evidence": evidence,
        },
    )
    return score, workflow, context


def wants_workflow_draft(question: str) -> bool:
    lowered = question.lower()
    return any(
        phrase in lowered
        for phrase in (
            "turn this into a workflow",
            "create a workflow",
            "create workflow",
            "draft a workflow",
            "draft workflow",
            "build a workflow",
            "make this a workflow",
        )
    )


@router.post("/ask")
def ask(body: AssistantQuestion, db: Session = Depends(get_db)) -> dict:
    score, workflow, context = current_context(db, body.session_id)
    category = classify(body.question)

    # AGENTS.md: keep behavioral conclusions explainable, and never invent
    # personal history while the backend is still collecting evidence.
    if not score or context is None:
        return {
            "answer": (
                "I am still building the local baseline. I will not describe personal "
                "history before there is observed activity to ground it in."
            ),
            "category": category,
            "grounded_in": None,
            "has_live_data": False,
            "model_version": runtime.model_config.version,
            "suggested_action": None,
        }

    record_audit(
        db,
        "assistant_answered",
        session_id=score.session_id,
        workflow_id=workflow.id if workflow else None,
        payload={"category": category},
    )
    db.commit()

    return {
        "answer": compose(category, context),
        "category": category,
        # Returned so the UI can show exactly what the answer was derived from.
        "grounded_in": context.model_dump(),
        "has_live_data": True,
        "model_version": score.model_version,
        "data_origin": score.data_origin,
        "suggested_action": (
            {
                "type": "open_workflow_draft",
                "workflow_id": workflow.id,
                "label": "Review workflow draft",
            }
            if workflow and wants_workflow_draft(body.question)
            else None
        ),
    }
