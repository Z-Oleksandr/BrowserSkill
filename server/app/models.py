from datetime import datetime

from sqlalchemy import Boolean, DateTime, FetchedValue, ForeignKey, String, func, text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Device(Base):
    __tablename__ = "bs_devices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    api_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )


class Session(Base):
    __tablename__ = "bs_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("bs_devices.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    state_data: Mapped[str | None] = mapped_column(LONGTEXT, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        server_onupdate=FetchedValue(),
    )

    device: Mapped["Device"] = relationship(back_populates="sessions")
