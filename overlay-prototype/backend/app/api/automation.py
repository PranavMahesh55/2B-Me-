from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.api.websocket import manager
from backend.app.audit.service import record_audit
from backend.app.automation.broker_client import broker_execute
from backend.app.automation.service import create_plan, execute_plan, plan_intent, plan_risk
from backend.app.db.models import AutomationPlan, WorkflowDefinition
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import ExecuteInput


router = APIRouter(prefix="/api/automation", tags=["automation"])


def _plan_payload(plan: AutomationPlan) -> dict:
    return {
        "id": plan.id,
        "workflow_id": plan.workflow_id,
        "actions": plan.actions,
        "required_permissions": plan.required_permissions,
        "safety_level": plan.safety_level,
        "status": plan.status,
        # What the overlay shows in the consent card and sends to the signer.
        "intent": plan_intent(plan),
        "risk": plan_risk(plan),
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


# POST /{plan_id}/approve is deliberately gone. It wrote
# PermissionGrant(approved=True, approved_by="user") -- a boolean this process
# set for itself -- and execute_plan gated on it. Keeping the route would leave
# something that flips state nothing reads, which reads like a bypass.


@router.post("/{plan_id}/execute")
async def run_automation(
    plan_id: str, body: ExecuteInput | None = None, db: Session = Depends(get_db)
) -> dict:
    plan = db.get(AutomationPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Automation plan not found")

    async def deny(error: str, status: int = 403) -> None:
        record_audit(
            db, "permission_denied", workflow_id=plan.workflow_id,
            plan_id=plan.id, payload={"error": error},
        )
        db.commit()
        await manager.broadcast(
            {"type": "automation_status", "payload": {"plan_id": plan.id, "status": "denied", "error": error}}
        )
        raise HTTPException(status_code=status, detail={"error": error})

    if body is None:
        # Optional body, so a bodyless POST is a 403 rather than a 422: the
        # contract has no place for a validation error here.
        raise HTTPException(status_code=403, detail={"error": "signature_invalid"})

    # The plan the user authorized is the one this backend derives, not whatever
    # the caller sends. Checking it here means a mismatch never reaches the
    # broker and never burns the grant.
    intent = plan_intent(plan)
    if body.plan != intent:
        await deny("plan_mismatch")

    receipt, error, status = await broker_execute(
        token=body.token.model_dump(), plan=intent, tamper=body.tamper
    )
    if error:
        await deny(error, status)

    try:
        run = execute_plan(db, plan, receipt=receipt)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail={"error": "replayed", "message": str(exc)}) from exc

    record_audit(
        db, "permission_granted", workflow_id=plan.workflow_id, plan_id=plan.id,
        payload={"jti": receipt["jti"], "audit_index": receipt["audit_index"]},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # The unique index on grant_receipts.jti. If this fires the broker's
        # spent store has a bug, so fail closed rather than trust it.
        db.rollback()
        raise HTTPException(status_code=403, detail={"error": "replayed"}) from exc

    payload = {
        "id": run.id,
        "plan_id": run.plan_id,
        "status": run.status,
        "result": run.result,
        "duration_ms": run.duration_ms,
        "jti": receipt["jti"],
        "audit_index": receipt["audit_index"],
        "audit_hash": receipt["audit_hash"],
    }
    await manager.broadcast({"type": "automation_status", "payload": payload})
    return payload


@router.get("/chain")
async def automation_chain(limit: int = 50) -> dict:
    """Read-only view of the broker's hash chain, for the dashboard ledger."""
    import httpx

    from backend.app.automation.broker_client import _launch_secret
    from backend.app.config.settings import settings

    headers = {"Origin": settings.broker_origin}
    secret = _launch_secret()
    if secret:
        headers["X-2bme-Launch-Secret"] = secret
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{settings.broker_url}/audit/chain", headers=headers)
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return {"entries": [], "verification": {"ok": False, "reason": "broker_unavailable"}}
    entries = payload.get("entries", [])
    return {"entries": entries[-limit:], "verification": payload.get("verification")}
