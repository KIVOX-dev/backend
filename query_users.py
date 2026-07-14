from app.database import SessionLocal
from app.models.user import User

db = SessionLocal()
for u in db.query(User).all():
    print(f"ID: {u.id}, Name: {u.name}, Role: {u.role}, CollegeID: {u.college_id}")
