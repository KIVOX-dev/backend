from fastapi import APIRouter, Depends

from app.api.v1.assessments import submit_test, to_dict
from app.core.rbac import get_college_scope, get_current_user
from app.database import get_db
from app.schemas.assessment import AttemptResponse, TestSubmitRequest

router = APIRouter(prefix="/tests", tags=["Tests"])


@router.post("/submit", response_model=AttemptResponse)
def submit(data: TestSubmitRequest, current_user=Depends(get_current_user), db=Depends(get_db)):
    return submit_test(data, current_user, db)


@router.get("/college/results", response_model=list[AttemptResponse])
def college_results(db=Depends(get_db), college_scope: int | None = get_college_scope):
    query = {}
    if college_scope:
        query["college_id"] = int(college_scope)
    attempts = db["assessment_attempts"].find(query).sort("created_at", -1)
    return [to_dict(doc) for doc in attempts]
