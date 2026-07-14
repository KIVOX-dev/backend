import os
from sqlalchemy import create_engine, MetaData
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv(".env")

SQLITE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/skillovate.db")
MONGO_URI = os.getenv("MONGODB_URI")
MONGO_DB_NAME = "skillovate_db"

def migrate_data():
    print(f"Connecting to SQLite: {SQLITE_URL}")
    sqlite_engine = create_engine(SQLITE_URL)
    metadata = MetaData()
    metadata.reflect(bind=sqlite_engine)
    
    print(f"Connecting to MongoDB: {MONGO_URI}")
    mongo_client = MongoClient(MONGO_URI)
    mongo_db = mongo_client[MONGO_DB_NAME]
    
    # Iterate through all tables in SQLite
    for table_name in metadata.tables.keys():
        table = metadata.tables[table_name]
        print(f"Migrating table: {table_name}")
        
        # Drop the collection if it exists to start fresh
        mongo_db[table_name].drop()
        
        with sqlite_engine.connect() as conn:
            # Select all rows
            result = conn.execute(table.select()).fetchall()
            if not result:
                print(f" - Table {table_name} is empty. Skipping.")
                continue
                
            # Convert rows to dicts
            documents = []
            for row in result:
                # _mapping provides a dict-like view of the row in newer SQLAlchemy
                doc = dict(row._mapping)
                documents.append(doc)
                
            # Insert into MongoDB
            mongo_db[table_name].insert_many(documents)
            print(f" - Successfully migrated {len(documents)} records to {table_name} collection.")

    print("\nMigration completed successfully!")

if __name__ == "__main__":
    if not MONGO_URI:
        print("Error: MONGODB_URI not set in .env")
    else:
        try:
            migrate_data()
        except Exception as e:
            print(f"Migration failed: {e}")
