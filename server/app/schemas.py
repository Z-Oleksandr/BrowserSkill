from datetime import datetime

from pydantic import BaseModel


# --- Device ---

class DeviceRegisterRequest(BaseModel):
    name: str


class DeviceRegisterResponse(BaseModel):
    id: int
    name: str
    api_key: str


# --- Tab / Group / Window / BrowserState ---

class TabState(BaseModel):
    url: str
    title: str = ""
    pinned: bool = False
    group_id: int | None = None
    index: int = 0
    active: bool = False


class TabGroupState(BaseModel):
    local_id: int
    title: str = ""
    color: str = "grey"
    collapsed: bool = False


class WindowState(BaseModel):
    type: str = "normal"
    state: str = "normal"
    left: int = 0
    top: int = 0
    width: int = 800
    height: int = 600
    tabs: list[TabState] = []
    tab_groups: list[TabGroupState] = []


class BrowserState(BaseModel):
    captured_at: str
    window: WindowState


# --- Session ---

class SessionCreate(BaseModel):
    name: str


class SessionUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class SessionListItem(BaseModel):
    id: int
    device_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SessionDetail(SessionListItem):
    state_data: str | None = None
