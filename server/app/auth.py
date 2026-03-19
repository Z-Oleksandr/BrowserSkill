import logging
import secrets

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device

logger = logging.getLogger("browserskill.auth")


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)


async def get_current_device(
    request: Request,
    x_api_key: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> Device:
    result = await db.execute(select(Device).where(Device.api_key == x_api_key))
    device = result.scalar_one_or_none()
    if device is None:
        client_ip = request.client.host if request.client else "-"
        key_prefix = x_api_key[:8] if len(x_api_key) >= 8 else x_api_key
        logger.warning("AUTH FAIL from %s key_prefix=%s...", client_ip, key_prefix)
        raise HTTPException(status_code=401, detail="Invalid API key")
    return device


async def require_auth(device: Device = Depends(get_current_device)) -> None:
    """Dependency that enforces authentication without exposing the Device object."""
    pass
