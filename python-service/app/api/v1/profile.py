"""
UpScaler-AI V2 — Onboarding Profile Router

Backs the frontend's schema-driven "complete your profile" step
(src/lib/onboarding/*, src/app/onboarding/page.tsx) for the three portals
that require it after first sign-in: hr, institutional (college_admin /
super_admin), faculty. Students land straight on their dashboard and never
hit this router.
"""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from app.core.rbac import get_current_user
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/profile", tags=["Profile"])

ROLE_TO_PORTAL = {
    "recruiter": "hr",
    "college_admin": "institutional",
    "super_admin": "institutional",
    "faculty": "faculty",
}

UPLOAD_DIR = os.path.join("uploads", "profile")


def _portal_for(user: User) -> str:
    portal = ROLE_TO_PORTAL.get(user.role)
    if portal is None:
        raise HTTPException(status_code=400, detail=f"No onboarding profile exists for role '{user.role}'")
    return portal


_COUNTRY_OPTIONS = [
    {"label": "India", "value": "IN"},
    {"label": "United States", "value": "US"},
    {"label": "United Kingdom", "value": "UK"},
    {"label": "United Arab Emirates", "value": "AE"},
    {"label": "Singapore", "value": "SG"},
]

_COMMON_SECTION = {
    "id": "preferences",
    "title": "Preferences",
    "description": "General settings for your account",
    "fields": [
        {"name": "timezone", "label": "Timezone", "type": "select", "required": True, "options": [
            {"label": "(GMT+5:30) India Standard Time", "value": "Asia/Kolkata"},
            {"label": "(GMT+0:00) UTC", "value": "UTC"},
            {"label": "(GMT-5:00) Eastern Time", "value": "America/New_York"},
            {"label": "(GMT+4:00) Gulf Standard Time", "value": "Asia/Dubai"},
        ]},
        {"name": "language", "label": "Language", "type": "select", "required": True, "options": [
            {"label": "English", "value": "en"},
            {"label": "Hindi", "value": "hi"},
            {"label": "Tamil", "value": "ta"},
            {"label": "Arabic", "value": "ar"},
        ]},
        {"name": "profilePhoto", "label": "Profile Photo", "type": "file", "required": False,
         "accept": "image/*", "helpText": "Optional. PNG or JPG, up to 5MB."},
        {"name": "signature", "label": "Signature Upload", "type": "file", "required": False,
         "accept": "image/*", "helpText": "Optional. Used on generated documents."},
    ],
}

_SCHEMAS = {
    "hr": {
        "portal": "hr",
        "portalLabel": "HR Portal",
        "sections": [
            {
                "id": "employment",
                "title": "Employment Details",
                "description": "Your role within the organization",
                "fields": [
                    {"name": "employeeId", "label": "Employee ID", "type": "text", "required": True, "placeholder": "EMP-00123"},
                    {"name": "department", "label": "Department", "type": "select", "required": True, "options": [
                        {"label": "Human Resources", "value": "hr"},
                        {"label": "Talent Acquisition", "value": "talent_acquisition"},
                        {"label": "Payroll", "value": "payroll"},
                        {"label": "Operations", "value": "operations"},
                    ]},
                    {"name": "designation", "label": "Designation", "type": "text", "required": True, "placeholder": "HR Manager"},
                    {"name": "yearsOfExperience", "label": "Years of Experience", "type": "number", "required": True, "validation": {"min": 0, "max": 60}},
                    {"name": "linkedinUrl", "label": "LinkedIn URL", "type": "url", "required": False, "placeholder": "https://linkedin.com/in/yourname"},
                ],
            },
            {
                "id": "contact",
                "title": "Contact Information",
                "fields": [
                    {"name": "officePhone", "label": "Office Phone", "type": "tel", "required": True, "placeholder": "+91 22 1234 5678"},
                    {"name": "mobileNumber", "label": "Mobile Number", "type": "tel", "required": True, "placeholder": "+91 98765 43210"},
                    {"name": "emergencyContact", "label": "Emergency Contact", "type": "tel", "required": True, "placeholder": "+91 90000 00000"},
                ],
            },
            {
                "id": "location",
                "title": "Location",
                "fields": [
                    {"name": "country", "label": "Country", "type": "select", "required": True, "options": _COUNTRY_OPTIONS},
                    {"name": "state", "label": "State", "type": "text", "required": True},
                    {"name": "city", "label": "City", "type": "text", "required": True},
                    {"name": "officeLocation", "label": "Office Location", "type": "text", "required": True, "placeholder": "HQ - Tower B, 4th Floor"},
                ],
            },
            _COMMON_SECTION,
        ],
    },
    "institutional": {
        "portal": "institutional",
        "portalLabel": "Institutional Admin Portal",
        "sections": [
            {
                "id": "institution",
                "title": "Institution Details",
                "fields": [
                    {"name": "institutionName", "label": "Institution Name", "type": "text", "required": True},
                    {"name": "institutionCode", "label": "Institution Code", "type": "text", "required": True, "placeholder": "INST-4521"},
                    {"name": "adminId", "label": "Admin ID", "type": "text", "required": True},
                    {"name": "designation", "label": "Designation", "type": "text", "required": True, "placeholder": "Principal / Registrar"},
                    {"name": "website", "label": "Website", "type": "url", "required": False, "placeholder": "https://institution.edu"},
                ],
            },
            {
                "id": "contact",
                "title": "Contact Information",
                "fields": [
                    {"name": "officePhone", "label": "Office Phone", "type": "tel", "required": True},
                    {"name": "mobileNumber", "label": "Mobile Number", "type": "tel", "required": True},
                ],
            },
            {
                "id": "location",
                "title": "Location",
                "fields": [
                    {"name": "country", "label": "Country", "type": "select", "required": True, "options": _COUNTRY_OPTIONS},
                    {"name": "state", "label": "State", "type": "text", "required": True},
                    {"name": "district", "label": "District", "type": "text", "required": True},
                    {"name": "city", "label": "City", "type": "text", "required": True},
                    {"name": "officeAddress", "label": "Office Address", "type": "textarea", "required": True},
                ],
            },
            _COMMON_SECTION,
        ],
    },
    "faculty": {
        "portal": "faculty",
        "portalLabel": "Faculty Portal",
        "sections": [
            {
                "id": "employment",
                "title": "Employment Details",
                "fields": [
                    {"name": "facultyId", "label": "Faculty ID", "type": "text", "required": True},
                    {"name": "department", "label": "Department", "type": "text", "required": True},
                    {"name": "designation", "label": "Designation", "type": "text", "required": True, "placeholder": "Assistant Professor"},
                    {"name": "qualification", "label": "Qualification", "type": "text", "required": True, "placeholder": "Ph.D. in Computer Science"},
                    {"name": "experience", "label": "Experience", "type": "number", "required": True, "validation": {"min": 0, "max": 60}},
                    {"name": "subjectsHandling", "label": "Subjects Handling", "type": "textarea", "required": True, "placeholder": "Data Structures, Algorithms"},
                    {"name": "officeRoomNumber", "label": "Office Room Number", "type": "text", "required": False, "placeholder": "B-204"},
                ],
            },
            {
                "id": "contact",
                "title": "Contact Information",
                "fields": [
                    {"name": "mobileNumber", "label": "Mobile Number", "type": "tel", "required": True},
                    {"name": "alternateNumber", "label": "Alternate Number", "type": "tel", "required": False},
                ],
            },
            {
                "id": "location",
                "title": "Location",
                "fields": [
                    {"name": "country", "label": "Country", "type": "select", "required": True, "options": _COUNTRY_OPTIONS},
                    {"name": "state", "label": "State", "type": "text", "required": True},
                    {"name": "district", "label": "District", "type": "text", "required": True},
                    {"name": "city", "label": "City", "type": "text", "required": True},
                ],
            },
            _COMMON_SECTION,
        ],
    },
}


@router.get("/schema")
def get_profile_schema(current_user: User = Depends(get_current_user)):
    return _SCHEMAS[_portal_for(current_user)]


@router.get("/me")
def get_my_profile(current_user: User = Depends(get_current_user), db=Depends(get_db)):
    portal = _portal_for(current_user)
    record = db["profile_data"].find_one({"user_id": current_user.id})
    return {
        "exists": record is not None,
        "portal": portal,
        "google": None,
        "values": (record or {}).get("values", {}),
    }


async def _extract_values(request: Request) -> dict:
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data"):
        return await request.json()

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    values: dict = {}
    form = await request.form()
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            if not value.filename:
                continue
            ext = os.path.splitext(value.filename)[1]
            stored_name = f"{uuid.uuid4().hex}{ext}"
            with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as f:
                f.write(await value.read())
            values[key] = f"/uploads/profile/{stored_name}"
        else:
            values[key] = value
    return values


async def _save_profile(request: Request, current_user: User, db) -> dict:
    portal = _portal_for(current_user)
    values = await _extract_values(request)
    db["profile_data"].update_one(
        {"user_id": current_user.id},
        {"$set": {"user_id": current_user.id, "portal": portal, "values": values}},
        upsert=True,
    )
    return {"exists": True, "portal": portal, "google": None, "values": values}


@router.post("")
async def create_profile(request: Request, current_user: User = Depends(get_current_user), db=Depends(get_db)):
    return await _save_profile(request, current_user, db)


@router.put("")
async def update_profile(request: Request, current_user: User = Depends(get_current_user), db=Depends(get_db)):
    return await _save_profile(request, current_user, db)
