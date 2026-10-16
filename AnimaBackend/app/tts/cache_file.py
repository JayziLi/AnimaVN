"""语音缓存放进单独的 SQLite 文件 tts-cache.db(素材架构设计 4.1、4.7,第 3 期后半)。

缓存丢了能重建,不用跟着账本备份;放在主库里时它占了几百 MB,每次备份都要多拷一遍。
TtsCache 模型不动(app/tts/cache.py 一行不改),会话按模型绑到这个文件的引擎上。
只有文件在的时候才绑:瘦身命令(python -m app.storage slim)建它、把主库里的缓存原样搬过去;
全新安装(主库里的缓存是空的)启动时直接建。所以不会出现「缓存还在主库、却去读新文件」把旧句子全当成没合成过。
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from sqlalchemy import Engine, create_engine, select, func
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.models import TtsCache

FILE_NAME = "tts-cache.db"


def cache_path(database_url: str | None = None) -> Path | None:
    """缓存文件放哪:设了 tts_cache_path 就是它;不设是主库旁边的 tts-cache.db;主库不是 SQLite 文件时没有"""
    if settings.tts_cache_path:
        return Path(settings.tts_cache_path)
    url = make_url(database_url or settings.database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        return None
    return Path(url.database).with_name(FILE_NAME)


def make_engine(path: Path) -> Engine:
    engine = create_engine(
        f"sqlite:///{path.as_posix()}", connect_args={"check_same_thread": False, "timeout": 30}
    )
    TtsCache.__table__.create(engine, checkfirst=True)
    return engine


def readonly_engine(path: Path) -> Engine:
    return create_engine(f"sqlite:///file:{quote(path.as_posix())}?mode=ro&uri=true")


def bind(factory: sessionmaker, path: Path | None = None) -> Engine | None:
    """文件在就把语音缓存绑过去,返回它的引擎;不在返回 None(照旧用主库)"""
    path = path or cache_path()
    if path is None or not path.exists():
        return None
    engine = make_engine(path)
    factory.configure(binds={TtsCache: engine})
    return engine


def bind_at_startup(factory: sessionmaker, main: Engine) -> Engine | None:
    """启动时调:文件在就绑;不在、但主库里一条缓存都没有(全新安装)就建了再绑;主库里有缓存就等瘦身命令来搬"""
    path = cache_path()
    if path is None:
        return None
    if not path.exists():
        with Session(main) as db:
            if db.scalar(select(func.count()).select_from(TtsCache)):
                return None
        path.parent.mkdir(parents=True, exist_ok=True)
        make_engine(path).dispose()
    return bind(factory, path)
