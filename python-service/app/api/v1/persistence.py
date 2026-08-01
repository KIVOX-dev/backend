from fastapi import APIRouter, Depends

from app.core.rbac import get_current_user
from app.database import get_db
from app.schemas.persistence import UserDataRequest, UserDataResponse

router = APIRouter(prefix="/userdata", tags=["User Data"])


@router.get("", response_model=UserDataResponse)
def load_user_data(current_user=Depends(get_current_user), db=Depends(get_db)):
    state = db["user_data_states"].find_one({"user_id": current_user.id})
    if not state:
        return UserDataResponse(data={})
    return UserDataResponse(data=state.get("data") or {})


@router.post("", response_model=UserDataResponse)
def save_user_data(
    data: UserDataRequest, current_user=Depends(get_current_user), db=Depends(get_db)
):
    db["user_data_states"].update_one(
        {"user_id": current_user.id},
        {"$set": {"user_id": current_user.id, "data": data.data}},
        upsert=True,
    )
    return UserDataResponse(data=data.data)
