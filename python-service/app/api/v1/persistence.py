import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.rbac import get_current_user
from app.database import get_db
from app.models.persistence import UserDataState
from app.models.user import User
from app.schemas.persistence import UserDataRequest, UserDataResponse

router = APIRouter(prefix="/userdata", tags=["User Data"])


@router.get("", response_model=UserDataResponse)
def load_user_data(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    state = db.query(UserDataState).filter(UserDataState.user_id == current_user.id).first()
    if not state:
        return UserDataResponse(data={})
    return UserDataResponse(data=json.loads(state.data_json or "{}"))


@router.post("", response_model=UserDataResponse)
def save_user_data(data: UserDataRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    state = db.query(UserDataState).filter(UserDataState.user_id == current_user.id).first()
    encoded = json.dumps(data.data)
    if state:
        state.data_json = encoded
    else:
        db.add(UserDataState(user_id=current_user.id, data_json=encoded))
    db.commit()
    return UserDataResponse(data=data.data)
