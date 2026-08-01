import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from groq import Groq

from app.database import get_db
from app.core.rbac import get_current_user
from app.repositories.base import DotDict

logger = logging.getLogger("upscaler_ai.resume")
router = APIRouter(prefix="/resume", tags=["Resume"])

class ResumeSaveRequest(BaseModel):
    personal: Dict[str, Any]
    objective: str
    education: List[Dict[str, Any]]
    experience: List[Dict[str, Any]]
    projects: List[Dict[str, Any]]
    skills: List[Dict[str, Any]]
    certifications: List[Dict[str, Any]]
    internships: List[Dict[str, Any]]
    achievements: List[Dict[str, Any]]
    hackathons: List[Dict[str, Any]]
    publications: List[Dict[str, Any]]
    languages: List[Dict[str, Any]]
    volunteer: List[Dict[str, Any]]
    references: List[Dict[str, Any]]
    customSections: List[Dict[str, Any]]
    sectionOrder: List[str]
    template: str
    zoom: Optional[float] = 1.0

class SaveVersionRequest(BaseModel):
    name: str

class JDMatchRequest(BaseModel):
    jd_text: str

class AISuggestRequest(BaseModel):
    action: str  # 'summary' | 'bullet' | 'skills' | 'rewrite' | 'grammar' | 'cover_letter' | 'interview_prep'
    section: Optional[str] = None
    content: Optional[str] = None
    jd_text: Optional[str] = None

class ResumeParseRequest(BaseModel):
    text: str

def get_groq_client():
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GROQ_API_KEY is not configured in environment variables."
        )
    return Groq(api_key=groq_api_key)

@router.get("")
def get_resume(db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Fetch the active resume and saved versions for the current student."""
    resume = db["resumes"].find_one({"user_id": current_user.id})
    if not resume:
        # Return default structure
        resume = {
            "user_id": current_user.id,
            "personal": {
                "name": current_user.name,
                "email": current_user.email,
                "phone": "",
                "linkedin": "",
                "github": "",
                "portfolio": "",
                "address": "",
                "role": ""
            },
            "objective": "",
            "education": [],
            "experience": [],
            "projects": [],
            "skills": [],
            "certifications": [],
            "internships": [],
            "achievements": [],
            "hackathons": [],
            "publications": [],
            "languages": [],
            "volunteer": [],
            "references": [],
            "customSections": [],
            "sectionOrder": ["personal", "objective", "education", "experience", "projects", "skills", "certifications"],
            "template": "modern",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        db["resumes"].insert_one(resume)

    # Convert mongo _id
    resume["id"] = str(resume["_id"])
    resume.pop("_id", None)

    # Fetch versions
    versions = list(db["resume_versions"].find({"user_id": current_user.id}).sort("created_at", -1))
    for v in versions:
        v["id"] = str(v["_id"])
        v.pop("_id", None)

    return {"resume": resume, "versions": versions}

@router.post("")
def save_resume(data: ResumeSaveRequest, db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Save the active resume details (auto-save endpoint)."""
    now = datetime.now(timezone.utc).isoformat()
    update_doc = data.model_dump()
    update_doc["updated_at"] = now
    
    db["resumes"].update_one(
        {"user_id": current_user.id},
        {"$set": update_doc},
        upsert=True
    )
    
    # Also update the user's main profile skills list if present
    skills_list = [s.get("name") for s in data.skills if s.get("name")]
    if skills_list:
        skills_str = ", ".join(skills_list)
        db["student_profiles"].update_one(
            {"user_id": current_user.id},
            {"$set": {"skills": skills_str}}
        )

    return {"success": True, "updated_at": now}

@router.post("/version")
def save_version(payload: SaveVersionRequest, db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Save the current resume state as a new version."""
    resume = db["resumes"].find_one({"user_id": current_user.id})
    if not resume:
        raise HTTPException(status_code=404, detail="No active resume found to version")
    
    resume.pop("_id", None)
    version_doc = {
        **resume,
        "name": payload.name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    db["resume_versions"].insert_one(version_doc)
    return {"success": True, "message": f"Version '{payload.name}' saved successfully"}

@router.post("/version/{version_id}/restore")
def restore_version(version_id: str, db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Restore a previously saved version as the active resume."""
    from bson import ObjectId
    try:
        obj_id = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid version ID format")

    version = db["resume_versions"].find_one({"_id": obj_id, "user_id": current_user.id})
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    version.pop("_id", None)
    version.pop("name", None)
    version["updated_at"] = datetime.now(timezone.utc).isoformat()

    db["resumes"].update_one(
        {"user_id": current_user.id},
        {"$set": version},
        upsert=True
    )
    return {"success": True, "message": "Resume restored to selected version"}

@router.delete("/version/{version_id}")
def delete_version(version_id: str, db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Delete a saved version."""
    from bson import ObjectId
    try:
        obj_id = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid version ID format")

    res = db["resume_versions"].delete_one({"_id": obj_id, "user_id": current_user.id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"success": True, "message": "Version deleted"}

@router.post("/analyze")
def analyze_resume(db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Analyze the student's active resume against ATS standards using Groq."""
    resume = db["resumes"].find_one({"user_id": current_user.id})
    if not resume:
        raise HTTPException(status_code=404, detail="Active resume not found")

    client = get_groq_client()
    
    # Strip unnecessary fields for lower token usage
    resume.pop("_id", None)
    resume.pop("user_id", None)
    resume.pop("created_at", None)
    resume.pop("updated_at", None)
    resume.pop("sectionOrder", None)
    resume.pop("template", None)
    resume.pop("zoom", None)

    prompt = f"""
    You are an expert ATS Resume Analyzer.
    Analyze the following resume and return a highly detailed, professional feedback report.
    The response MUST be a valid JSON object only. Do not wrap the JSON in markdown code blocks.
    
    Required JSON keys:
    - "score": integer between 0 and 100 representing the ATS score.
    - "readability": integer between 0 and 100 for readability score.
    - "section_completeness": list of objects containing "section" (name) and "score" (0-100) and "status" (e.g. "Complete", "Needs Info", "Missing").
    - "keywords_analyzed": integer representing the count of key industry keywords found.
    - "missing_keywords": list of strings of important missing keywords based on the candidate's career role.
    - "formatting_issues": list of strings describing any layout or formatting issues (e.g., standard margins, page breaks, fonts).
    - "contact_validation": list of strings indicating validity of contact info (e.g., email format, LinkedIn URL, GitHub presence).
    - "skills_gap": list of strings showing critical tech/soft skills gaps.
    - "experience_quality": string evaluating the depth and style of the work experience descriptions.
    - "suggestions": list of strings suggesting actionable steps to improve the score.

    Resume Data:
    {json.dumps(resume, indent=2)}
    """

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2048,
            response_format={"type": "json_object"}
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        logger.error(f"ATS Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"ATS Analysis failed: {str(e)}")

@router.post("/match-jd")
def match_job_description(payload: JDMatchRequest, db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Compare student resume with a pasted Job Description using Groq."""
    resume = db["resumes"].find_one({"user_id": current_user.id})
    if not resume:
        raise HTTPException(status_code=404, detail="Active resume not found")

    client = get_groq_client()
    
    resume.pop("_id", None)
    resume.pop("user_id", None)

    prompt = f"""
    You are an expert recruiter. Compare the candidate's resume with the provided Job Description.
    Return a detailed compatibility report as a raw JSON object only. Do not wrap in markdown code blocks.
    
    Required JSON keys:
    - "match_percentage": integer from 0 to 100.
    - "ats_match_status": string (e.g., "Highly Compatible", "Moderately Compatible", "Low Compatibility").
    - "matching_skills": list of strings of skills present in both.
    - "missing_keywords": list of strings of skills/tools mentioned in JD but missing in resume.
    - "suggested_skills": list of strings of related technical skills to add.
    - "missing_experience": string detailing any work experience gaps for the job.
    - "recommended_certifications": list of strings of certifications that would boost the profile for this role.
    - "recommended_projects": list of strings suggesting project ideas that match the JD.
    - "overall_evaluation": string summarizing the fit.

    Job Description:
    {payload.jd_text}

    Candidate Resume:
    {json.dumps(resume, indent=2)}
    """

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2048,
            response_format={"type": "json_object"}
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        logger.error(f"JD Match failed: {e}")
        raise HTTPException(status_code=500, detail=f"JD Matching failed: {str(e)}")

@router.post("/ai-suggest")
def ai_suggest(payload: AISuggestRequest, db = Depends(get_db), current_user: DotDict = Depends(get_current_user)):
    """Generates summary, cover letters, rewrites experiences, or suggests skills using Groq."""
    client = get_groq_client()

    system_instruction = "You are a professional ATS resume writer. Help the student optimize their profile."
    
    if payload.action == "summary":
        prompt = f"Based on the following content, write a concise, compelling, and professional resume summary (maximum 3 sentences):\n{payload.content}"
    elif payload.action == "rewrite":
        prompt = f"Rewrite the following description or bullet point using strong action verbs, professional style, and making it ATS-friendly. Maintain all facts and metrics:\n{payload.content}"
    elif payload.action == "skills":
        prompt = f"Given the student's department or role '{payload.content}', suggest a structured list of technical skills, tools, and soft skills they should include on their resume. Return a JSON object with keys 'technical', 'tools', 'soft'."
    elif payload.action == "grammar":
        prompt = f"Correct any grammar or spelling mistakes in the following text. Preserve the original meaning and formatting. Return only the corrected text:\n{payload.content}"
    elif payload.action == "cover_letter":
        resume = db["resumes"].find_one({"user_id": current_user.id})
        resume_data = json.dumps(resume, default=str) if resume else payload.content
        prompt = f"Write a professional, tailored Cover Letter based on this Job Description and the student's resume.\n\nJob Description:\n{payload.jd_text}\n\nStudent Resume:\n{resume_data}"
    elif payload.action == "interview_prep":
        resume = db["resumes"].find_one({"user_id": current_user.id})
        resume_data = json.dumps(resume, default=str) if resume else payload.content
        prompt = f"Generate 5 tailored technical and behavioral interview preparation questions and guidelines based on the student's resume.\n\nStudent Resume:\n{resume_data}"
    else:
        raise HTTPException(status_code=400, detail="Invalid action type")

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
            max_tokens=1500
        )
        output = completion.choices[0].message.content.strip()
        
        # If skills action, try to load JSON
        if payload.action == "skills":
            try:
                # Find JSON bounds if the model included conversational wrappers
                start = output.find("{")
                end = output.rfind("}") + 1
                if start != -1 and end != -1:
                    output = json.loads(output[start:end])
            except Exception:
                pass
                
        return {"result": output}
    except Exception as e:
        logger.error(f"AI Suggestion failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {str(e)}")

@router.post("/parse")
def parse_resume_text(payload: ResumeParseRequest, current_user = Depends(get_current_user)):
    """Parse raw resume text into structured JSON fields using Groq."""
    client = get_groq_client()
    
    prompt = f"""
    You are an expert resume parsing tool.
    Extract the candidate information from the following text into structured JSON fields matching this exact key structure:
    
    Required JSON keys:
    - "personal": {{ "name": "", "email": "", "phone": "", "linkedin": "", "github": "", "portfolio": "", "address": "", "role": "" }}
    - "objective": ""
    - "education": [ {{ "institution": "", "degree": "", "year": "", "score": "" }} ]
    - "experience": [ {{ "role": "", "company": "", "duration": "", "description": "" }} ]
    - "projects": [ {{ "title": "", "description": "", "link": "", "technologies": "" }} ]
    - "skills": [ {{ "name": "", "category": "technical" | "soft" }} ]
    - "certifications": [ {{ "name": "", "issuer": "", "year": "" }} ]
    
    Text content:
    {payload.text}
    """

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
            response_format={"type": "json_object"}
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        logger.error(f"Resume parsing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Resume parsing failed: {str(e)}")
