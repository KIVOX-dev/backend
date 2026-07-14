from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.core.rbac import UserRole, get_college_scope, get_current_user, require_roles
from app.database import get_db
from app.models.placement import Placement
from app.models.user import User
from app.schemas.placement import PlacementCreateRequest, PlacementResponse, PlacementVerifyRequest

router = APIRouter(prefix="/placements", tags=["Placements"])


@router.get("", response_model=list[PlacementResponse])
def list_placements(db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(Placement)
    if college_scope:
        query = query.filter(Placement.college_id == college_scope)
    return query.order_by(Placement.created_at.desc()).all()


@router.post("", response_model=PlacementResponse)
def create_placement(data: PlacementCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    student_id = data.student_id or current_user.id
    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise NotFoundError("Student", str(student_id))
    placement = Placement(
        student_id=student_id,
        college_id=student.college_id or current_user.college_id or 1,
        company_name=data.company_name,
        role=data.role,
        salary_lpa=data.salary_lpa,
        work_type=data.work_type,
        mode=data.mode,
        location=data.location,
        proof_url=data.proof_url,
        status="placed",
    )
    db.add(placement)
    if student.student_profile:
        student.student_profile.placement_status = "placed"
    db.commit()
    db.refresh(placement)
    return placement


@router.get("/student/{student_id}", response_model=list[PlacementResponse])
def student_placements(student_id: int, db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(Placement).filter(Placement.student_id == student_id)
    if college_scope:
        query = query.filter(Placement.college_id == college_scope)
    return query.order_by(Placement.created_at.desc()).all()


@router.put("/{placement_id}/verify", response_model=PlacementResponse, dependencies=[require_roles(UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def verify_placement(placement_id: int, data: PlacementVerifyRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    placement = db.query(Placement).filter(Placement.id == placement_id).first()
    if not placement:
        raise NotFoundError("Placement", str(placement_id))
    placement.verification_status = data.verification_status
    placement.verified_by = current_user.id
    placement.verified_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(placement)
    return placement
