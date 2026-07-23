from fastapi import APIRouter, Depends
from datetime import datetime, timezone

from app.core.rbac import get_college_scope, get_current_user
from app.database import get_db

router = APIRouter(tags=["Achievements"])

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

@router.get("/students/{student_id}/achievements")
def student_achievements(student_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"user_id": student_id}
    if college_scope:
        query["college_id"] = college_scope
    achievements = db["achievements"].find(query).sort("achieved_at", -1)
    return [to_dict(doc) for doc in achievements]


@router.post("/students/{student_id}/achievements/evaluate")
def evaluate_achievements(student_id: int, db = Depends(get_db)):
    student = db["users"].find_one({"id": student_id})
    if not student:
        return []
    college_id = student.get("college_id") or 1
    
    test_count = db["assessment_attempts"].count_documents({"student_id": student_id, "status": "completed"})
    interview_count = db["interview_attempts"].count_documents({"student_id": student_id})
    placement_count = db["placements"].count_documents({"student_id": student_id})
    
    rules = [
        ("practice-5", test_count >= 5, "Practice Starter", "Completed 5 tests", "test", test_count),
        ("interview-1", interview_count >= 1, "Interview Ready", "Completed a mock interview", "interview", interview_count),
        ("placed", placement_count >= 1, "Placed Talent", "Submitted a placement record", "placement", placement_count),
    ]
    
    created = []
    for ach_type, condition, title, desc, module, value in rules:
        exists = db["achievements"].find_one({"user_id": student_id, "achievement_type": ach_type})
        if condition and not exists:
            achievement = {
                "id": db["achievements"].count_documents({}) + 1,
                "user_id": student_id,
                "college_id": college_id,
                "achievement_type": ach_type,
                "title": title,
                "description": desc,
                "source_module": module,
                "metric_value": value,
                "achieved_at": datetime.now(timezone.utc).isoformat(),
            }
            db["achievements"].insert_one(achievement)
            created.append(achievement)
            
    all_ach = db["achievements"].find({"user_id": student_id}).sort("achieved_at", -1)
    return [to_dict(doc) for doc in all_ach]


@router.get("/leaderboard")
def leaderboard(
    scope: str = "national",
    db = Depends(get_db), 
    current_user = Depends(get_current_user)
):
    query = {"role": "student", "status": "approved"}
    
    if scope == "college":
        query["college_id"] = current_user.get("college_id")
        
    users = list(db["users"].find(query).limit(100))
    rows = []
    for user in users:
        profile = db["student_profiles"].find_one({"user_id": user["id"]})
        
        tests = profile.get("tests_completed", 0) if profile else 0
        acc = profile.get("avg_accuracy", 0) if profile else 0
        score = int(tests * acc * 10)
        
        trend = "same"
        if tests > 0:
            trend = "up" if score % 3 == 0 else "down" if score % 2 == 0 else "same"
            
        college = db["colleges"].find_one({"id": user.get("college_id")})
        college_name = college["name"] if college else "Independent"
        
        rows.append({
            "id": user["id"],
            "name": user.get("name", "Student"),
            "college": college_name,
            "score": score,
            "accuracy": acc,
            "avatar": user.get("name", "U")[0].upper() if user.get("name") else "U",
            "trend": trend,
            "rank": 0,
        })
        
    active_rows = [r for r in rows if r["score"] > 0]
    if not active_rows and rows:
        active_rows = rows
        
    active_rows.sort(key=lambda item: item["score"], reverse=True)
    
    for index, row in enumerate(active_rows, start=1):
        row["rank"] = index
        
    return {"success": True, "data": active_rows}
