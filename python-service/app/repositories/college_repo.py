from typing import Optional
from app.repositories.base import BaseRepository, DotDict

class CollegeRepository(BaseRepository):
    def __init__(self, db):
        super().__init__("colleges", db)

    def exists(self, id: int) -> bool:
        # Check integer or string since we migrated from SQL
        return self.collection.count_documents({"id": {"$in": [id, int(id), str(id)]}}) > 0

    def get_by_name(self, name: str):
        doc = self.collection.find_one({"name": {"$regex": name, "$options": "i"}})
        return self._to_obj(doc)

    def get_by_domain(self, domain: str):
        doc = self.collection.find_one({"domain": domain.lower()})
        return self._to_obj(doc)

    def search(self, query: str, skip: int = 0, limit: int = 100):
        docs = self.collection.find({"name": {"$regex": query, "$options": "i"}}).skip(skip).limit(limit)
        return self._to_objs(docs)
