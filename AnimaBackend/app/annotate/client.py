"""和 Jev 说话:进程里一个常驻的 httpx 客户端,连接复用。

每次新建连接都要重新握手:实测一句的判断新连接要 0.54 秒(p50),复用连接 0.16 秒。
所以客户端只建一次;玩家发消息时前端先叫一声 warmup,LLM 还在想的时候把连接连好。

key 先看环境变量 JEV_API_KEY(部署时用),没有就用 Jev 页里填的(存在 app_settings 的
secret.jev_key,通用的设置接口读不到它)。
地址和模型名同理:环境变量 JEV_BASE_URL / JEV_MODEL 优先,没有就用 Jev 页里填的(app_settings 的
jev.endpoint),再没有就用官方的。走中转的人填中转给的地址;发过去的格式不变(TypeSafe 的 systemone)。
"""

import asyncio
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting
from app.tts.http import _ssl_context

JEV_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
KEY_SETTING = "secret.jev_key"
ENDPOINT_SETTING = "jev.endpoint"
# 一句的判断通常 0.2 秒;过了这么久还没回,这句就不标了(前端照没标处理)
TIMEOUT = 8.0
# 过了这么久还没回就再发一份(见 ask)
HEDGE_AFTER = 1.0


class JevError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT,
        verify=_ssl_context(),
        limits=httpx.Limits(max_connections=16, max_keepalive_connections=8, keepalive_expiry=300),
    )


_client: httpx.AsyncClient | None = None


def _shared() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = make_client()
    return _client


def reset() -> None:
    """测试用:下次按当前的 make_client 重新建"""
    global _client
    _client = None


def key_source(db: Session) -> tuple[str | None, str | None]:
    """(key, 来源):来源是 env / settings,没有 key 时都是 None"""
    if settings.jev_api_key and settings.jev_api_key.strip():
        return settings.jev_api_key.strip(), "env"
    row = db.get(AppSetting, KEY_SETTING)
    key = row.value.strip() if row is not None and isinstance(row.value, str) else ""
    return (key, "settings") if key else (None, None)


def save_key(db: Session, key: str) -> None:
    key = key.strip()
    row = db.get(AppSetting, KEY_SETTING)
    if not key:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(AppSetting(key=KEY_SETTING, value=key))
    else:
        row.value = key
    db.commit()


@dataclass(frozen=True)
class Endpoint:
    url: str
    model: str
    # 各自从哪来:env(环境变量)/ settings(Jev 页里填的)/ default(官方的)
    url_source: str
    model_source: str


def _stored_endpoint(db: Session) -> dict:
    row = db.get(AppSetting, ENDPOINT_SETTING)
    return row.value if row is not None and isinstance(row.value, dict) else {}


def endpoint(db: Session) -> Endpoint:
    stored = _stored_endpoint(db)

    def pick(env: str | None, key: str, default: str) -> tuple[str, str]:
        if env and env.strip():
            return env.strip(), "env"
        value = stored.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip(), "settings"
        return default, "default"

    url, url_source = pick(settings.jev_base_url, "url", JEV_URL)
    model, model_source = pick(settings.jev_model, "model", MODEL)
    return Endpoint(url, model, url_source, model_source)


def check_url(url: str) -> str:
    """地址要是 http(s) 的完整地址;不对就抛 ValueError(接口回 422)"""
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("地址要以 http:// 或 https:// 开头,比如 https://api.typesafe.ai/v1/systemone")
    return url


def save_endpoint(db: Session, url: str, model: str) -> None:
    """地址、模型名;传空串 = 用官方的。两个都空就把这一行删掉"""
    value = {k: v.strip() for k, v in (("url", url), ("model", model)) if v.strip()}
    if "url" in value:
        value["url"] = check_url(value["url"])
    row = db.get(AppSetting, ENDPOINT_SETTING)
    if not value:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(AppSetting(key=ENDPOINT_SETTING, value=value))
    else:
        row.value = value
    db.commit()


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}/"


def _error(e: BaseException | None, r: httpx.Response | None, url: str) -> JevError:
    if isinstance(e, httpx.TimeoutException):
        return JevError(504, f"Jev 判断超时({TIMEOUT:.0f} 秒没回)")
    if e is not None:
        return JevError(502, f"连不上 Jev({urlsplit(url).netloc}):{e}")
    assert r is not None
    if r.status_code == 401:
        return JevError(502, "Jev 不认这个 key(401),去 Jev 页重新填")
    return JevError(502, f"Jev 返回 HTTP {r.status_code}:{r.text[:200]}")


@dataclass(frozen=True)
class Answer:
    answers: dict
    # 输入 token:先回来的那份报的
    tokens: int
    ms: int
    # 发出去了几份(1,或者重发以后 2):记用量时两份都算
    sent: int


async def ask(key: str, state, questions: dict, url: str = JEV_URL, model: str = MODEL) -> Answer:
    """发一次判断。失败抛 JevError。

    过了 HEDGE_AFTER 秒还没回就再发一份一样的,先回来的算数:实测 2464 次里有 1.5% 超过
    1.5 秒、最慢 28 秒,重发的那份通常 0.2 秒就回来。只有慢的那些多花一次钱
    """
    body = {"model": model, "state": state, "questions": questions}
    headers = {"Authorization": f"Bearer {key}"}
    started = time.perf_counter()
    first = asyncio.create_task(_shared().post(url, json=body, headers=headers))
    pending: set[asyncio.Task] = {first}
    done, _ = await asyncio.wait(pending, timeout=HEDGE_AFTER)
    if not done:
        pending.add(asyncio.create_task(_shared().post(url, json=body, headers=headers)))
    sent = len(pending)
    failure: tuple[BaseException | None, httpx.Response | None] = (None, None)
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                e = task.exception()
                r = None if e is not None else task.result()
                if r is not None and r.status_code == 200:
                    ms = round((time.perf_counter() - started) * 1000)
                    try:
                        data = r.json()
                    except ValueError:
                        data = None
                    if not isinstance(data, dict):
                        # 回了 200 但不是 JSON 对象(网关的错误页之类):当成服务出错,别 500
                        raise JevError(502, "Jev 返回的不是 JSON")
                    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
                    answers = data.get("answers") if isinstance(data.get("answers"), dict) else {}
                    try:
                        tokens = int(usage.get("input_tokens") or 0)
                    except (TypeError, ValueError):
                        tokens = 0
                    return Answer(answers, tokens, ms, sent)
                failure = (e, r)
    finally:
        for task in pending:
            task.cancel()
    raise _error(*failure, url)


async def warmup(url: str = JEV_URL) -> None:
    """先把连接连上(GET 那台主机的首页,回 404 也算连上了)。连不上不报错"""
    try:
        await _shared().get(_origin(url))
    except httpx.HTTPError:
        pass
