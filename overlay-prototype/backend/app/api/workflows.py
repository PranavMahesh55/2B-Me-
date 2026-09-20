import hashlib
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.db.models import WorkflowDefinition
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import WorkflowCreate, WorkflowUpdate
from backend.app.ingestion.service import _workflow_payload
from backend.app.runtime import runtime
from backend.app.workflows.detector import is_meaningful_workflow


router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.get("")
def list_workflows(db: Session = Depends(get_db)) -> list[dict]:
    workflows = db.scalars(
        select(WorkflowDefinition).order_by(desc(WorkflowDefinition.repeat_count))
    ).all()
    return [_workflow_payload(item) for item in workflows if is_meaningful_workflow(item)]


@router.post("")
def create_workflow(body: WorkflowCreate, db: Session = Depends(get_db)) -> dict:
    rendered_steps = [step.model_dump() for step in body.steps]
    seed = f"{body.name}:{rendered_steps}:{uuid.uuid4().hex}"
    workflow = WorkflowDefinition(
        signature=f"manual:{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:24]}",
        name=body.name.strip(),
        workflow_type=body.workflow_type,
        steps=rendered_steps,
        graph={},
        repeat_count=0,
        average_duration_s=0,
        predictability=1,
        automation_potential=0,
        confidence=1,
        data_origin="live_observed",
        model_version=runtime.model_config.version,
    )
    db.add(workflow)
    db.commit()
    return _workflow_payload(workflow)


@router.get("/{workflow_id}")
def get_workflow(workflow_id: str, db: Session = Depends(get_db)) -> dict:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {**_workflow_payload(workflow), "graph": workflow.graph}


@router.patch("/{workflow_id}")
def update_workflow(
    workflow_id: str,
    body: WorkflowUpdate,
    db: Session = Depends(get_db),
) -> dict:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow.name = body.name.strip()
    workflow.steps = [step.model_dump() for step in body.steps]
    db.commit()
    return _workflow_payload(workflow)
