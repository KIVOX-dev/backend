from app.database import SessionLocal
from app.models.user import User

db = SessionLocal()
users = db.query(User).all()
for u in users:
    print(f"Name: {u.name}, Role: {u.role}, College ID: {u.college_id}")
