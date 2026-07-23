from fastapi import APIRouter, Depends
from datetime import datetime, timezone

from app.core.rbac import UserRole, get_current_user, require_roles
from app.database import get_db
from app.schemas.college import CollegeCreateRequest, CollegeResponse

router = APIRouter(prefix="/colleges", tags=["Colleges"])


def to_dict(obj):
    if not obj: return None
    obj["id"] = obj.get("id", str(obj.get("_id")))
    obj.pop("_id", None)
    return obj


@router.get("", response_model=list[CollegeResponse])
def list_colleges(db = Depends(get_db)):
    colleges = db["colleges"].find({"is_active": True}).sort("name", 1)
    return [to_dict(c) for c in colleges]


@router.get("/me", response_model=CollegeResponse)
def current_college(current_user = Depends(get_current_user), db = Depends(get_db)):
    college = db["colleges"].find_one({"id": current_user.college_id})
    return to_dict(college)


@router.post("", response_model=CollegeResponse, dependencies=[require_roles(UserRole.SUPER_ADMIN)])
def create_college(data: CollegeCreateRequest, db = Depends(get_db)):
    college_id = db["colleges"].count_documents({}) + 1
    college = {
        "id": college_id,
        "name": data.name,
        "short_code": data.short_code.upper(),
        "location": data.location or "",
        "address": data.address or "",
        "contact_email": data.contact_email,
        "contact_phone": data.contact_phone,
        "website": data.website,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db["colleges"].insert_one(college)
    
    for dept in data.departments:
        db["departments"].insert_one({
            "id": db["departments"].count_documents({}) + 1,
            "college_id": college_id,
            "name": dept.name if hasattr(dept, 'name') else dept["name"],
            "code": dept.code if hasattr(dept, 'code') else dept["code"]
        })
        
    return to_dict(college)
