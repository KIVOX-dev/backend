from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends

from app.core.exceptions import NotFoundError
from app.core.rbac import UserRole, get_college_scope, get_current_user, require_roles
from app.core.security import hash_password
from app.database import get_db
from app.schemas.batch import BatchCreateRequest, BatchResponse, BatchStatusRequest
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/batches", tags=["Batches"])


def _next_id(db, collection: str) -> int:
    last = db[collection].find_one(sort=[("id", -1)], projection={"id": 1})
    return (last["id"] + 1) if last and isinstance(last.get("id"), int) else 1


def _clean(doc):
    if doc:
        doc.pop("_id", None)
    return doc


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.post("", response_model=BatchResponse, dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def create_batch(data: BatchCreateRequest, current_user = Depends(get_current_user), db = Depends(get_db)):
    batch = {
        "id": _next_id(db, "batches"),
        "name": data.name,
        "batch_code": data.batch_code or f"BAT-{uuid4().hex[:8].upper()}",
        "college_id": current_user.college_id or 1,
        "faculty_id": current_user.id,
        "department": data.department,
        "year": data.year,
        "status": "active",
        "created_at": _now(),
        "updated_at": _now(),
    }
    db["batches"].insert_one(batch)

    for student_data in data.students:
        email = (student_data.email or f"{student_data.roll or student_data.student_id}@skillovate.local").lower()
        student = db["users"].find_one({"email": email})
        if not student:
            user_id = _next_id(db, "users")
            student = {
                "id": user_id,
                "email": email,
                "password_hash": hash_password(student_data.password),
                "name": student_data.name,
                "role": "student",
                "college_id": batch["college_id"],
                "department": student_data.department or batch["department"],
                "status": "approved",
                "is_active": True,
                "created_at": _now(),
                "updated_at": _now(),
            }
            db["users"].insert_one(student)
            db["student_profiles"].insert_one({
                "id": _next_id(db, "student_profiles"),
                "user_id": user_id,
                "student_id": (student_data.roll or student_data.student_id or "").upper(),
                "year": student_data.year,
                "tests_completed": 0,
                "avg_accuracy": 0.0,
            })
        db["batch_students"].insert_one({
            "id": _next_id(db, "batch_students"),
            "batch_id": batch["id"],
            "student_id": student["id"],
        })

    return _clean(batch)


@router.get("/history", response_model=list[BatchResponse])
def batch_history(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {}
    if college_scope:
        query["college_id"] = int(college_scope)
    cursor = db["batches"].find(query).sort("created_at", -1)
    return [_clean(doc) for doc in cursor]


@router.get("/students")
def batch_students(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"role": "student"}
    if college_scope:
        query["college_id"] = int(college_scope)
    students = db["users"].find(query).sort("name", 1)
    return {"success": True, "data": [
        {"id": s["id"], "name": s.get("name"), "email": s.get("email"), "department": s.get("department")}
        for s in students
    ]}


@router.get("/pending", response_model=list[BatchResponse])
def pending_batches(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"status": "active"}
    if college_scope:
        query["college_id"] = int(college_scope)
    cursor = db["batches"].find(query).sort("created_at", -1)
    return [_clean(doc) for doc in cursor]


@router.put("/{batch_id}/status", response_model=MessageResponse)
def update_batch_status(batch_id: int, data: BatchStatusRequest, db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"id": batch_id}
    if college_scope:
        query["college_id"] = int(college_scope)
    batch = db["batches"].find_one(query)
    if not batch:
        raise NotFoundError("Batch", str(batch_id))
    db["batches"].update_one({"id": batch_id}, {"$set": {"status": data.status, "updated_at": _now()}})
    return MessageResponse(message="Batch status updated")
