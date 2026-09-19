from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.db.models import WorkflowDefinition
from backend.app.db.session import get_db
from backend.app.ingestion.service import _workflow_payload


router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.get("")
def list_workflows(db: Session = Depends(get_db)) -> list[dict]:
    workflows = db.scalars(
        select(WorkflowDefinition).order_by(desc(WorkflowDefinition.repeat_count))
    ).all()
    return [_workflow_payload(item) for item in workflows]


@router.get("/{workflow_id}")
def get_workflow(workflow_id: str, db: Session = Depends(get_db)) -> dict:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {**_workflow_payload(workflow), "graph": workflow.graph}

