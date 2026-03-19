import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)


async def get_current_device(
    x_api_key: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> Device:
    result = await db.execute(select(Device).where(Device.api_key == x_api_key))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return device
