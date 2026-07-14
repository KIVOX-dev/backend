import asyncio
import os
from sqlalchemy import create_engine, MetaData
from motor.motor_asyncio import AsyncIOMotorClient
import certifi
from dotenv import load_dotenv

load_dotenv()

SQLITE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/skillovate.db")
MONGO_URI = os.getenv("MONGODB_URI")
MONGO_DB_NAME = os.getenv("MONGODB_DB_NAME", "skillovate")

async def sync_data():
    print("Connecting to databases...")
    
    # 1. Connect to SQLite and reflect all tables
    engine = create_engine(SQLITE_URL)
    metadata = MetaData()
    metadata.reflect(bind=engine)
    
    # 2. Connect to MongoDB securely
    mongo_client = AsyncIOMotorClient(
        MONGO_URI,
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=10000
    )
    mongo_db = mongo_client[MONGO_DB_NAME]
    
    print(f"Found {len(metadata.tables)} tables in SQLite. Syncing to MongoDB Atlas...")
    
    # 3. Loop through every table in SQLite
    with engine.connect() as conn:
        for table_name, table in metadata.tables.items():
            print(f"   -> Syncing table: {table_name}")
            
            # Fetch all rows from the SQLite table
            result = conn.execute(table.select())
            rows = result.fetchall()
            
            if not rows:
                print(f"      (Empty, skipping)")
                continue
            
            # Convert rows to a list of dictionaries
            documents = []
            for row in rows:
                doc = dict(row._mapping)
                # Convert datetime/date objects to strings for MongoDB compatibility
                for k, v in doc.items():
                    if hasattr(v, "isoformat"):
                        doc[k] = v.isoformat()
                documents.append(doc)
            
            # 4. Insert into MongoDB collection (overwrite collection completely to stay synced)
            collection = mongo_db[table_name]
            await collection.delete_many({}) # Clear old sync data
            await collection.insert_many(documents)
            print(f"      Synced {len(documents)} records to MongoDB collection '{table_name}'")

    print("\nSYNC COMPLETE! All SQLite data is now visible in MongoDB Compass.")

if __name__ == "__main__":
    asyncio.run(sync_data())
