from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.rbac import get_college_scope, get_current_user
from app.database import get_db
from app.schemas.placement import (
    JobPostingCreateRequest,
    JobPostingResponse,
    JobApplicationResponse,
)

router = APIRouter(prefix="/jobs", tags=["Jobs"])


def _next_id(db, collection: str) -> int:
    last = db[collection].find_one(sort=[("id", -1)], projection={"id": 1})
    return (last["id"] + 1) if last and isinstance(last.get("id"), int) else 1


def _clean(doc):
    if doc:
        doc.pop("_id", None)
    return doc


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.get("", response_model=list[JobPostingResponse])
def get_jobs(db=Depends(get_db)):
    """Get all active job postings."""
    cursor = db["job_postings"].find({"is_active": True}).sort("created_at", -1)
    return [_clean(doc) for doc in cursor]


@router.get("/me", response_model=list[JobPostingResponse])
def get_my_jobs(db=Depends(get_db), current_user=Depends(get_current_user)):
    """Get jobs posted by the current HR/Recruiter."""
    cursor = db["job_postings"].find({"recruiter_id": current_user.id}).sort("created_at", -1)
    return [_clean(doc) for doc in cursor]


@router.post("", response_model=JobPostingResponse)
def create_job(
    job_data: JobPostingCreateRequest,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Post a new job vacancy — a recruiter's open role, or a college's own placement drive."""
    allowed_roles = ["hr", "recruiter", "college_admin", "super_admin"]
    if current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Not authorized to post jobs")

    # A college admin's drive is always scoped to their own college, regardless
    # of what the client sent — the same pattern users.py uses for created users.
    college_id = job_data.college_id
    if current_user.role == "college_admin":
        college_id = current_user.college_id or 1

    job = {
        "id": _next_id(db, "job_postings"),
        "recruiter_id": current_user.id,
        "college_id": college_id,
        "title": job_data.title,
        "description": job_data.description,
        "company_name": job_data.company_name or current_user.company_name,
        "location": job_data.location,
        "job_type": job_data.job_type,
        "salary_min_lpa": job_data.salary_min_lpa,
        "salary_max_lpa": job_data.salary_max_lpa,
        "required_skills": job_data.required_skills,
        "eligible_departments": job_data.eligible_departments,
        "eligible_years": job_data.eligible_years,
        "min_cgpa": job_data.min_cgpa,
        "application_deadline": job_data.application_deadline,
        "status": "active",
        "is_active": True,
        "created_at": _now(),
        "updated_at": _now(),
    }
    db["job_postings"].insert_one(job)
    return _clean(job)


@router.get("/drives")
def college_drives(db=Depends(get_db), college_scope: int | None = get_college_scope):
    """Placement drives (job postings) for the caller's college, with applicant counts.

    Used by the college-admin placements dashboard — 'drive' is just the
    college-facing name for a job posting scoped to that college.
    """
    query = {}
    if college_scope:
        query["college_id"] = int(college_scope)
    postings = list(db["job_postings"].find(query).sort("created_at", -1))
    if not postings:
        return []

    posting_ids = [p["id"] for p in postings]
    counts: dict[int, int] = {}
    for row in db["job_applications"].aggregate(
        [
            {"$match": {"job_posting_id": {"$in": posting_ids}}},
            {"$group": {"_id": "$job_posting_id", "count": {"$sum": 1}}},
        ]
    ):
        counts[row["_id"]] = row["count"]

    return [
        {
            "id": p["id"],
            "title": p.get("title"),
            "company_name": p.get("company_name"),
            "location": p.get("location"),
            "job_type": p.get("job_type"),
            "status": p.get("status"),
            "application_deadline": p.get("application_deadline"),
            "created_at": p.get("created_at"),
            "applicant_count": counts.get(p["id"], 0),
        }
        for p in postings
    ]


@router.get("/applications/me", response_model=list[JobApplicationResponse])
def get_my_job_applications(db=Depends(get_db), current_user=Depends(get_current_user)):
    """Get all applications for jobs posted by the current HR/Recruiter."""
    if current_user.role not in ["hr", "recruiter"]:
        raise HTTPException(status_code=403, detail="Only recruiters can view applications")

    jobs = list(db["job_postings"].find({"recruiter_id": current_user.id}, {"id": 1, "title": 1}))
    if not jobs:
        return []
    job_titles = {job["id"]: job.get("title") for job in jobs}

    applications = db["job_applications"].find({"job_posting_id": {"$in": list(job_titles)}})

    result = []
    for app in applications:
        student = db["users"].find_one({"id": app.get("student_id")}, {"name": 1, "email": 1})
        result.append(
            {
                "id": app.get("id"),
                "job_posting_id": app.get("job_posting_id"),
                "student_id": app.get("student_id"),
                "status": app.get("status"),
                "applied_at": app.get("applied_at"),
                "updated_at": app.get("updated_at"),
                "notes": app.get("notes"),
                "interview_scheduled_at": app.get("interview_scheduled_at"),
                "student_name": student.get("name") if student else None,
                "student_email": student.get("email") if student else None,
                "job_title": job_titles.get(app.get("job_posting_id")),
            }
        )
    return result
