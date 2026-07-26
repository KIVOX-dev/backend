"""
Skillovate V2 — MongoDB index definitions.

Every query the API issues filters on one of the fields below. Without these
indexes MongoDB performs a full collection scan for each request, which is the
single largest source of latency against a remote Atlas cluster.

`ensure_indexes()` is idempotent — `create_index` is a no-op when an equivalent
index already exists — so it is safe to run on every startup.
"""

import logging

from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.errors import OperationFailure, PyMongoError

logger = logging.getLogger("skillovate")


# (collection, keys, options)
INDEX_SPECS: list[tuple[str, list[tuple[str, int]], dict]] = [
    # ── users ────────────────────────────────────────────────────────────
    # Login path: find_one({"email": ...}) — unique also prevents duplicates.
    ("users", [("email", ASCENDING)], {"unique": True, "name": "ux_users_email"}),
    # Application-level integer id used by nearly every route.
    ("users", [("id", ASCENDING)], {"unique": True, "name": "ux_users_id"}),
    # get_all_users / get_pending_users scope-then-sort.
    ("users", [("college_id", ASCENDING), ("role", ASCENDING), ("created_at", DESCENDING)],
     {"name": "ix_users_college_role_created"}),
    ("users", [("status", ASCENDING), ("college_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "ix_users_status_college_created"}),
    ("users", [("role", ASCENDING)], {"name": "ix_users_role"}),

    # ── student_profiles ─────────────────────────────────────────────────
    ("student_profiles", [("user_id", ASCENDING)], {"unique": True, "name": "ux_sp_user"}),
    ("student_profiles", [("id", ASCENDING)], {"name": "ix_sp_id"}),

    # ── faculty / recruiter profiles ─────────────────────────────────────
    ("faculty_profiles", [("user_id", ASCENDING)], {"unique": True, "name": "ux_fp_user"}),
    ("recruiter_profiles", [("user_id", ASCENDING)], {"unique": True, "name": "ux_rp_user"}),

    # ── assessments ──────────────────────────────────────────────────────
    ("assessments", [("id", ASCENDING)], {"unique": True, "name": "ux_assess_id"}),
    ("assessments", [("college_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "ix_assess_college_created"}),

    # ── assessment_attempts ──────────────────────────────────────────────
    # The dashboard's hottest query: student_id + status, newest first.
    ("assessment_attempts", [("student_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
     {"name": "ix_attempt_student_status_created"}),
    ("assessment_attempts", [("college_id", ASCENDING)], {"name": "ix_attempt_college"}),
    ("assessment_attempts", [("assessment_id", ASCENDING)], {"name": "ix_attempt_assessment"}),
    ("assessment_attempts", [("id", ASCENDING)], {"name": "ix_attempt_id"}),

    # ── interviews ───────────────────────────────────────────────────────
    ("interview_attempts", [("student_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "ix_interview_student_created"}),
    ("interview_responses", [("interview_id", ASCENDING)], {"name": "ix_iresp_interview"}),

    # ── placements ───────────────────────────────────────────────────────
    ("placements", [("student_id", ASCENDING)], {"name": "ix_placement_student"}),
    ("placements", [("college_id", ASCENDING)], {"name": "ix_placement_college"}),

    # ── resume ───────────────────────────────────────────────────────────
    ("resumes", [("user_id", ASCENDING)], {"unique": True, "name": "ux_resume_user"}),
    ("resume_versions", [("user_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "ix_rversion_user_created"}),
    ("resume_versions", [("id", ASCENDING)], {"name": "ix_rversion_id"}),

    # ── colleges / departments ───────────────────────────────────────────
    ("colleges", [("id", ASCENDING)], {"unique": True, "name": "ux_college_id"}),
    ("departments", [("college_id", ASCENDING)], {"name": "ix_dept_college"}),

    # ── achievements ─────────────────────────────────────────────────────
    ("achievements", [("student_id", ASCENDING)], {"name": "ix_achv_student"}),

    # ── chat ─────────────────────────────────────────────────────────────
    # History is fetched per conversation pair and rendered oldest-first.
    ("messages", [("sender_id", ASCENDING), ("receiver_id", ASCENDING), ("timestamp", ASCENDING)],
     {"name": "ix_msg_pair_time"}),
    ("messages", [("receiver_id", ASCENDING), ("timestamp", DESCENDING)],
     {"name": "ix_msg_receiver_time"}),

    # ── profile_data ─────────────────────────────────────────────────────
    ("profile_data", [("user_id", ASCENDING)], {"unique": True, "name": "ux_profile_user"}),
]

# Text index for the student search box (`GET /students?search=`).
TEXT_INDEX_SPECS: list[tuple[str, list[tuple[str, str]], dict]] = [
    ("users", [("name", TEXT), ("email", TEXT)], {"name": "tx_users_name_email"}),
]


def ensure_indexes(db) -> None:
    """Create every index the API relies on. Safe to call repeatedly."""
    created = 0
    skipped = 0

    for collection, keys, options in INDEX_SPECS:
        try:
            db[collection].create_index(keys, background=True, **options)
            created += 1
        except OperationFailure as exc:
            # Most commonly: an equivalent index exists under a different name,
            # or a unique index cannot be built because the data has duplicates.
            # Neither should stop the app from booting.
            skipped += 1
            logger.warning(
                "Index %s on %s not created: %s", options.get("name"), collection, exc
            )
        except PyMongoError as exc:
            skipped += 1
            logger.warning("Index %s on %s failed: %s", options.get("name"), collection, exc)

    for collection, keys, options in TEXT_INDEX_SPECS:
        try:
            db[collection].create_index(keys, background=True, **options)
            created += 1
        except OperationFailure as exc:
            # A collection may only carry one text index; ignore if one exists.
            skipped += 1
            logger.warning("Text index on %s not created: %s", collection, exc)
        except PyMongoError as exc:
            skipped += 1
            logger.warning("Text index on %s failed: %s", collection, exc)

    logger.info("MongoDB indexes ensured (%d requested, %d skipped)", created, skipped)
