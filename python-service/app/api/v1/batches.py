from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.core.rbac import UserRole, get_college_scope, get_current_user, require_roles
from app.core.security import hash_password
from app.database import get_db
from app.models.achievement import Batch, BatchStudent
from app.models.user import StudentProfile, User
from app.schemas.batch import BatchCreateRequest, BatchResponse, BatchStatusRequest
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/batches", tags=["Batches"])


@router.post("", response_model=BatchResponse, dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def create_batch(data: BatchCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    batch = Batch(
        name=data.name,
        batch_code=data.batch_code or f"BAT-{uuid4().hex[:8].upper()}",
        college_id=current_user.college_id or 1,
        faculty_id=current_user.id,
        department=data.department,
        year=data.year,
    )
    db.add(batch)
    db.flush()
    for student_data in data.students:
        email = (student_data.email or f"{student_data.roll or student_data.student_id}@skillovate.local").lower()
        student = db.query(User).filter(User.email == email).first()
        if not student:
            student = User(
                email=email,
                password_hash=hash_password(student_data.password),
                name=student_data.name,
                role="student",
                college_id=batch.college_id,
                department=student_data.department or batch.department,
                status="approved",
            )
            db.add(student)
            db.flush()
            db.add(StudentProfile(user_id=student.id, student_id=(student_data.roll or student_data.student_id or "").upper(), year=student_data.year))
        db.add(BatchStudent(batch_id=batch.id, student_id=student.id))
    db.commit()
    db.refresh(batch)
    return batch


@router.get("/history", response_model=list[BatchResponse])
def batch_history(db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(Batch)
    if college_scope:
        query = query.filter(Batch.college_id == college_scope)
    return query.order_by(Batch.created_at.desc()).all()


@router.get("/students")
def batch_students(db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(User).filter(User.role == "student")
    if college_scope:
        query = query.filter(User.college_id == college_scope)
    students = query.order_by(User.name.asc()).all()
    return {"success": True, "data": [{"id": s.id, "name": s.name, "email": s.email, "department": s.department} for s in students]}


@router.get("/pending", response_model=list[BatchResponse])
def pending_batches(db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(Batch).filter(Batch.status == "active")
    if college_scope:
        query = query.filter(Batch.college_id == college_scope)
    return query.order_by(Batch.created_at.desc()).all()


@router.put("/{batch_id}/status", response_model=MessageResponse)
def update_batch_status(batch_id: int, data: BatchStatusRequest, db: Session = Depends(get_db), college_scope: int | None = get_college_scope):
    query = db.query(Batch).filter(Batch.id == batch_id)
    if college_scope:
        query = query.filter(Batch.college_id == college_scope)
    batch = query.first()
    if not batch:
        raise NotFoundError("Batch", str(batch_id))
    batch.status = data.status
    db.commit()
    return MessageResponse(message="Batch status updated")
