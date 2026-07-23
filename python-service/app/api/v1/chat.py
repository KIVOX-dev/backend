import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.core.websocket_manager import manager
from app.mongodb import get_mongo_db
from app.database import get_db
from app.core.security import verify_access_token
from app.core.rbac import get_current_user
from app.models.user import User

router = APIRouter(prefix="/chat", tags=["Chat"])

async def get_current_user_ws(token: str, db: Session) -> User:
    try:
        payload = verify_access_token(token)
        user_id = int(payload.get("sub"))
        user = db["users"].find_one({"id": user_id})
        if not user:
            raise ValueError("User not found")
        # create a dummy object so user.id works
        class DummyUser:
            def __init__(self, d):
                self.id = d["id"]
                self.name = d.get("name", "")
                self.role = d.get("role", "")
        return DummyUser(user)
    except Exception:
        raise ValueError("Invalid token")

@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    db: Session = Depends(get_db)
):
    try:
        user = await get_current_user_ws(token, db)
    except ValueError:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user.id)
    mongo_db = get_mongo_db()
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message_data = json.loads(data)
            except json.JSONDecodeError:
                continue
                
            receiver_id = message_data.get("receiver_id")
            content = message_data.get("content")
            
            if not receiver_id or not content:
                continue
                
            # Construct message document for MongoDB
            msg_doc = {
                "sender_id": user.id,
                "sender_name": user.name,
                "sender_role": user.role,
                "receiver_id": int(receiver_id),
                "content": content,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "read": False
            }
            
            # Save to MongoDB
            if mongo_db is not None:
                await mongo_db["messages"].insert_one(msg_doc)
                msg_doc.pop("_id", None)
            
            # Send to sender for confirmation
            await manager.send_personal_message(msg_doc, user.id)
            # Deliver to receiver in real-time
            await manager.send_personal_message(msg_doc, int(receiver_id))
            
    except WebSocketDisconnect:
        manager.disconnect(websocket, user.id)

@router.get("/history/{other_user_id}")
async def get_chat_history(
    other_user_id: int,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    """Fetch chat history between the current user and another user."""
    mongo_db = get_mongo_db()
    if mongo_db is None:
        raise HTTPException(status_code=500, detail="MongoDB not connected")
        
    cursor = mongo_db["messages"].find({
        "$or": [
            {"sender_id": current_user.id, "receiver_id": other_user_id},
            {"sender_id": other_user_id, "receiver_id": current_user.id}
        ]
    }).sort("timestamp", -1).limit(limit)
    
    messages = await cursor.to_list(length=limit)
    # MongoDB returns newest first due to sort(-1), we want chronological order for UI
    messages.reverse()
    
    for msg in messages:
        msg["_id"] = str(msg["_id"])
        
    return {"messages": messages}
