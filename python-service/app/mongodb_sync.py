import os
from pymongo import MongoClient
import certifi
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGODB_URI")
MONGO_DB_NAME = os.getenv("MONGODB_DB_NAME", "skillovate")

# Synchronous client for dropping into existing synchronous routes
client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
mongo_db = client[MONGO_DB_NAME]

def get_sync_mongo_db():
    try:
        yield mongo_db
    finally:
        pass
