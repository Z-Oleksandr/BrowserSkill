from datetime import datetime

from pydantic import BaseModel, Field


# --- Device ---

class DeviceRegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    secret: str = Field(min_length=1, max_length=200)


class DeviceRegisterResponse(BaseModel):
    id: int
    name: str
    api_key: str


# --- Tab / Group / Window / BrowserState ---

class TabState(BaseModel):
    url: str = Field(max_length=2048)
    title: str = Field(default="", max_length=500)
    pinned: bool = False
    group_id: int | None = None
    index: int = 0
    active: bool = False


class TabGroupState(BaseModel):
    local_id: int
    title: str = Field(default="", max_length=200)
    color: str = Field(default="grey", max_length=20)
    collapsed: bool = False


class WindowState(BaseModel):
    type: str = Field(default="normal", max_length=20)
    state: str = Field(default="normal", max_length=20)
    left: int = 0
    top: int = 0
    width: int = 800
    height: int = 600
    tabs: list[TabState] = Field(default_factory=list, max_length=500)
    tab_groups: list[TabGroupState] = Field(default_factory=list, max_length=50)


class BrowserState(BaseModel):
    captured_at: str = Field(max_length=50)
    window: WindowState


# --- Session ---

class SessionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SessionUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
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


class StateResponse(BaseModel):
    state: dict | None = None


class StatusResponse(BaseModel):
    status: str
