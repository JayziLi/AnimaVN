"""出图后端:NovelAI 一次画一张、分段用时、报错原文(不联网,发请求那一层换成假的)"""

import asyncio
import io
import zipfile

import httpx
import pytest

from app.plugins.imagegen import nai
from app.plugins.imagegen.backends import novelai
from app.plugins.imagegen.backends.base import BackendError, Conn

CONN = Conn(id="c1", name="NovelAI", kind="novelai", base_url=None, api_key="pst-x")


def zipped_png() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("image_0.png", b"PNGDATA")
    return buf.getvalue()


def test_novelai_draws_one_at_a_time_and_says_when_its_turn_comes(monkeypatch):
    # 同一个账号同时只能画一张(多发回 429):后面的排队,轮到时调 on_start
    order = []

    async def fake_send(method, path, token, body=None, timeout=120.0, host=nai.HOST):
        order.append("start")
        await asyncio.sleep(0.1)
        order.append("end")
        return httpx.Response(200, content=zipped_png())

    monkeypatch.setattr(nai, "_send", fake_send)
    # 换一把新锁:锁一旦在别的事件循环里被争用过,换个循环再用会报错
    monkeypatch.setattr(nai, "_lock", asyncio.Lock())

    async def main():
        return await asyncio.gather(
            nai.generate("pst-x", {}, on_start=lambda: order.append("turn")),
            nai.generate("pst-x", {}, on_start=lambda: order.append("turn")),
        )

    assert asyncio.run(main()) == [b"PNGDATA"] * 2
    assert order == ["turn", "start", "end", "turn", "start", "end"]


def test_the_novelai_backend_reports_queue_and_draw_time(monkeypatch):
    async def fake_generate(token, body, tries=3, wait=2.0, host=nai.HOST, on_start=None):
        assert token == "pst-x" and host == nai.HOST
        await asyncio.sleep(0.1)  # 排队
        on_start()
        await asyncio.sleep(0.2)  # 画
        return b"PNG"

    monkeypatch.setattr(nai, "generate", fake_generate)
    r = asyncio.run(novelai.draw(CONN, {"parameters": {"seed": 1}}))
    assert r.data == b"PNG" and r.mime == "image/png" and r.sent == {"seed": 1}
    assert r.timing.queue_ms >= 70 and r.timing.draw_ms >= 170
    assert set(r.timing.as_dict()) == {"queue", "draw", "fetch"}


def test_a_novelai_relay_address_is_used_when_set(monkeypatch):
    seen = {}

    async def fake_generate(token, body, tries=3, wait=2.0, host=nai.HOST, on_start=None):
        seen["host"] = host
        return b"PNG"

    monkeypatch.setattr(nai, "generate", fake_generate)
    relay = Conn(id="c2", name="NAI 中转", kind="novelai", base_url="https://nai-relay.example", api_key="k")
    asyncio.run(novelai.draw(relay, {}))
    assert seen["host"] == "https://nai-relay.example"


def test_errors_keep_novelais_text(monkeypatch):
    async def boom(*args, **kwargs):
        raise nai.NaiError(401, "NovelAI token 无效或过期了,到插件页重新填")

    monkeypatch.setattr(nai, "generate", boom)
    with pytest.raises(BackendError) as e:
        asyncio.run(novelai.draw(CONN, {}))
    assert e.value.status == 502 and "token" in e.value.message


def test_check_reads_the_subscription(monkeypatch):
    async def account(token, host=nai.HOST):
        return {"tier": 3, "active": True, "anlas": 1200, "v5_percent": 80, "v5_next_percent_s": 0}

    monkeypatch.setattr(nai, "account", account)
    assert asyncio.run(novelai.check(CONN)) == "Opus · Anlas 1200"
