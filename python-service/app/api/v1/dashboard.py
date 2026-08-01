from fastapi import APIRouter, Depends
from app.core.rbac import (
    UserRole,
    get_college_scope,
    require_roles,
    get_current_user,
    assert_can_act_on_student,
)
from app.database import get_db

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

# How many recent attempts the UI actually renders in the "recent tests" strip.
RECENT_LIMIT = 5
# Upper bound on the history array returned to the client. The dashboard charts
# a trend line; it does not need an unbounded lifetime export.
HISTORY_LIMIT = 100


def to_dict(obj):
    if not obj:
        return None
    obj["id"] = obj.get("id", str(obj.get("_id")))
    obj.pop("_id", None)
    return obj


@router.get("/student/{student_id}")
def student_dashboard(student_id: int, db=Depends(get_db), current_user=Depends(get_current_user)):
    """Per-student summary.

    Totals are computed by the database in a single aggregation rather than
    streaming every attempt to the app and summing in Python — the previous
    approach transferred the student's entire attempt history on every load.
    """
    assert_can_act_on_student(current_user, student_id, db)
    attempt_filter = {"student_id": student_id, "status": "completed"}

    summary = list(
        db["assessment_attempts"].aggregate(
            [
                {"$match": attempt_filter},
                {
                    "$group": {
                        "_id": None,
                        "tests_completed": {"$sum": 1},
                        "avg_accuracy": {"$avg": {"$ifNull": ["$percentage", 0]}},
                    }
                },
            ]
        )
    )

    tests_completed = summary[0]["tests_completed"] if summary else 0
    avg_accuracy = round(summary[0]["avg_accuracy"] or 0, 2) if summary else 0

    # Newest first off the index, capped. `history` is reversed back into
    # chronological order so existing chart code keeps working unchanged.
    history_desc = list(
        db["assessment_attempts"].find(attempt_filter).sort("created_at", -1).limit(HISTORY_LIMIT)
    )
    history = [to_dict(a) for a in reversed(history_desc)]

    interviews = db["interview_attempts"].count_documents({"student_id": student_id})
    placements = db["placements"].count_documents({"student_id": student_id})

    return {
        "success": True,
        "data": {
            "tests_completed": tests_completed,
            "avg_accuracy": avg_accuracy,
            "interviews_completed": interviews,
            "placements": placements,
            "recent_tests": history[-RECENT_LIMIT:],
            "history": history,
        },
    }


@router.get(
    "/admin",
    dependencies=[require_roles(UserRole.FACULTY, UserRole.COLLEGE_ADMIN, UserRole.SUPER_ADMIN)],
)
def admin_dashboard(db=Depends(get_db), college_scope: int | None = get_college_scope):
    """Institution-wide counters.

    Previously this pulled every attempt row for the college into memory purely
    to derive a count and a mean. Both now come back from one aggregation.
    """
    user_query = {"role": "student"}
    base_query = {}

    if college_scope:
        user_query["college_id"] = int(college_scope)
        base_query["college_id"] = int(college_scope)

    attempt_summary = list(
        db["assessment_attempts"].aggregate(
            [
                {"$match": base_query},
                {
                    "$group": {
                        "_id": None,
                        "attempts": {"$sum": 1},
                        "avg_score": {"$avg": {"$ifNull": ["$percentage", 0]}},
                    }
                },
            ]
        )
    )

    attempts = attempt_summary[0]["attempts"] if attempt_summary else 0
    avg = (attempt_summary[0]["avg_score"] or 0) if attempt_summary else 0

    students = db["users"].count_documents(user_query)
    assessments = db["assessments"].count_documents(base_query)
    placements = db["placements"].count_documents(base_query)

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
def super_dashboard(db=Depends(get_db)):
    """Platform-wide role counts.

    One grouped pass over `users` replaces four separate count queries, each of
    which was its own round trip to the cluster.
    """
    rows = list(
        db["users"].aggregate(
            [
                {"$match": {"role": {"$in": ["student", "faculty", "college_admin", "recruiter"]}}},
                {"$group": {"_id": "$role", "count": {"$sum": 1}}},
            ]
        )
    )
    by_role = {row["_id"]: row["count"] for row in rows}

    return {
        "success": True,
        "data": {
            "students": by_role.get("student", 0),
            "faculty": by_role.get("faculty", 0),
            "admins": by_role.get("college_admin", 0),
            "recruiters": by_role.get("recruiter", 0),
        },
    }
