from __future__ import annotations

from time import perf_counter

from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.db.models import (
    AutomationPlan,
    AutomationRun,
    GrantReceipt,
    WorkflowDefinition,
)


ALLOWED_ACTIONS = {"open_application", "prepare_context", "draft_response"}
ALLOWED_PERMISSIONS = {"open_application", "read_active_window", "draft_email"}

# Mirrors OPERATIONS in packages/grant/types.ts. §7 step 7 checks the
# (connector, operation) pair, so these two tables have to agree.
CONNECTOR_BY_OPERATION = {
    "open_application": "desktop",
    "prepare_context": "workflow",
    "draft_response": "mail",
}

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
    actions = [
        {"type": "prepare_context", "workflow_id": workflow.id},
        {"type": "draft_response", "destination": "preview_only"},
    ]
    plan = AutomationPlan(
        workflow_id=workflow.id,
        actions=actions,
        required_permissions=["read_active_window", "draft_email"],
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

