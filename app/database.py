from app.mongodb_sync import get_sync_mongo_db

def get_db():
    yield from get_sync_mongo_db()

from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass
