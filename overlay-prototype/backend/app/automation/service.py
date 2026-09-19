from __future__ import annotations

from time import perf_counter

from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.db.models import (
    AutomationPlan,
    AutomationRun,
    PermissionGrant,
    WorkflowDefinition,
)


ALLOWED_ACTIONS = {"open_application", "prepare_context", "draft_response"}
ALLOWED_PERMISSIONS = {"open_application", "read_active_window", "draft_email"}


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


def approve_plan(db: Session, plan: AutomationPlan, permissions: list[str]) -> AutomationPlan:
    if set(permissions) != set(plan.required_permissions):
        raise PermissionError("All scoped permissions must be explicitly approved")
    if not set(permissions).issubset(ALLOWED_PERMISSIONS):
        raise PermissionError("The plan requested an unsupported permission")
    for capability in permissions:
        db.add(
            PermissionGrant(
                plan_id=plan.id,
                capability=capability,
                approved=True,
                approved_by="user",
            )
        )
    plan.status = "approved"
    record_audit(db, "permission_granted", workflow_id=plan.workflow_id, plan_id=plan.id)
    return plan


def execute_plan(db: Session, plan: AutomationPlan) -> AutomationRun:
    if plan.status != "approved":
        raise PermissionError("Automation execution is blocked until explicit approval")
    if plan.safety_level > 1:
        raise PermissionError("Commit-level automation is disabled in this prototype")
    if any(action.get("type") not in ALLOWED_ACTIONS for action in plan.actions):
        raise PermissionError("The plan includes an unsupported action")

    started = perf_counter()
    record_audit(db, "automation_started", workflow_id=plan.workflow_id, plan_id=plan.id)
    result = {
        "mode": "preview_only",
        "prepared": True,
        "message": "A response draft and workflow context were prepared for user review.",
    }
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

