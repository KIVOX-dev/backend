from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.assessments import submit_test
from app.core.rbac import get_college_scope, get_current_user
from app.database import get_db
from app.models.assessment import AssessmentAttempt
from app.models.user import User
from app.schemas.assessment import AttemptResponse, TestSubmitRequest

router = APIRouter(prefix="/tests", tags=["Tests"])


@router.post("/submit", response_model=AttemptResponse)
def submit(data: TestSubmitRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return submit_test(data, current_user, db)


@router.get("/college/results", response_model=list[AttemptResponse])
def college_results(db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(AssessmentAttempt)
    if college_scope:
        query = query.filter(AssessmentAttempt.college_id == college_scope)
    return query.order_by(AssessmentAttempt.created_at.desc()).all()
