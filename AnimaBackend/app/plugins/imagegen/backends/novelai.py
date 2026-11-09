"""NovelAI 后端:包一层 nai.py。请求体还是 api.py 照老规矩拼(nai.build_body),老卡画出来逐字节不变;
这里只管用哪个地址、排队用时、错误原文"""

from __future__ import annotations

import time

from app.plugins.imagegen import nai
from app.plugins.imagegen.backends.base import BackendError, Conn, Result, Timing

TIERS = {0: "Paper", 1: "Tablet", 2: "Scroll", 3: "Opus"}


def _host(conn: Conn) -> str:
    return conn.base_url or nai.HOST


async def draw(conn: Conn, body: dict) -> Result:
    """画一张。queue = 等前面那张画完;NovelAI 回的是整个压缩包,传回算在 draw 里"""
    asked = time.perf_counter()
    began: list[float] = []
    try:
        png = await nai.generate(conn.api_key, body, host=_host(conn), on_start=lambda: began.append(time.perf_counter()))
    except nai.NaiError as e:
        raise BackendError(502, e.message) from e
    done = time.perf_counter()
    start = began[0] if began else asked
    timing = Timing(queue_ms=round((start - asked) * 1000), draw_ms=round((done - start) * 1000))
    return Result(data=png, mime="image/png", timing=timing, sent=body.get("parameters") or {})


async def check(conn: Conn) -> str:
    """查连接(不花钱):订阅档位、Anlas"""
    try:
        a = await nai.account(conn.api_key, host=_host(conn))
    except nai.NaiError as e:
        raise BackendError(502, e.message) from e
    tier = TIERS.get(a.get("tier"), f"档位 {a.get('tier')}")
    if not a.get("active"):
        tier += "(没有在订阅)"
    return f"{tier} · Anlas {a.get('anlas', 0)}"


async def options(conn: Conn) -> dict:
    """模型和采样器是固定的那几个"""
    return {"models": list(nai.MODELS), "samplers": list(nai.SAMPLERS)}
