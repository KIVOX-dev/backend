from app.database import SessionLocal
from app.models.college import College
from app.models.user import User

db = SessionLocal()

# 1. Deactivate demo college
demo = db.query(College).filter(College.id == 1).first()
if demo:
    demo.name = "Skillovate Demo College (Inactive)"
    demo.short_code = "DEMO"
    demo.is_active = False

# 2. Assign the SNS college admin to SNS college (ID 2)
sns_admin = db.query(User).filter(User.name == "SNS").first()
if sns_admin:
    sns_admin.college_id = 2

adithyen_admin = db.query(User).filter(User.name == "Adithyen").first()
if adithyen_admin:
    adithyen_admin.college_id = 2

db.commit()
print("Successfully deactivated demo college and updated admins.")
