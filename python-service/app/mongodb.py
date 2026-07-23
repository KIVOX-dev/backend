from motor.motor_asyncio import AsyncIOMotorClient
from app.config import get_settings
import logging

settings = get_settings()
logger = logging.getLogger(__name__)

class MongoDB:
    client: AsyncIOMotorClient = None
    db = None

db_client = MongoDB()

import certifi

async def connect_to_mongo():
    logger.info("Connecting to MongoDB...")
    db_client.client = AsyncIOMotorClient(
        settings.MONGODB_URI,
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=10000,
    )
    db_client.db = db_client.client[settings.MONGODB_DB_NAME]
    logger.info(f"Connected to MongoDB database: {settings.MONGODB_DB_NAME}")

async def close_mongo_connection():
    if db_client.client:
        db_client.client.close()
        logger.info("Closed MongoDB connection")

def get_mongo_db():
    return db_client.db
