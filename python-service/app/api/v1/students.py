from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from app.core.exceptions import NotFoundError
from app.core.rbac import UserRole, get_college_scope, require_roles, get_current_user
from app.core.security import hash_password
from app.database import get_db
from app.schemas.interview import InterviewSubmitRequest
from app.schemas.common import MessageResponse
from app.schemas.user import StudentProfileUpdateRequest, UserUpdateRequest

router = APIRouter(prefix="/students", tags=["Students"])

def to_dict(obj):
    if not obj: return None
    if isinstance(obj, list):
        return [to_dict(x) for x in obj]
    if isinstance(obj, dict):
        obj["id"] = obj.get("id", str(obj.get("_id")))
        obj.pop("_id", None)
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                obj[k] = to_dict(v)
    return obj

@router.get("")
def list_students(
    search: str | None = None,
    department: str | None = None,
    year: int | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    db = Depends(get_db),
    college_scope: int | None = get_college_scope,
):
    query = {"role": "student"}
    if college_scope:
        query["college_id"] = college_scope
    if department:
        query["department"] = department
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}}
        ]
        
    users = list(db["users"].find(query).sort("name", 1).limit(limit))
    
    # Attach profiles
    for user in users:
        prof = db["student_profiles"].find_one({"user_id": user["id"]})
        if prof:
            user["student_profile"] = prof
    
    # Filter by year if needed
    if year:
        users = [u for u in users if u.get("student_profile", {}).get("year") == year]
        
    return [to_dict(u) for u in users]


@router.post("/identify")
def identify_student(data: dict, db = Depends(get_db)):
    college_name = str(data.get("college_id") or data.get("collegeName") or "").strip()
    roll_no = str(data.get("roll_no") or data.get("studentId") or "").strip().upper()
    
    college = db["colleges"].find_one({"name": {"$regex": college_name, "$options": "i"}})
    if not college:
        raise NotFoundError("College", college_name)
        
    profile = db["student_profiles"].find_one({"student_id": roll_no})
    if not profile:
        raise NotFoundError("Student", roll_no)
        
    student = db["users"].find_one({"id": profile["user_id"], "college_id": college["id"]})
    if not student:
        raise NotFoundError("Student", roll_no)
        
    return {
        "success": True,
        "student": {
            "internal_id": student["id"],
            "id": profile["student_id"],
            "name": student.get("name", ""),
            "college": college["name"],
            "college_id": college["id"],
            "department": student.get("department", ""),
            "year": profile.get("year", None),
            "stats": {
                "tests_completed": profile.get("tests_completed", 0),
                "avg_accuracy": profile.get("avg_accuracy", 0),
                "interviews_completed": profile.get("interviews_completed", 0),
                "streak": profile.get("streak", 0),
            },
            "profile_data": {},
            "resumeData": {},
            "jobApplications": [],
            "trackProgress": {},
        },
        "history": {"tests": [], "interviews": [], "total_attempts": 0},
    }

@router.get("/{student_id}")
def get_student(student_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"id": student_id, "role": "student"}
    if college_scope:
        query["college_id"] = college_scope
    student = db["users"].find_one(query)
    if not student:
        raise NotFoundError("Student", str(student_id))
    return to_dict(student)

@router.put("/{student_id}")
def update_student(
    student_id: int,
    data: UserUpdateRequest,
    db = Depends(get_db),
    college_scope: int | None = get_college_scope,
):
    student = get_student(student_id, db, college_scope)
    update_data = data.model_dump(exclude_unset=True)
    db["users"].update_one({"id": student_id}, {"$set": update_data})
    return to_dict(db["users"].find_one({"id": student_id}))

@router.put("/{student_id}/profile")
def update_student_profile(student_id: int, data: StudentProfileUpdateRequest, db = Depends(get_db)):
    profile = db["student_profiles"].find_one({"user_id": student_id})
    update_data = data.model_dump(exclude_unset=True)
    if not profile:
        update_data["user_id"] = student_id
        update_data["id"] = db["student_profiles"].count_documents({}) + 1
        db["student_profiles"].insert_one(update_data)
    else:
        db["student_profiles"].update_one({"user_id": student_id}, {"$set": update_data})
    return MessageResponse(message="Student profile updated")

@router.get("/{student_id}/dashboard")
def get_student_dashboard(student_id: int, db = Depends(get_db)):
    profile = db["student_profiles"].find_one({"user_id": student_id})
    if not profile:
        profile = {
            "id": db["student_profiles"].count_documents({}) + 1,
            "user_id": student_id,
            "tests_completed": 0,
            "avg_accuracy": 0,
            "interviews_completed": 0,
            "streak": 0
        }
        db["student_profiles"].insert_one(profile)
        
    recent_attempts = list(db["assessment_attempts"].find({"student_id": student_id}).sort("created_at", -1).limit(5))
    recent_activity = []
    for a in recent_attempts:
        assessment = db["assessments"].find_one({"id": a["assessment_id"]})
        title = assessment["title"] if assessment else "Practice Test"
        recent_activity.append({
            "id": a["id"],
            "title": title,
            "score": a.get("score", 0),
            "max_score": a.get("max_score", 100),
            "percentage": a.get("percentage", 0),
            "date": a.get("created_at")
        })

    return {
        "tests_completed": profile.get("tests_completed", 0),
        "avg_accuracy": round(profile.get("avg_accuracy", 0), 1),
        "interviews_completed": profile.get("interviews_completed", 0),
        "streak": profile.get("streak", 0),
        "national_rank": profile.get("national_rank", "-"),
        "placement_status": profile.get("placement_status", None),
        "recent_activity": recent_activity
    }

@router.get("/{student_id}/tests")
def student_tests(student_id: int, db = Depends(get_db), current_user = Depends(get_current_user)):
    query = {"student_id": student_id}
    if current_user.role != "super_admin" and current_user.id != student_id:
        if current_user.college_id:
            query["college_id"] = current_user.college_id
            
    attempts = db["assessment_attempts"].find(query).sort("created_at", -1)
    return [to_dict(a) for a in attempts]

@router.post("/{student_id}/tests")
def log_student_test(student_id: int, data: dict, db = Depends(get_db)):
    student = db["users"].find_one({"id": student_id})
    if not student:
        raise NotFoundError("Student", str(student_id))
        
    score = int(data.get("score") or 0)
    max_score = int(data.get("max_score") or data.get("total") or 100)
    pct = float(data.get("percentage") or round((score / max_score) * 100, 2))
    assessment_id = int(data.get("assessment_id") or 0)
    
    assessment = db["assessments"].find_one({"id": assessment_id}) if assessment_id else None
    if not assessment:
        assessment = {
            "id": db["assessments"].count_documents({}) + 1,
            "title": data.get("testName") or data.get("title") or "Practice Test",
            "assessment_type": "mixed",
            "college_id": student.get("college_id") or 1,
            "created_by": student_id,
            "duration_minutes": int(data.get("duration") or 30),
            "total_marks": max_score,
            "pass_percentage": 40,
            "status": "active",
            "difficulty": "medium",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        db["assessments"].insert_one(assessment)
        
    attempt_num = db["assessment_attempts"].count_documents({"student_id": student_id}) + 1
    attempt = {
        "id": db["assessment_attempts"].count_documents({}) + 1,
        "assessment_id": assessment["id"],
        "student_id": student_id,
        "college_id": student.get("college_id") or 1,
        "attempt_number": attempt_num,
        "score": score,
        "max_score": max_score,
        "percentage": pct,
        "status": "completed",
        "passed": pct >= 40,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    db["assessment_attempts"].insert_one(attempt)
    
    profile = db["student_profiles"].find_one({"user_id": student_id})
    if profile:
        tests_completed = profile.get("tests_completed", 0) + 1
        avg_acc = profile.get("avg_accuracy", 0)
        new_avg = round(((avg_acc * (tests_completed - 1)) + pct) / tests_completed, 2)
        
        today_date = datetime.now(timezone.utc).date()
        last_test_str = profile.get("last_test_date")
        streak = profile.get("streak", 0)
        
        if last_test_str:
            try:
                last_test_date = datetime.fromisoformat(last_test_str).date()
                if last_test_date == today_date:
                    pass
                elif last_test_date == today_date - timedelta(days=1):
                    streak += 1
                else:
                    streak = 1
            except:
                streak = 1
        else:
            streak = 1
            
        db["student_profiles"].update_one(
            {"user_id": student_id},
            {"$set": {
                "tests_completed": tests_completed, 
                "avg_accuracy": new_avg,
                "streak": streak,
                "last_test_date": today_date.isoformat()
            }}
        )
        
    return MessageResponse(message="Test attempt logged")

@router.get("/{student_id}/tests/analytics")
def student_test_analytics(student_id: int, db = Depends(get_db)):
    attempts = list(db["assessment_attempts"].find({"student_id": student_id}))
    avg = round(sum(a.get("percentage", 0) for a in attempts) / len(attempts), 2) if attempts else 0
    return {"success": True, "data": {"attempts": len(attempts), "average": avg, "history": [to_dict(a) for a in attempts]}}

@router.get("/{student_id}/interviews")
def student_interviews(student_id: int, db = Depends(get_db), current_user = Depends(get_current_user)):
    query = {"student_id": student_id}
    if current_user.role != "super_admin" and current_user.id != student_id:
        if current_user.college_id:
            query["college_id"] = current_user.college_id
            
    attempts = db["interview_attempts"].find(query).sort("created_at", -1)
    return [to_dict(a) for a in attempts]

@router.post("/{student_id}/interviews")
def log_student_interview(student_id: int, data: InterviewSubmitRequest, db = Depends(get_db)):
    student = db["users"].find_one({"id": student_id})
    if not student:
        raise NotFoundError("Student", str(student_id))
        
    attempt_num = db["interview_attempts"].count_documents({"student_id": student_id}) + 1
    attempt = {
        "id": db["interview_attempts"].count_documents({}) + 1,
        "student_id": student_id,
        "college_id": student.get("college_id") or 1,
        "role": data.role,
        "category": data.category,
        "overall_rating": data.overall_rating,
        "strengths": data.strengths,
        "improvements": data.improvements,
        "duration_seconds": data.duration_seconds,
        "attempt_number": attempt_num,
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db["interview_attempts"].insert_one(attempt)
    
    for resp in data.responses:
        r_dict = resp.model_dump()
        r_dict["attempt_id"] = attempt["id"]
        r_dict["id"] = db["interview_responses"].count_documents({}) + 1
        db["interview_responses"].insert_one(r_dict)
        
    db["student_profiles"].update_one(
        {"user_id": student_id},
        {"$inc": {"interviews_completed": 1}}
    )
    return to_dict(attempt)

@router.post("/batch")
def create_batch_students(
    data: dict, 
    db = Depends(get_db), 
    college_scope: int | None = get_college_scope,
    current_user = Depends(get_current_user)
):
    students = data.get("students") or []
    department = data.get("department")
    year = data.get("year")
    created = 0
    default_status = "pending" if current_user.get("role") == "faculty" else "approved"
    
    for item in students:
        email = item.get("email") or f"{item.get('roll') or item.get('studentId')}@skillovate.local"
        if db["users"].count_documents({"email": email.lower()}) > 0:
            continue
            
        user_id = db["users"].count_documents({}) + 1
        user = {
            "id": user_id,
            "email": email.lower(),
            "password_hash": hash_password(item.get("password") or "student123"),
            "name": item.get("name"),
            "role": "student",
            "college_id": college_scope,
            "department": item.get("department") or department,
            "status": default_status,
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        db["users"].insert_one(user)
        
        prof = {
            "id": db["student_profiles"].count_documents({}) + 1,
            "user_id": user_id,
            "student_id": (item.get("roll") or item.get("studentId") or "").upper(),
            "year": year or item.get("year"),
            "tests_completed": 0,
            "avg_accuracy": 0,
            "interviews_completed": 0
        }
        db["student_profiles"].insert_one(prof)
        created += 1
        
    return MessageResponse(message=f"Successfully onboarded {created} students. Status: {default_status}")

@router.get("/pending")
def list_pending_students(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"role": "student", "status": "pending"}
    if college_scope:
        query["college_id"] = college_scope
    users = db["users"].find(query).sort("created_at", -1)
    return [to_dict(u) for u in users]
