import json

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.auth import get_current_device, require_auth
from app.database import get_db
from app.models import Device, Session
from app.schemas import (
    BrowserState,
    SessionCreate,
    SessionDetail,
    SessionListItem,
    SessionUpdate,
    StateResponse,
    StatusResponse,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
limiter = Limiter(key_func=get_remote_address)


async def _get_session(session_id: int, db: AsyncSession) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("", response_model=list[SessionListItem], dependencies=[Depends(require_auth)])
@limiter.limit("30/minute")
async def list_sessions(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .options(defer(Session.state_data))
        .order_by(Session.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=SessionDetail, status_code=201)
@limiter.limit("10/minute")
async def create_session(
    request: Request,
    req: SessionCreate,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = Session(device_id=device.id, name=req.name)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionDetail, dependencies=[Depends(require_auth)])
@limiter.limit("20/minute")
async def get_session(
    request: Request,
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    return await _get_session(session_id, db)


@router.put("/{session_id}", response_model=SessionDetail)
@limiter.limit("20/minute")
async def update_session(
    request: Request,
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
        session.device_id = device.id
    elif req.is_active is False:
        session.is_active = False

    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204, dependencies=[Depends(require_auth)])
@limiter.limit("20/minute")
async def delete_session(
    request: Request,
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)
    await db.delete(session)
    await db.commit()


@router.put("/{session_id}/state", response_model=StatusResponse)
@limiter.limit("30/minute")
async def save_state(
    request: Request,
    session_id: int,
    state: BrowserState,
    device: Device = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)
    session.state_data = json.dumps(state.model_dump())
    session.device_id = device.id
    await db.commit()
    return StatusResponse(status="ok")


@router.get("/{session_id}/state", response_model=StateResponse, dependencies=[Depends(require_auth)])
@limiter.limit("30/minute")
async def load_state(
    request: Request,
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session(session_id, db)
    if session.state_data is None:
        return StateResponse(state=None)
    try:
        return StateResponse(state=json.loads(session.state_data))
    except (json.JSONDecodeError, TypeError):
        return StateResponse(state=None)
