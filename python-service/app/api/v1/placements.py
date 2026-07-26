from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.core.exceptions import NotFoundError
from app.core.rbac import UserRole, get_college_scope, get_current_user, require_roles
from app.database import get_db
from app.schemas.placement import PlacementCreateRequest, PlacementResponse, PlacementVerifyRequest

router = APIRouter(prefix="/placements", tags=["Placements"])


def _next_id(db, collection: str) -> int:
    last = db[collection].find_one(sort=[("id", -1)], projection={"id": 1})
    return (last["id"] + 1) if last and isinstance(last.get("id"), int) else 1


def _clean(doc):
    if doc:
        doc.pop("_id", None)
    return doc


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("", response_model=list[PlacementResponse])
def list_placements(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {}
    if college_scope:
        query["college_id"] = int(college_scope)
    cursor = db["placements"].find(query).sort("created_at", -1)
    return [_clean(doc) for doc in cursor]


@router.post("", response_model=PlacementResponse)
def create_placement(data: PlacementCreateRequest, current_user = Depends(get_current_user), db = Depends(get_db)):
    student_id = data.student_id or current_user.id
    student = db["users"].find_one({"id": student_id})
    if not student:
        raise NotFoundError("Student", str(student_id))
    placement = {
        "id": _next_id(db, "placements"),
        "student_id": student_id,
        "college_id": student.get("college_id") or current_user.college_id or 1,
        "company_name": data.company_name,
        "role": data.role,
        "salary_lpa": data.salary_lpa,
        "work_type": data.work_type,
        "mode": data.mode,
        "location": data.location,
        "proof_url": data.proof_url,
        "offer_date": None,
        "status": "placed",
        "verified_by": None,
        "verification_status": "pending",
        "verified_at": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    db["placements"].insert_one(placement)
    db["student_profiles"].update_one({"user_id": student_id}, {"$set": {"placement_status": "placed"}})
    return _clean(placement)


@router.get("/student/{student_id}", response_model=list[PlacementResponse])
def student_placements(student_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"student_id": student_id}
    if college_scope:
        query["college_id"] = int(college_scope)
    cursor = db["placements"].find(query).sort("created_at", -1)
    return [_clean(doc) for doc in cursor]


@router.put("/{placement_id}/verify", response_model=PlacementResponse, dependencies=[require_roles(UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def verify_placement(placement_id: int, data: PlacementVerifyRequest, current_user = Depends(get_current_user), db = Depends(get_db)):
    placement = db["placements"].find_one({"id": placement_id})
    if not placement:
        raise NotFoundError("Placement", str(placement_id))
    update = {
        "verification_status": data.verification_status,
        "verified_by": current_user.id,
        "verified_at": _now(),
        "updated_at": _now(),
    }
    db["placements"].update_one({"id": placement_id}, {"$set": update})
    placement.update(update)
    return _clean(placement)
