import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import get_settings
from app.db import timed_log
from app.groq_client import GroqError, groq_complete
from app.schemas.resume import (
    AiSuggestRequest,
    AiSuggestResponse,
    AnalyzeRequest,
    ImproveResumeRequest,
    ImproveResumeResponse,
    MatchJdRequest,
    ParseResumeRequest,
)
from app.security import verify_service_token

logger = logging.getLogger("ai-service.resume")
router = APIRouter(prefix="/v1/resume", tags=["resume"], dependencies=[Depends(verify_service_token)])

NOT_CONFIGURED_DETAIL = "GROQ_API_KEY is not configured"


def _require_groq() -> None:
    if not get_settings().is_groq_configured:
        # 503, not 500 — this is a missing optional dependency of the AI
        # service, not a bug in it. node-api's aiServiceClient.js maps this
        # specific status back to the same ApiError.internal('GROQ_API_KEY is
        # not configured') the frontend already handled before this endpoint
        # existed, so the contract callers see is unchanged.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_CONFIGURED_DETAIL)


ANALYZE_SYSTEM_PROMPT = "You are an expert ATS Resume Analyzer. Return a valid JSON object only, no markdown."
ANALYZE_KEYS = """Required JSON keys:
- "score": integer 0-100 (ATS score)
- "readability": integer 0-100
- "section_completeness": list of {"section", "score" (0-100), "status" ("Complete"|"Needs Info"|"Missing")}
- "keywords_analyzed": integer count of key industry keywords found
- "missing_keywords": list of strings
- "formatting_issues": list of strings
- "contact_validation": list of strings
- "skills_gap": list of strings
- "experience_quality": string
- "suggestions": list of strings"""


@router.post("/analyze")
async def analyze(payload: AnalyzeRequest):
    _require_groq()
    user_prompt = (
        f"Analyze the following resume and return a highly detailed, professional feedback report.\n\n"
        f"{ANALYZE_KEYS}\n\nResume Data:\n{json.dumps(payload.resume, indent=2)}"
    )
    async with timed_log("resume.analyze"):
        try:
            return await groq_complete(ANALYZE_SYSTEM_PROMPT, user_prompt, temperature=0.3, max_tokens=2048, json_response=True)
        except GroqError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"ATS Analysis failed: {exc}") from exc


MATCH_SYSTEM_PROMPT = "You are an expert recruiter. Return a valid JSON object only, no markdown."
MATCH_KEYS = """Required JSON keys:
- "match_percentage": integer 0-100
- "ats_match_status": string ("Highly Compatible"|"Moderately Compatible"|"Low Compatibility")
- "matching_skills": list of strings
- "missing_keywords": list of strings
- "suggested_skills": list of strings
- "missing_experience": string
- "recommended_certifications": list of strings
- "recommended_projects": list of strings
- "overall_evaluation": string"""


@router.post("/match-jd")
async def match_job_description(payload: MatchJdRequest):
    _require_groq()
    user_prompt = (
        "Compare the candidate's resume with the provided Job Description. Return a detailed compatibility report.\n\n"
        f"{MATCH_KEYS}\n\nJob Description:\n{payload.jd_text}\n\nCandidate Resume:\n{json.dumps(payload.resume, indent=2)}"
    )
    async with timed_log("resume.match_jd"):
        try:
            return await groq_complete(MATCH_SYSTEM_PROMPT, user_prompt, temperature=0.3, max_tokens=2048, json_response=True)
        except GroqError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"JD Matching failed: {exc}") from exc


AI_SUGGEST_SYSTEM_PROMPT = "You are a professional ATS resume writer. Help the student optimize their profile."


@router.post("/suggest", response_model=AiSuggestResponse)
async def ai_suggest(payload: AiSuggestRequest):
    _require_groq()

    action = payload.action
    content = payload.content or ""
    if action == "summary":
        user_prompt = (
            "Based on the following content, write a concise, compelling, and professional resume summary "
            f"(maximum 3 sentences):\n{content}"
        )
    elif action == "rewrite":
        user_prompt = (
            "Rewrite the following description or bullet point using strong action verbs, professional style, "
            f"and making it ATS-friendly. Maintain all facts and metrics:\n{content}"
        )
    elif action == "skills":
        user_prompt = (
            f"Given the student's department or role '{content}', suggest a structured list of technical skills, "
            "tools, and soft skills they should include on their resume. Return a JSON object with keys "
            "'technical', 'tools', 'soft'."
        )
    elif action == "grammar":
        user_prompt = (
            "Correct any grammar or spelling mistakes in the following text. Preserve the original meaning and "
            f"formatting. Return only the corrected text:\n{content}"
        )
    elif action in ("cover_letter", "interview_prep"):
        resume_data = json.dumps(payload.resume) if payload.resume else content
        if action == "cover_letter":
            user_prompt = (
                "Write a professional, tailored Cover Letter based on this Job Description and the student's "
                f"resume.\n\nJob Description:\n{payload.jd_text or ''}\n\nStudent Resume:\n{resume_data}"
            )
        else:
            user_prompt = (
                "Generate 5 tailored technical and behavioral interview preparation questions and guidelines "
                f"based on the student's resume.\n\nStudent Resume:\n{resume_data}"
            )
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action type")

    async with timed_log("resume.ai_suggest") as detail:
        detail["action"] = action
        try:
            output = await groq_complete(AI_SUGGEST_SYSTEM_PROMPT, user_prompt, temperature=0.5, max_tokens=1500)
        except GroqError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI suggestion failed: {exc}") from exc

    output = output.strip()
    if action == "skills":
        start, end = output.find("{"), output.rfind("}") + 1
        if start != -1 and end != 0:
            try:
                return AiSuggestResponse(result=json.loads(output[start:end]))
            except json.JSONDecodeError:
                pass  # fall through with the raw text — same best-effort behavior as node-api/python
    return AiSuggestResponse(result=output)


PARSE_SYSTEM_PROMPT = "You are an expert resume parsing tool. Return a valid JSON object only, no markdown."
PARSE_SCHEMA = """- "personal": { "name": "", "email": "", "phone": "", "linkedin": "", "github": "", "portfolio": "", "address": "", "role": "" }
- "objective": ""
- "education": [ { "institution": "", "degree": "", "year": "", "score": "" } ]
- "experience": [ { "role": "", "company": "", "duration": "", "description": "" } ]
- "projects": [ { "title": "", "description": "", "link": "", "technologies": "" } ]
- "skills": [ { "name": "", "category": "technical" | "soft" } ]
- "certifications": [ { "name": "", "issuer": "", "year": "" } ]"""


@router.post("/parse")
async def parse_resume_text(payload: ParseResumeRequest):
    _require_groq()
    user_prompt = (
        "Extract the candidate information from the following text into structured JSON fields matching this "
        f"exact key structure:\n\n{PARSE_SCHEMA}\n\nText content:\n{payload.text}"
    )
    async with timed_log("resume.parse"):
        try:
            return await groq_complete(PARSE_SYSTEM_PROMPT, user_prompt, temperature=0.1, max_tokens=2048, json_response=True)
        except GroqError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Resume parsing failed: {exc}") from exc


IMPROVE_SYSTEM_PROMPT = "You are an expert Resume Writer and Career Coach."


@router.post("/improve", response_model=ImproveResumeResponse)
async def improve_resume_text(payload: ImproveResumeRequest):
    settings = get_settings()
    if not settings.is_groq_configured:
        return ImproveResumeResponse(
            objective=payload.objective,
            education=payload.education,
            skills=payload.skills,
            experience=payload.experience,
            message="GROQ_API_KEY not configured. Returning original text.",
        )

    user_prompt = (
        "Improve the following resume sections to make them sound professional, impactful, and ATS-friendly.\n"
        "Do not add new facts, just rewrite the existing information better.\n"
        'Return the result as a raw JSON object with keys: "objective", "education", "skills", "experience".\n\n'
        f"Objective: {payload.objective}\nEducation: {payload.education}\nSkills: {payload.skills}\nExperience: {payload.experience}"
    )
    async with timed_log("resume.improve"):
        try:
            result = await groq_complete(IMPROVE_SYSTEM_PROMPT, user_prompt, temperature=0.7, max_tokens=1024, json_response=True)
        except GroqError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to improve resume: {exc}") from exc

    return ImproveResumeResponse(
        objective=result.get("objective", payload.objective),
        education=result.get("education", payload.education),
        skills=result.get("skills", payload.skills),
        experience=result.get("experience", payload.experience),
    )
