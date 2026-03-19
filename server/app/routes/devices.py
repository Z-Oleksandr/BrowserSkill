import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import generate_api_key
from app.database import get_db
from app.models import Device
from app.schemas import DeviceRegisterRequest, DeviceRegisterResponse

router = APIRouter(prefix="/api/devices", tags=["devices"])
limiter = Limiter(key_func=get_remote_address)

REGISTRATION_SECRET = os.getenv("REGISTRATION_SECRET", "")


@router.post("/register", response_model=DeviceRegisterResponse)
@limiter.limit("3/minute")
async def register_device(
    request: Request,
    req: DeviceRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    if not REGISTRATION_SECRET:
        raise HTTPException(status_code=503, detail="Registration not configured")
    if not secrets.compare_digest(req.secret, REGISTRATION_SECRET):
        raise HTTPException(status_code=403, detail="Invalid registration secret")

    device = Device(name=req.name, api_key=generate_api_key())
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device
