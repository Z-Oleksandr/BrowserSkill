import os

from sqlalchemy import URL
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = URL.create(
    drivername="mysql+aiomysql",
    username=os.getenv("DB_USER", "serafim_main"),
    password=os.getenv("DB_PASS", ""),
    host=os.getenv("DB_HOST", "central_data_store"),
    port=int(os.getenv("DB_PORT", "3306")),
    database=os.getenv("DB_NAME", "central_data_store"),
)

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        yield session


async def init_db():
    from app.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
