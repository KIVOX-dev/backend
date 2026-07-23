import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import certifi
from passlib.context import CryptContext
from datetime import datetime, timezone

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

async def seed():
    client = AsyncIOMotorClient('mongodb+srv://KAVI123:KAVI123@cluster0.wdl8tpt.mongodb.net/?appName=Cluster0', tlsCAFile=certifi.where())
    db = client.skillovate
    
    email = 'admin@skillovate.com'
    password = 'admin123'
    
    admin = await db.users.find_one({'email': email})
    if not admin:
        print('Inserting admin...')
        await db.users.insert_one({
            'email': email,
            'password_hash': pwd_context.hash(password),
            'name': 'Skillovate Super Admin',
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
        await db.users.update_one({'email': email}, {'': {'password_hash': pwd_context.hash(password)}})
        print('Admin updated.')
    client.close()

if __name__ == '__main__':
    asyncio.run(seed())
