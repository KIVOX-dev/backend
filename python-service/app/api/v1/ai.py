import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from groq import Groq

from app.core.rbac import get_current_user
from app.models.user import User

router = APIRouter(prefix="/ai", tags=["AI"])

class ResumeData(BaseModel):
    objective: str
    education: str
    skills: str
    experience: str

@router.post("/resume/improve")
def improve_resume(data: ResumeData, current_user: User = Depends(get_current_user)):
    """
    Improves resume content using Groq LLM to make it more professional and ATS-friendly.
    """
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        # Fallback if no key is provided just return the same text
        return {
            "objective": data.objective,
            "education": data.education,
            "skills": data.skills,
            "experience": data.experience,
            "message": "GROQ_API_KEY not configured. Returning original text."
        }

    try:
        client = Groq(api_key=groq_api_key)
        
        prompt = f"""
        You are an expert Resume Writer and Career Coach. 
        Improve the following resume sections to make them sound professional, impactful, and ATS-friendly.
        Do not add new facts, just rewrite the existing information better.
        Return the result as a raw JSON object with keys: "objective", "education", "skills", "experience".
        Do not include markdown blocks or any other text outside the JSON.

        Objective: {data.objective}
        Education: {data.education}
        Skills: {data.skills}
        Experience: {data.experience}
        """

        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1024,
            response_format={"type": "json_object"}
        )

        import json
        result_text = completion.choices[0].message.content
        improved_data = json.loads(result_text)
        
        return improved_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to improve resume: {str(e)}")
