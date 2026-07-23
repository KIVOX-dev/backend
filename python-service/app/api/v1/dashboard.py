from fastapi import APIRouter, Depends
from app.core.rbac import UserRole, get_college_scope, require_roles
from app.database import get_db

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def to_dict(obj):
    if not obj: return None
    obj["id"] = obj.get("id", str(obj.get("_id")))
    obj.pop("_id", None)
    return obj


@router.get("/student/{student_id}")
def student_dashboard(student_id: int, db = Depends(get_db)):
    attempts = list(db["assessment_attempts"].find({"student_id": student_id, "status": "completed"}))
    interviews = db["interview_attempts"].count_documents({"student_id": student_id})
    placements = db["placements"].count_documents({"student_id": student_id})
    avg = round(sum(a.get("percentage", 0) for a in attempts) / len(attempts), 2) if attempts else 0
    return {
        "success": True,
        "data": {
            "tests_completed": len(attempts),
            "avg_accuracy": avg,
            "interviews_completed": interviews,
            "placements": placements,
            "recent_tests": [to_dict(a) for a in attempts[-5:]],
            "history": [to_dict(a) for a in attempts],
        },
    }


@router.get("/admin", dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def admin_dashboard(db = Depends(get_db), college_scope: int | None = get_college_scope):
    user_query = {"role": "student"}
    base_query = {}
    
    if college_scope:
        user_query["college_id"] = int(college_scope)
        base_query["college_id"] = int(college_scope)
        
    students = db["users"].count_documents(user_query)
    assessments = db["assessments"].count_documents(base_query)
    attempts_cursor = list(db["assessment_attempts"].find(base_query))
    attempts = len(attempts_cursor)
    placements = db["placements"].count_documents(base_query)
    
    avg = sum(a.get("percentage", 0) for a in attempts_cursor) / attempts if attempts else 0
    
    return {
        "success": True,
        "data": {
            "students": students,
            "assessments": assessments,
            "attempts": attempts,
            "placements": placements,
            "avg_score": round(float(avg), 2),
        },
    }


@router.get("/super", dependencies=[require_roles(UserRole.SUPER_ADMIN)])
def super_dashboard(db = Depends(get_db)):
    return {
        "success": True,
        "data": {
            "students": db["users"].count_documents({"role": "student"}),
            "faculty": db["users"].count_documents({"role": "faculty"}),
            "admins": db["users"].count_documents({"role": "college_admin"}),
            "recruiters": db["users"].count_documents({"role": "recruiter"}),
        },
    }
