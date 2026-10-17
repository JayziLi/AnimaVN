from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# anchor the sqlite file to the AnimaBackend directory, so the DB is the
# same no matter which directory uvicorn is launched from
_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # .env 也按 AnimaBackend 目录找:从仓库根目录启动 uvicorn 时,相对路径的 .env 会被悄悄忽略
    model_config = SettingsConfigDict(env_file=_BACKEND_DIR / ".env", extra="ignore")

    # only read on first startup to seed default connections; after that,
    # connections live in the DB and are managed via /api/connections
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    database_url: str = f"sqlite:///{(_BACKEND_DIR / 'data' / 'animabackend.db').as_posix()}"
    # 浏览器把 localhost 和 127.0.0.1 当成两个源,少一个就会在那个地址上
    # 被 CORS 拦成 "Failed to fetch" —— 两个都放进来。
    # 5173 是开发服务器(start.bat),5180 是打包好的游玩版(play.bat)
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5180",
        "http://127.0.0.1:5180",
    ]
    # 手机局域网联调:前端跟着地址栏连后端,源就是本机当时的局域网 IP。
    # 按私有网段放行 :5173 / :5180,换网络不用再改 IP;带出门时手机走 Tailscale,
    # 它分的 100.64.0.0/10 也放行。部署时置空关掉
    cors_origin_regex: str | None = (
        r"http://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+"
        r"|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+):(5173|5180)"
    )
    # 情绪识别模型(立绘标签的兜底匹配)。下载:python scripts/download_emotion_model.py。
    # Docker 里放 /app/models —— /app/data 是数据卷的挂载点,放进去会被盖住
    emotion_model_dir: str = str(_BACKEND_DIR / "models" / "bge-small-zh-v1.5")
    # Jev(TypeSafe 的判断模型)的 key:立绘 / 场景 / 音乐 / 说话人交给它标(app/annotate)。
    # 不设就用 Jev 页里填的那个
    jev_api_key: str | None = None
    # Jev 的地址和模型名(走中转时用);不设就用 Jev 页里填的,再没有就用官方的(app/annotate/client.py)
    jev_base_url: str | None = None
    jev_model: str | None = None
    # 数据库迁移器(app/migrations):apply = 有待升级的步骤时先备份到 data/backups/ 再升级(第 3 期起默认:
    # 文件仓库要给老表加列,不升级后端就读不了立绘);report = 启动时只检查、只报告,一个字节都不写;off = 不跑(测试用)
    migrations_mode: Literal["report", "apply", "off"] = "apply"
    # 文件仓库(app/storage,第 3 期):图、曲子(还有卡带登记的素材)按内容指纹存成文件。
    # blob_dir 不设 = 库文件旁边的 blobs/;storage_files 关掉 = 一律读库里的原件(随时能切回去)
    blob_dir: str | None = None
    storage_files: bool = True
    # 导入的暂存目录(app/importer/staging.py):不设 = 库文件旁边的 import-staging/(和 blobs/ 同级)
    import_staging_dir: str | None = None
    # 语音缓存的单独文件(第 3 期后半,app/tts/cache_file.py);不设 = 主库旁边的 tts-cache.db
    tts_cache_path: str | None = None


settings = Settings()
