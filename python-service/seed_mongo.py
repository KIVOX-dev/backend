import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import certifi
from passlib.context import CryptContext
from datetime import datetime, timezone

load_dotenv()

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

# Credentials are read from the environment only. Never hardcode a connection
# string here again — a previous version of this file had a live Atlas
# password committed in plaintext, which must be treated as compromised and
# rotated in the Atlas console regardless of this fix.
MONGODB_URI = os.environ.get('MONGODB_URI')
MONGODB_DB_NAME = os.environ.get('MONGODB_DB_NAME', 'upscaler_ai')
SUPER_ADMIN_EMAIL = os.environ.get('SUPER_ADMIN_EMAIL')
SUPER_ADMIN_PASSWORD = os.environ.get('SUPER_ADMIN_PASSWORD')

async def seed():
    if not MONGODB_URI:
        sys.exit('MONGODB_URI is not set (check your .env) — refusing to run without it.')
    if not SUPER_ADMIN_EMAIL or not SUPER_ADMIN_PASSWORD:
        sys.exit('SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD are not set (check your .env) — refusing to run without them.')

    client = AsyncIOMotorClient(MONGODB_URI, tlsCAFile=certifi.where())
    db = client[MONGODB_DB_NAME]

    email = SUPER_ADMIN_EMAIL
    password = SUPER_ADMIN_PASSWORD

    admin = await db.users.find_one({'email': email})
    if not admin:
        print('Inserting admin...')
        await db.users.insert_one({
            'email': email,
            'password_hash': pwd_context.hash(password),
            'name': 'UpScaler-AI Super Admin',
            'role': 'super_admin',
            'status': 'approved',
            'is_active': True,
            'is_email_verified': True,
            'created_at': datetime.now(timezone.utc),
            'updated_at': datetime.now(timezone.utc),
            'college_id': None,
            'department': None
        })
        print('Admin inserted.')
    else:
        print('Updating admin password...')
        await db.users.update_one({'email': email}, {'$set': {'password_hash': pwd_context.hash(password)}})
        print('Admin updated.')
    client.close()

if __name__ == '__main__':
    asyncio.run(seed())
