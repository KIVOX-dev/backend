from datetime import datetime, timezone
import os
import json
from groq import Groq

from fastapi import APIRouter, Depends, HTTPException

from app.core.exceptions import NotFoundError
from app.core.rbac import UserRole, get_college_scope, get_current_user, require_roles
from app.database import get_db
from app.config import get_settings
from app.schemas.assessment import AssessmentCreateRequest, AssessmentResponse, AssessmentUpdateRequest, AttemptResponse, TestSubmitRequest
from app.repositories.base import DotDict

router = APIRouter(prefix="/assessments", tags=["Assessments"])

def to_dict(obj):
    # Convert MongoDB _id to string or map to id if necessary
    if obj is None:
        return None
    obj["id"] = obj.get("id", str(obj.get("_id", "")))
    return obj

@router.get("", response_model=list[AssessmentResponse])
def list_assessments(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {}
    if college_scope:
        query["college_id"] = int(college_scope)
    cursor = db["assessments"].find(query).sort("created_at", -1)
    return [to_dict(doc) for doc in cursor]


@router.post("", response_model=AssessmentResponse, dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def create_assessment(data: AssessmentCreateRequest, current_user = Depends(get_current_user), db = Depends(get_db)):
    doc = data.model_dump()
    doc["id"] = db["assessments"].count_documents({}) + 1
    doc["college_id"] = current_user.college_id or 1
    doc["created_by"] = current_user.id
    doc["shuffle_questions"] = True
    doc["shuffle_options"] = False
    doc["show_result_immediately"] = True
    doc["max_attempts"] = 1
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    db["assessments"].insert_one(doc)
    return to_dict(doc)


@router.post("/generate-questions", dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def generate_assessment_questions(data: dict):
    title = data.get("title", "Assessment")
    type = data.get("type", "general")
    difficulty = data.get("difficulty", "medium")
    
    groq_api_key = get_settings().GROQ_API_KEY
    if not groq_api_key:
        return {"questions": [{"question": f"Sample {difficulty} {type} question for {title}", "options": ["A", "B", "C", "D"], "correct_answer": "A"}]}
        
    try:
        client = Groq(api_key=groq_api_key)
        prompt = f"""
        You are an expert curriculum designer. 
        Generate exactly 10 multiple-choice questions for an assessment titled "{title}".
        Type: {type}
        Difficulty: {difficulty}
        
        Return the result as a raw JSON object with a single key "questions" containing a list of objects.
        Each object should have:
        "question": string
        "options": list of 4 strings
        "correct_answer": string (must match one of the options)
        
        Do not include markdown blocks or any other text outside the JSON.
        """

        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2048,
            response_format={"type": "json_object"}
        )

        result_text = completion.choices[0].message.content.strip()
        if result_text.startswith("```json"):
            result_text = result_text[7:]
        if result_text.startswith("```"):
            result_text = result_text[3:]
        if result_text.endswith("```"):
            result_text = result_text[:-3]
        result_text = result_text.strip()
        data = json.loads(result_text)
        return {"questions": data.get("questions", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate questions: {str(e)}")


@router.get("/overview/stats")
def overview_stats(db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {}
    if college_scope:
        query["college_id"] = int(college_scope)
    
    total = db["assessments"].count_documents(query)
    attempts = list(db["assessment_attempts"].find(query))
    
    avg_score = round(sum(a.get("percentage", 0) for a in attempts) / len(attempts), 2) if attempts else 0
    return {"success": True, "data": {"total": total, "attempts": len(attempts), "avg_score": avg_score}}


def get_assessment_internal(assessment_id: int, db, college_scope: int | None):
    query = {"id": assessment_id}
    if college_scope:
        query["college_id"] = int(college_scope)
    assessment = db["assessments"].find_one(query)
    if not assessment:
        raise NotFoundError("Assessment", str(assessment_id))
    return assessment


@router.get("/{assessment_id}", response_model=AssessmentResponse)
def get_assessment(assessment_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    assessment = get_assessment_internal(assessment_id, db, college_scope)
    return to_dict(assessment)


@router.put("/{assessment_id}", response_model=AssessmentResponse, dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)])
def update_assessment(assessment_id: int, data: AssessmentUpdateRequest, db = Depends(get_db), college_scope: int | None = get_college_scope):
    assessment = get_assessment_internal(assessment_id, db, college_scope)
    
    update_data = data.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    db["assessments"].update_one({"id": assessment_id}, {"$set": update_data})
    
    updated = get_assessment_internal(assessment_id, db, college_scope)
    return to_dict(updated)


@router.delete("/{assessment_id}")
def delete_assessment(assessment_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    assessment = get_assessment_internal(assessment_id, db, college_scope)
    db["assessments"].delete_one({"id": assessment_id})
    return {"success": True, "message": "Assessment deleted"}


@router.get("/{assessment_id}/results", response_model=list[AttemptResponse])
def assessment_results(assessment_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"assessment_id": assessment_id}
    if college_scope:
        query["college_id"] = int(college_scope)
    
    attempts = db["assessment_attempts"].find(query).sort("created_at", -1)
    return [to_dict(doc) for doc in attempts]


@router.post("/submit", response_model=AttemptResponse)
def submit_test(data: TestSubmitRequest, current_user = Depends(get_current_user), db = Depends(get_db)):
    assessment = None
    if data.assessment_id:
        assessment = db["assessments"].find_one({"id": data.assessment_id})
        
    if not assessment:
        assessment = {
            "id": db["assessments"].count_documents({}) + 1,
            "title": "Practice Test",
            "assessment_type": "mixed",
            "college_id": current_user.college_id or 1,
            "created_by": current_user.id,
            "duration_minutes": 30,
            "total_marks": data.max_score,
            "pass_percentage": 40,
            "status": "active",
            "difficulty": "medium",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        db["assessments"].insert_one(assessment)
        
    pct = data.percentage if data.percentage is not None else round((data.score / data.max_score) * 100, 2)
    attempt_number = db["assessment_attempts"].count_documents({
        "assessment_id": assessment["id"], 
        "student_id": current_user.id
    }) + 1
    
    attempt = {
        "id": db["assessment_attempts"].count_documents({}) + 1,
        "assessment_id": assessment["id"],
        "student_id": current_user.id,
        "college_id": current_user.college_id or assessment["college_id"],
        "attempt_number": attempt_number,
        "score": data.score,
        "max_score": data.max_score,
        "percentage": pct,
        "time_taken_seconds": data.time_taken_seconds,
        "passed": pct >= assessment.get("pass_percentage", 40),
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "section_scores": data.section_scores,
        "weak_areas": data.weak_areas,
    }
    db["assessment_attempts"].insert_one(attempt)
    
    # Update profile stats
    profile = db["student_profiles"].find_one({"user_id": current_user.id})
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
            {"user_id": current_user.id},
            {"$set": {
                "tests_completed": tests_completed,
                "avg_accuracy": new_avg,
                "streak": streak,
                "last_test_date": today_date.isoformat()
            }}
        )
        
    return to_dict(attempt)
