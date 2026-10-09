from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def without_required_nulls(model: type[Base], updates: dict) -> dict:
    """更新接口的 exclude_unset 字典里,去掉给非空列传的 null —— 当成「这项不改」。

    更新用的 schema 字段都是 Optional(只发改了的那项),显式传 null 会原样 setattr 到
    NOT NULL 的列上,提交时 IntegrityError → 500。能为空的列(头像、绑定的预设……)照常置空。
    """
    columns = model.__table__.columns
    return {k: v for k, v in updates.items() if v is not None or k not in columns or columns[k].nullable}
