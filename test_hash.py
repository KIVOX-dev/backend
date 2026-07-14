from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
db_hash = "$2b$12$mIhIzDsCOwOvH2OY0EU7yeuZiGGzsUrwagW4T3tylegbqNmCwDpS6"
print("Matches admin123?", pwd_context.verify("admin123", db_hash))
