import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    annotate,
    app_settings,
    blobs,
    card_prefs,
    cg_packs,
    connections,
    debug,
    debug_chats,
    emotion,
    importer,
    library,
    meta,
    pairings,
    personas,
    scenes,
    sprites,
    tavern,
    tts,
    voices,
)
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.images import prewarm
from app.importer import staging as import_staging
from app.migrations import startup as migrations_startup
from app.migrations import state as migrations_state
from app.migrations.guard import MigrationGuard
from app.plugins import load_cartridges
from app.schema_check import warn_missing_columns
from app.seed import (
    seed_default_connections,
    seed_default_persona,
    seed_default_tavern_data,
)
from app.storage.copy import start_background as start_blob_copy
from app.tts import cache_file as tts_cache_file
from app.version import app_version

# uvicorn only wires up its own loggers; without a handler here app.* INFO
# lines (e.g. prompt-cache usage per request) never reach the console
_app_log_handler = logging.StreamHandler()
_app_log_handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
logging.getLogger("app").addHandler(_app_log_handler)
logging.getLogger("app").setLevel(logging.INFO)


def _prepare(copy_blobs: bool = True) -> None:
    """建缺的表、补默认数据、预热图片缓存。copy_blobs:库已经升级到有指纹列了,才往文件仓库复制"""
    Base.metadata.create_all(bind=engine)
    warn_missing_columns(engine, Base.metadata)
    # 语音缓存在单独的文件里时绑过去(瘦身以后;全新安装直接建)
    tts_cache_file.bind_at_startup(SessionLocal, engine)
    db = SessionLocal()
    try:
        seed_default_connections(db)
        seed_default_persona(db)
        seed_default_tavern_data(db)
    finally:
        db.close()
    # 库里的图和曲子复制进文件仓库(app/storage/copy.py);没复制完的照样从库里读
    if copy_blobs and settings.storage_files:
        start_blob_copy(SessionLocal)
    # 立绘、背景先转成 WebP 存硬盘(见 app/images.py),第一次进游戏不用等
    prewarm(SessionLocal)


def _purge_import_staging() -> None:
    """清掉 7 天前的导入暂存目录(app/importer/staging.py);不碰库,出什么错都不挡启动"""
    log = logging.getLogger("app")
    try:
        n = import_staging.purge(max_age_days=7)
        if n:
            log.info("清掉了 %d 个 7 天前的导入暂存目录", n)
    except Exception:
        log.warning("清理导入暂存目录失败,先不管", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _purge_import_staging()
    # 迁移器先跑(app/migrations,第 3 期起默认先备份再自动升级)。升级失败、或者库被更新的版本升级过时,
    # 不建表、不写默认数据,原样留给备份和人工处理;接口由 MigrationGuard 挡住
    report = migrations_startup.run(app_version())
    if report.status not in ("failed", "blocked"):
        _prepare(copy_blobs=not report.of("pending"))
    yield


app = FastAPI(title="AnimaBackend API", lifespan=lifespan)

# 后加的中间件在外层:守卫先加、CORS 后加,守卫回的 503 也带着 CORS 头,前端读得到原因
app.add_middleware(MigrationGuard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_methods=["*"],
    allow_headers=["*"],
    # 开发时前端(5173)和后端(8000)不同源,不列出来前端读不到这些响应头:语音的缓存 / 情绪,
    # 导出对话时的文件名(读不到就一律存成 chat.jsonl)
    expose_headers=["X-TTS-Cache", "X-TTS-Emotion", "X-TTS-Emo-Mode", "Content-Disposition"],
)

app.include_router(connections.router)
app.include_router(personas.router)
app.include_router(debug.router)
app.include_router(debug_chats.router)
app.include_router(tavern.router)
app.include_router(sprites.router)
app.include_router(scenes.router)
app.include_router(cg_packs.router)
app.include_router(app_settings.router)
app.include_router(card_prefs.router)
app.include_router(tts.router)
app.include_router(voices.router)
app.include_router(emotion.router)
app.include_router(pairings.router)
app.include_router(annotate.router)
app.include_router(meta.router)
app.include_router(blobs.router)
app.include_router(importer.router)
app.include_router(library.router)

# 卡带(app/plugins):在的才挂它们的接口;公开版删掉了卡带,这里什么都不多挂
for cartridge in load_cartridges():
    for router in cartridge.routers:
        app.include_router(router)


@app.get("/api/health")
def health():
    report = migrations_state.current.report
    return {
        "status": "ok" if migrations_state.current.gate == "open" else "degraded",
        "version": app_version(),
        # 迁移器这次启动的结果:ok / pending(有步骤待升级,只报告的模式下)/ blocked / failed / skipped
        "db": report.status if report else "unknown",
    }
