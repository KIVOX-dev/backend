from fastapi import APIRouter, Depends, HTTPException
from typing import List
from datetime import datetime, timezone

from app.dependencies import get_db
from app.core.rbac import get_current_user, RoleChecker, UserRole
from app.schemas.user import UserResponse, AdminUserUpdateRequest, AdminUserCreateRequest
from app.core.exceptions import NotFoundError
from app.core.security import hash_password

router = APIRouter(prefix="/users", tags=["Users"])
superadmin_checker = RoleChecker([UserRole.SUPER_ADMIN])

# Number of users returned in one page. The admin tables render a scrollable
# list, not the entire institution at once, and an unbounded find over a remote
# cluster was a large part of the load time.
DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 1000

# Exactly the fields `UserResponse` serialises. Excluding `password_hash` here
# means the hash never leaves the database, and skipping unused fields keeps
# the payload small over the wire.
USER_PROJECTION = {
    "_id": 1,
    "id": 1,
    "email": 1,
    "name": 1,
    "role": 1,
    "college_id": 1,
    "department": 1,
    "phone": 1,
    "avatar_url": 1,
    "is_active": 1,
    "is_email_verified": 1,
    "status": 1,
    "last_login_at": 1,
    "created_at": 1,
    "updated_at": 1,
    "preferences": 1,
}


def _next_id(db, collection: str) -> int:
    """Next sequential id for a profile collection.

    Reads the current maximum off the index instead of counting the whole
    collection. Counting was both a full scan and wrong after any delete —
    it could hand out an id that already existed.
    """
    last = db[collection].find_one(sort=[("id", -1)], projection={"id": 1})
    return (last["id"] + 1) if last and isinstance(last.get("id"), int) else 1


def to_dict(obj):
    if not obj:
        return None
    if isinstance(obj, list):
        return [to_dict(x) for x in obj]
    if isinstance(obj, dict):
        obj["id"] = obj.get("id", str(obj.get("_id")))
        obj.pop("_id", None)
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                obj[k] = to_dict(v)
    return obj


@router.post("/", response_model=UserResponse)
def create_user(
    payload: AdminUserCreateRequest,
    db = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Create a user. Superadmin=anyone, College Admin=faculty+students, Faculty=students only."""
    allowed_roles = [UserRole.SUPER_ADMIN.value, UserRole.COLLEGE_ADMIN.value, UserRole.FACULTY.value]
    if current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Not authorized to create users")
    
    # Faculty can only create students in their own college
    if current_user.role == UserRole.FACULTY.value:
        if payload.role != UserRole.STUDENT.value:
            raise HTTPException(status_code=403, detail="Faculty can only create students")
        payload.college_id = current_user.college_id
        
    # College admin can create faculty + students in their own college
    if current_user.role == UserRole.COLLEGE_ADMIN.value:
        payload.college_id = current_user.college_id
        if payload.role not in [UserRole.STUDENT.value, UserRole.FACULTY.value]:
            raise HTTPException(status_code=403, detail="Can only create students or faculty")
            
    # `find_one` with a projection stops as soon as it finds a match; the old
    # count_documents had to visit every matching document first.
    if db["users"].find_one({"email": payload.email.lower()}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Email already registered")

    last_user = db["users"].find_one(sort=[("id", -1)], projection={"id": 1})
    user_id = (last_user["id"] + 1) if last_user and "id" in last_user else 1
    user = {
        "id": user_id,
        "email": payload.email.lower(),
        "name": payload.name,
        "role": payload.role,
        "password_hash": hash_password(payload.password),
        "status": "approved",
        "college_id": payload.college_id,
        "department": payload.department,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db["users"].insert_one(user)
    
    if user["role"] == UserRole.STUDENT.value:
        sp = {
            "id": _next_id(db, "student_profiles"),
            "user_id": user_id,
            "student_id": payload.student_id,
            "year": payload.year,
            "tests_completed": 0,
            "avg_accuracy": 0.0
        }
        db["student_profiles"].insert_one(sp)
    elif user["role"] == UserRole.FACULTY.value:
        fp = {
            "id": _next_id(db, "faculty_profiles"),
            "user_id": user_id,
            "department": payload.department
        }
        db["faculty_profiles"].insert_one(fp)
    elif user["role"] == "recruiter":
        rp = {
            "id": _next_id(db, "recruiter_profiles"),
            "user_id": user_id,
            "company_name": "New Company"
        }
        db["recruiter_profiles"].insert_one(rp)

    return to_dict(user)

@router.get("/", response_model=List[UserResponse])
def get_all_users(
    db = Depends(get_db),
    current_user = Depends(get_current_user),
    skip: int = 0,
    limit: int = DEFAULT_PAGE_SIZE,
):
    """Get users. Superadmin sees all. Others see users in their college.

    Paginated and projected: the password hash and other internal fields are
    never serialised, and the result set is bounded. Callers that pass no
    paging arguments keep working and simply receive the first page.
    """
    query = {}

    if current_user.role != UserRole.SUPER_ADMIN.value:
        if current_user.college_id is None:
            query["id"] = current_user.id
        else:
            query["college_id"] = current_user.college_id
        query["role"] = {"$ne": UserRole.SUPER_ADMIN.value}

    users = (
        db["users"]
        .find(query, USER_PROJECTION)
        .sort("created_at", -1)
        .skip(max(skip, 0))
        .limit(min(max(limit, 1), MAX_PAGE_SIZE))
    )
    return [to_dict(u) for u in users]

@router.get("/pending", response_model=List[UserResponse])
def get_pending_users(
    db = Depends(get_db),
    current_user = Depends(get_current_user),
    limit: int = DEFAULT_PAGE_SIZE,
):
    """Get all users with 'pending' status."""
    if current_user.role not in [UserRole.SUPER_ADMIN.value, UserRole.COLLEGE_ADMIN.value]:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    query = {"status": "pending"}
    if current_user.role == UserRole.COLLEGE_ADMIN.value:
        if current_user.college_id is None:
            query["id"] = current_user.id
        else:
            query["college_id"] = current_user.college_id
        query["role"] = {"$ne": UserRole.SUPER_ADMIN.value}

    users = (
        db["users"]
        .find(query, USER_PROJECTION)
        .sort("created_at", -1)
        .limit(min(max(limit, 1), MAX_PAGE_SIZE))
    )
    return [to_dict(u) for u in users]

@router.put("/{user_id}/approve", response_model=UserResponse)
def approve_user(
    user_id: int,
    db = Depends(get_db),
    current_user = Depends(superadmin_checker)
):
    user = db["users"].find_one({"id": user_id})
    if not user:
        raise NotFoundError("User", str(user_id))
    db["users"].update_one({"id": user_id}, {"$set": {"status": "approved", "updated_at": datetime.now(timezone.utc).isoformat()}})
    user["status"] = "approved"
    return to_dict(user)

@router.put("/{user_id}/reject", response_model=UserResponse)
def reject_user(
    user_id: int,
    db = Depends(get_db),
    current_user = Depends(superadmin_checker)
):
    user = db["users"].find_one({"id": user_id})
    if not user:
        raise NotFoundError("User", str(user_id))
    db["users"].update_one({"id": user_id}, {"$set": {"status": "rejected", "updated_at": datetime.now(timezone.utc).isoformat()}})
    user["status"] = "rejected"
    return to_dict(user)

@router.delete("/{user_id}", response_model=dict)
def delete_user(
    user_id: int,
    db = Depends(get_db),
    current_user = Depends(get_current_user)
):
    if current_user.role not in [UserRole.SUPER_ADMIN.value, UserRole.COLLEGE_ADMIN.value]:
        raise HTTPException(status_code=403, detail="Not authorized")
    user = db["users"].find_one({"id": user_id})
    if not user:
        raise NotFoundError("User", str(user_id))
    if current_user.role == UserRole.COLLEGE_ADMIN.value and user.get("college_id") != current_user.college_id:
        raise HTTPException(status_code=403, detail="Can only delete users from your college")
    db["users"].delete_one({"id": user_id})
    return {"message": "User deleted successfully"}

@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    db = Depends(get_db),
    current_user = Depends(get_current_user)
):
    if current_user.role not in [UserRole.SUPER_ADMIN.value, UserRole.COLLEGE_ADMIN.value]:
        raise HTTPException(status_code=403, detail="Not authorized")
    user = db["users"].find_one({"id": user_id})
    if not user:
        raise NotFoundError("User", str(user_id))
    if current_user.role == UserRole.COLLEGE_ADMIN.value and user.get("college_id") != current_user.college_id:
        raise HTTPException(status_code=403, detail="Can only update users from your college")
    
    update_data = payload.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    db["users"].update_one({"id": user_id}, {"$set": update_data})
    
    updated = db["users"].find_one({"id": user_id})
    return to_dict(updated)
