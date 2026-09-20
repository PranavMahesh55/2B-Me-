from __future__ import annotations

import base64
import hashlib
from time import perf_counter

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.db.models import (
    AutomationPlan,
    AutomationRun,
    GrantReceipt,
    WorkflowDefinition,
)


ALLOWED_ACTIONS = {"open_application", "prepare_context", "draft_response"}
ALLOWED_PERMISSIONS = {
    "open_application",
    "read_active_window",
    "draft_email",
    "share_clipboard",
}

# Mirrors OPERATIONS in packages/grant/types.ts. §7 step 7 checks the
# (connector, operation) pair, so these two tables have to agree.
CONNECTOR_BY_OPERATION = {
    "open_application": "desktop",
    "prepare_context": "workflow",
    "draft_response": "mail",
    "summarize_clipboard": "chatgpt",
}

SUMMARY_PROMPT = "Summarize this section in five bullet points, then list any claims that need checking."


def _clipboard() -> str:
    """The copied section.

    Read here, at plan time, only so the consent card can show what would be
    sent and the grant can bind its hash. The content itself is never stored:
    the behavioural event store rejects content by design, and only the digest
    and a short excerpt travel with the plan.
    """
    import subprocess

    try:
        return subprocess.run(
            ["/usr/bin/pbpaste"], capture_output=True, text=True, timeout=2
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""

# AutomationPlan.safety_level is this prototype's version of the spec's risk.
RISK_BY_SAFETY_LEVEL = {1: "low", 2: "medium", 3: "high"}


def plan_risk(plan: AutomationPlan) -> str:
    return RISK_BY_SAFETY_LEVEL.get(plan.safety_level, "high")


def plan_intent(plan: AutomationPlan) -> dict:
    """The Plan the user authorizes, derived from the stored AutomationPlan.

    The whole action list is folded into a bound param, so adding an action
    changes that param's hash and the plan hash, and the broker rejects it at
    §7 step 6 rather than quietly running more than was shown.
    """
    applications = [
        action["application"]
        for action in plan.actions
        if action.get("type") == "open_application" and action.get("application")
    ]

    # When the observed workflow runs through ChatGPT and a section is already
    # copied, the step worth reproducing is the content one, not the window
    # shuffling. The digest binds that exact section into the grant, so the
    # broker refuses if the clipboard changed between consent and execution --
    # agreeing to summarize one passage must not authorize sending the next
    # thing you copy.
    copied = _clipboard()
    uses_chatgpt = any("chatgpt" in str(name).lower() for name in applications)
    if uses_chatgpt and copied.strip():
        digest = base64.urlsafe_b64encode(
            hashlib.sha256(copied.encode("utf-8")).digest()
        ).decode("ascii").rstrip("=")
        excerpt = " ".join(copied.split())[:110]
        return {
            "connector": "chatgpt",
            "operation": "summarize_clipboard",
            "resource": f"workflow:{plan.workflow_id}",
            "params": {
                "prompt": SUMMARY_PROMPT,
                "content_sha256": digest,
                "characters": len(copied),
                # Shown on the consent card. Sending content off the device
                # without showing what is being sent would be the whole problem.
                "excerpt": excerpt,
                "applications": applications,
            },
        }

    # Otherwise, reproducing the observed steps means reopening those
    # applications in order, so that is the operation, and the ordered list is a
    # bound param. §7 step 8 then holds the broker to exactly the list shown on
    # the consent card: adding an application afterwards is param_mismatch.
    if applications:
        return {
            "connector": "desktop",
            "operation": "open_application",
            "resource": f"workflow:{plan.workflow_id}",
            "params": {
                "destination": "preview_only",
                "applications": applications,
                "actions": [action["type"] for action in plan.actions],
            },
        }

    terminal = plan.actions[-1]["type"] if plan.actions else "draft_response"
    return {
        "connector": CONNECTOR_BY_OPERATION.get(terminal, "mail"),
        "operation": terminal,
        "resource": f"workflow:{plan.workflow_id}",
        "params": {
            "destination": "preview_only",
            "actions": [action["type"] for action in plan.actions],
        },
    }


def create_plan(db: Session, workflow: WorkflowDefinition) -> AutomationPlan:
    existing = db.scalar(
        select(AutomationPlan)
        .where(
            AutomationPlan.workflow_id == workflow.id,
            AutomationPlan.status.in_(["awaiting_approval", "approved"]),
        )
        .order_by(desc(AutomationPlan.created_at))
    )
    if existing:
        return existing

    applications = list(
        dict.fromkeys(
            step.get("application")
            for step in (workflow.steps or [])
            if step.get("application")
        )
    )
    actions = [
        {"type": "open_application", "application": application}
        for application in applications
    ]
    actions.append({"type": "prepare_context", "workflow_id": workflow.id})
    required_permissions = ["open_application"] if applications else []
    required_permissions.append("read_active_window")
    plan = AutomationPlan(
        workflow_id=workflow.id,
        actions=actions,
        required_permissions=required_permissions,
        safety_level=1,
        status="awaiting_approval",
    )
    db.add(plan)
    db.flush()
    record_audit(db, "automation_planned", workflow_id=workflow.id, plan_id=plan.id)
    return plan


def execute_plan(db: Session, plan: AutomationPlan, *, receipt: dict) -> AutomationRun:
    """Record what the broker already executed against a verified grant.

    The authorization gate is no longer plan.status == "approved" -- that was a
    boolean this process could set for itself. It is now the presence of a
    receipt the broker returned, which it only does after §7 steps 1-9 pass.
    """
    if plan.status == "completed":
        raise PermissionError("This plan has already been executed")
    if plan.safety_level > 1:
        raise PermissionError("Commit-level automation is disabled in this prototype")
    if any(action.get("type") not in ALLOWED_ACTIONS for action in plan.actions):
        raise PermissionError("The plan includes an unsupported action")

    started = perf_counter()
    record_audit(db, "automation_started", workflow_id=plan.workflow_id, plan_id=plan.id)
    result = {
        **receipt["connector_result"],
        "jti": receipt["jti"],
        "audit_index": receipt["audit_index"],
        "audit_hash": receipt["audit_hash"],
    }
    db.add(
        GrantReceipt(
            plan_id=plan.id,
            jti=receipt["jti"],
            outcome="executed",
            audit_index=receipt["audit_index"],
            audit_hash=receipt["audit_hash"],
            executed_at=receipt.get("executed_at"),
        )
    )
    run = AutomationRun(
        plan_id=plan.id,
        status="completed",
        result=result,
        duration_ms=max(1, int((perf_counter() - started) * 1000)),
    )
    db.add(run)
    plan.status = "completed"
    record_audit(
        db,
        "automation_completed",
        workflow_id=plan.workflow_id,
        plan_id=plan.id,
        payload=result,
    )
    return run
