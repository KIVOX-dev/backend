class DotDict(dict):
    """dot.notation access to dictionary attributes"""
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__
    __delattr__ = dict.__delitem__

class BaseRepository:
    def __init__(self, collection_name: str, db):
        self.collection_name = collection_name
        self.db = db
        self.collection = db[collection_name]
        
    def _to_obj(self, doc):
        if not doc:
            return None
        # Convert _id to id if missing
        if "_id" in doc and "id" not in doc:
            doc["id"] = str(doc["_id"])
        return DotDict(doc)

    def _to_objs(self, docs):
        return [self._to_obj(doc) for doc in docs]
