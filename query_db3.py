from app.database import SessionLocal
from app.models.college import College

db = SessionLocal()
colleges = db.query(College).all()
for c in colleges:
    print(f"ID: {c.id}, Name: {c.name}, Active: {c.is_active}")
