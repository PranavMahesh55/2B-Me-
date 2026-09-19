from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.api.websocket import manager
from backend.app.automation.service import approve_plan, create_plan, execute_plan
from backend.app.db.models import AutomationPlan, WorkflowDefinition
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import ApprovalInput


router = APIRouter(prefix="/api/automation", tags=["automation"])


def _plan_payload(plan: AutomationPlan) -> dict:
    return {
        "id": plan.id,
        "workflow_id": plan.workflow_id,
        "actions": plan.actions,
        "required_permissions": plan.required_permissions,
        "safety_level": plan.safety_level,
        "status": plan.status,
    }


@router.post("/{workflow_id}/plan")
async def plan_automation(workflow_id: str, db: Session = Depends(get_db)) -> dict:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    plan = create_plan(db, workflow)
    db.commit()
    payload = _plan_payload(plan)
    await manager.broadcast({"type": "permission_request", "payload": payload})
    return payload


@router.post("/{plan_id}/approve")
def approve_automation(
    plan_id: str, body: ApprovalInput, db: Session = Depends(get_db)
) -> dict:
    plan = db.get(AutomationPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Automation plan not found")
    try:
        approve_plan(db, plan, body.permissions)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    db.commit()
    return _plan_payload(plan)


@router.post("/{plan_id}/execute")
async def run_automation(plan_id: str, db: Session = Depends(get_db)) -> dict:
    plan = db.get(AutomationPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Automation plan not found")
    try:
        run = execute_plan(db, plan)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    db.commit()
    payload = {
        "id": run.id,
        "plan_id": run.plan_id,
        "status": run.status,
        "result": run.result,
        "duration_ms": run.duration_ms,
    }
    await manager.broadcast({"type": "automation_status", "payload": payload})
    return payload

