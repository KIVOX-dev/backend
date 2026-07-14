from app.database import SessionLocal
from app.models.college import College
from app.models.user import User

db = SessionLocal()

# 1. Rename Demo College to SNS College
demo = db.query(College).filter(College.name == "Skillovate Demo College").first()
if demo:
    demo.name = "SNS College of Engineering"
    demo.short_code = "SNS"
    demo.is_active = True

# 2. Assign the SNS college admin to this college
sns_admin = db.query(User).filter(User.name == "SNS").first()
if sns_admin and demo:
    sns_admin.college_id = demo.id

adithyen_admin = db.query(User).filter(User.name == "Adithyen").first()
if adithyen_admin and demo:
    adithyen_admin.college_id = demo.id

db.commit()
print("Successfully renamed college and assigned admins.")
