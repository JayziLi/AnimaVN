"""和 Jev 说话:进程里一个常驻的 httpx 客户端,连接复用。

每次新建连接都要重新握手:实测一句的判断新连接要 0.54 秒(p50),复用连接 0.16 秒。
所以客户端只建一次;玩家发消息时前端先叫一声 warmup,LLM 还在想的时候把连接连好。

key 先看环境变量 JEV_API_KEY(部署时用),没有就用插件页里填的(存在 app_settings 的
secret.jev_key,通用的设置接口读不到它)。
"""

import asyncio
import time

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting
from app.tts.http import _ssl_context

JEV_URL = "https://api.typesafe.ai/v1/systemone"
JEV_ORIGIN = "https://api.typesafe.ai/"
MODEL = "jev-latest"
KEY_SETTING = "secret.jev_key"
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


def _error(e: BaseException | None, r: httpx.Response | None) -> JevError:
    if isinstance(e, httpx.TimeoutException):
        return JevError(504, f"Jev 判断超时({TIMEOUT:.0f} 秒没回)")
    if e is not None:
        return JevError(502, f"连不上 Jev(api.typesafe.ai):{e}")
    assert r is not None
    if r.status_code == 401:
        return JevError(502, "Jev 不认这个 key(401),去插件页重新填")
    return JevError(502, f"Jev 返回 HTTP {r.status_code}:{r.text[:200]}")


async def ask(key: str, state: dict, questions: dict) -> tuple[dict, int, int]:
    """发一次判断,返回 (answers, 输入 token 数, 毫秒)。失败抛 JevError。

    过了 HEDGE_AFTER 秒还没回就再发一份一样的,先回来的算数:实测 2464 次里有 1.5% 超过
    1.5 秒、最慢 28 秒,重发的那份通常 0.2 秒就回来。只有慢的那些多花一次钱
    """
    body = {"model": MODEL, "state": state, "questions": questions}
    headers = {"Authorization": f"Bearer {key}"}
    started = time.perf_counter()
    first = asyncio.create_task(_shared().post(JEV_URL, json=body, headers=headers))
    pending: set[asyncio.Task] = {first}
    done, _ = await asyncio.wait(pending, timeout=HEDGE_AFTER)
    if not done:
        pending.add(asyncio.create_task(_shared().post(JEV_URL, json=body, headers=headers)))
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
                    return answers, tokens, ms
                failure = (e, r)
    finally:
        for task in pending:
            task.cancel()
    raise _error(*failure)


async def warmup() -> None:
    """先把连接连上(GET 首页,回 404 也算连上了)。连不上不报错"""
    try:
        await _shared().get(JEV_ORIGIN)
    except httpx.HTTPError:
        pass
