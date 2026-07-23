from datetime import datetime, timezone
from typing import Optional

from app.repositories.base import BaseRepository, DotDict

class UserRepository(BaseRepository):
    def __init__(self, db):
        super().__init__("users", db)

    def get_by_email(self, email: str):
        doc = self.collection.find_one({"email": email.lower()})
        return self._to_obj(doc)
        
    def get_by_id(self, user_id):
        doc = self.collection.find_one({"id": user_id})
        if not doc:
            # Fallback to int ID lookup just in case
            try:
                doc = self.collection.find_one({"id": int(user_id)})
            except:
                pass
        return self._to_obj(doc)

    def get_by_college(self, college_id: int, role: Optional[str] = None, skip: int = 0, limit: int = 100):
        query = {"college_id": int(college_id) if college_id else None}
        if role:
            query["role"] = role
        docs = self.collection.find(query).skip(skip).limit(limit)
        return self._to_objs(docs)

    def get_students_by_college(self, college_id: int, department: Optional[str] = None):
        query = {
            "college_id": int(college_id) if college_id else None,
            "role": "student",
            "is_active": True,
        }
        if department:
            query["department"] = department
        docs = self.collection.find(query)
        return self._to_objs(docs)

    def update_last_login(self, user):
        now = datetime.now(timezone.utc).isoformat()
        self.collection.update_one(
            {"id": user.id}, 
            {"$set": {"last_login_at": now}}
        )
        user.last_login_at = now
        return user

    def email_exists(self, email: str) -> bool:
        return self.collection.count_documents({"email": email.lower()}) > 0
        
    def create(self, data: dict):
        if "id" not in data:
            last_doc = self.collection.find_one(sort=[("id", -1)])
            data["id"] = (last_doc["id"] + 1) if last_doc and "id" in last_doc else 1
            data["is_active"] = True
        self.collection.insert_one(data)
        return self._to_obj(data)

    def update(self, user_id, update_data: dict):
        self.collection.update_one({"id": user_id}, {"$set": update_data})


class StudentProfileRepository(BaseRepository):
    def __init__(self, db):
        super().__init__("student_profiles", db)

    def get_by_user_id(self, user_id: int):
        doc = self.collection.find_one({"user_id": user_id})
        return self._to_obj(doc)
        
    def create(self, data: dict):
        if "id" not in data:
            last_doc = self.collection.find_one(sort=[("id", -1)])
            data["id"] = (last_doc["id"] + 1) if last_doc and "id" in last_doc else 1
        self.collection.insert_one(data)
        return self._to_obj(data)


class RefreshTokenRepository(BaseRepository):
    def __init__(self, db):
        super().__init__("refresh_tokens", db)

    def get_by_jti(self, jti: str):
        doc = self.collection.find_one({"jti": jti, "is_revoked": False})
        return self._to_obj(doc)

    def revoke_token(self, token):
        self.collection.update_one(
            {"jti": token.jti},
            {"$set": {"is_revoked": True, "revoked_at": datetime.now(timezone.utc).isoformat()}}
        )

    def revoke_all_user_tokens(self, user_id: int) -> int:
        result = self.collection.update_many(
            {"user_id": user_id, "is_revoked": False},
            {"$set": {"is_revoked": True, "revoked_at": datetime.now(timezone.utc).isoformat()}}
        )
        return result.modified_count

    def cleanup_expired(self) -> int:
        now = datetime.now(timezone.utc).isoformat()
        result = self.collection.delete_many({"expires_at": {"$lt": now}})
        return result.deleted_count
        
    def create(self, data: dict):
        if "id" not in data:
            last_doc = self.collection.find_one(sort=[("id", -1)])
            data["id"] = (last_doc["id"] + 1) if last_doc and "id" in last_doc else 1
        data["is_revoked"] = False
        self.collection.insert_one(data)
        return self._to_obj(data)
