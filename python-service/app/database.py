"""
Database access for the service.

MongoDB is the only database engine used here. `get_db` is the FastAPI
dependency every route/service takes; it yields the synchronous PyMongo
database handle (see app/mongodb_sync.py). The async Motor client in
app/mongodb.py is used for startup/shutdown and async call sites.
"""

from app.mongodb_sync import get_sync_mongo_db


def get_db():
    yield from get_sync_mongo_db()
