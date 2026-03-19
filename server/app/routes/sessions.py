import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_device
from app.database import get_db
from app.models import Device, Session
from app.schemas import (
    BrowserState,
    SessionCreate,
    SessionDetail,
    SessionListItem,
    SessionUpdate,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


async def _get_session(session_id: int, db: AsyncSession) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("", response_model=list[SessionListItem])
async def list_sessions(
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).order_by(Session.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=SessionDetail, status_code=201)
async def create_session(
    req: SessionCreate,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = Session(device_id=device.id, name=req.name)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: int,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    return await _get_session(session_id, db)


@router.put("/{session_id}", response_model=SessionDetail)
async def update_session(
    session_id: int,
    req: SessionUpdate,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)

    if req.name is not None:
        session.name = req.name

    if req.is_active is True:
        # Deactivate all other sessions for THIS device
        await db.execute(
            update(Session)
            .where(Session.device_id == device.id, Session.id != session.id)
            .values(is_active=False)
        )
        session.is_active = True
    elif req.is_active is False:
        session.is_active = False

    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: int,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)
    await db.delete(session)
    await db.commit()


@router.put("/{session_id}/state")
async def save_state(
    session_id: int,
    state: BrowserState,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)
    session.state_data = json.dumps(state.model_dump())
    session.device_id = device.id
    await db.commit()
    return {"status": "ok"}


@router.get("/{session_id}/state")
async def load_state(
    session_id: int,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)
    if session.state_data is None:
        return {"state": None}
    try:
        return {"state": json.loads(session.state_data)}
    except (json.JSONDecodeError, TypeError):
        return {"state": None}
