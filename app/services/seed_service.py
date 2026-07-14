"""
Idempotent seed data for a usable local Skillovate V2 install.
"""
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import hash_password
from app.models.college import College, Department
from app.models.user import User


def seed_core_data(db: Session) -> None:
    settings = get_settings()

    college = db.query(College).filter(College.short_code == "SKILL").first()
    if not college:
        college = College(
            name="Skillovate Demo College",
            short_code="SKILL",
            location="India",
            address="Demo campus",
            contact_email="admin@skillovate.com",
        )
        db.add(college)
        db.flush()
        for code, name in [
            ("CSE", "Computer Science Engineering"),
            ("IT", "Information Technology"),
            ("ECE", "Electronics and Communication"),
            ("EEE", "Electrical and Electronics"),
        ]:
            db.add(Department(college_id=college.id, code=code, name=name))

    super_admin = db.query(User).filter(User.email == settings.SUPER_ADMIN_EMAIL.lower()).first()
    if not super_admin:
        db.add(
            User(
                email=settings.SUPER_ADMIN_EMAIL.lower(),
                password_hash=hash_password(settings.SUPER_ADMIN_PASSWORD),
                name="Skillovate Super Admin",
                role="super_admin",
                status="approved",
                is_active=True,
                is_email_verified=True,
            )
        )

    db.commit()
