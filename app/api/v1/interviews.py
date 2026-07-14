from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import os
import json

from app.core.rbac import get_college_scope, get_current_user
from app.database import get_db
from app.schemas.interview import InterviewAttemptResponse, InterviewSubmitRequest

router = APIRouter(prefix="/interviews", tags=["Interviews"])

def to_dict(obj):
    if not obj: return None
    obj["id"] = obj.get("id", str(obj.get("_id")))
    obj.pop("_id", None)
    return obj


@router.get("/student/{student_id}")
def list_interviews(student_id: int, db = Depends(get_db), college_scope: int | None = get_college_scope):
    query = {"student_id": student_id}
    if college_scope:
        query["college_id"] = college_scope
    attempts = db["interview_attempts"].find(query).sort("created_at", -1)
    return [to_dict(doc) for doc in attempts]


@router.post("/student/{student_id}")
def submit_interview(student_id: int, data: InterviewSubmitRequest, current_user = Depends(get_current_user), db = Depends(get_db)):
    attempt_number = db["interview_attempts"].count_documents({"student_id": student_id}) + 1
    attempt = {
        "id": db["interview_attempts"].count_documents({}) + 1,
        "student_id": student_id,
        "college_id": current_user.get("college_id") or 1,
        "role": data.role,
        "category": data.category,
        "overall_rating": data.overall_rating,
        "strengths": data.strengths,
        "improvements": data.improvements,
        "duration_seconds": data.duration_seconds,
        "attempt_number": attempt_number,
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db["interview_attempts"].insert_one(attempt)
    
    for response in data.responses:
        r_dict = response.model_dump()
        r_dict["attempt_id"] = attempt["id"]
        r_dict["id"] = db["interview_responses"].count_documents({}) + 1
        db["interview_responses"].insert_one(r_dict)
        
    db["student_profiles"].update_one(
        {"user_id": student_id},
        {"$inc": {"interviews_completed": 1}}
    )
    return to_dict(attempt)


@router.post("/generate", response_model=list[dict])
def generate_questions(role: str, company: str = "general", current_user = Depends(get_current_user), db = Depends(get_db)):
    """
    Generates 10 random questions for the given role and company using Groq LLM.
    """
    from groq import Groq
    from app.config import get_settings
    
    groq_api_key = get_settings().GROQ_API_KEY
    if not groq_api_key:
        import random
        question_pool = [
            "What are the key differences between React and Angular?",
            "Explain the concept of closures in JavaScript.",
            "How would you optimize a slow-performing database query?",
            "Describe a time you had to resolve a conflict within your team.",
            "What is the difference between TCP and UDP?"
        ]
        selected_questions = random.sample(question_pool * 2, 10)
        return [{"id": i + 1, "text": f"[{company.upper()} - {role.upper()}] {q}", "time_limit_seconds": 60, "type": "technical"} for i, q in enumerate(selected_questions)]

    try:
        client = Groq(api_key=groq_api_key)
        
        prompt = f"""
        You are an expert technical interviewer at {company} hiring for a {role} position.
        Generate exactly 10 interview questions for this specific role and company. 
        Make them realistic, challenging, and a mix of technical (7) and behavioral (3) questions.
        Return the result as a raw JSON object with a single key "questions" containing a list of strings.
        Do not include markdown blocks or any other text outside the JSON.
        """

        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1024,
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
        generated_questions = data.get("questions", [])
        
        if not generated_questions or len(generated_questions) < 10:
            raise ValueError("LLM did not return enough questions")
            
        formatted_questions = []
        for i, q in enumerate(generated_questions[:10]):
            formatted_questions.append({
                "id": i + 1,
                "text": q,
                "time_limit_seconds": 60,
                "type": "technical" if i < 7 else "behavioral"
            })
            
        return formatted_questions
    except Exception as e:
        print(f"Failed to generate questions with AI: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate questions: {str(e)}")
