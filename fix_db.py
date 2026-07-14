from app.database import SessionLocal
from app.models.college import College
from app.models.user import User

db = SessionLocal()

# 1. Create SNS College
sns = College(
    name="SNS College of Engineering",
    short_code="SNS",
    is_active=True
)
db.add(sns)
db.commit()
db.refresh(sns)

# 2. Assign the SNS college admin to this college
sns_admin = db.query(User).filter(User.name == "SNS").first()
if sns_admin:
    sns_admin.college_id = sns.id

adithyen_admin = db.query(User).filter(User.name == "Adithyen").first()
if adithyen_admin:
    adithyen_admin.college_id = sns.id

# 3. Delete Demo college
demo = db.query(College).filter(College.name == "Skillovate Demo College").first()
if demo:
    # reassign any users from demo to sns just in case
    demo_users = db.query(User).filter(User.college_id == demo.id).all()
    for u in demo_users:
        u.college_id = None
    db.delete(demo)

db.commit()
