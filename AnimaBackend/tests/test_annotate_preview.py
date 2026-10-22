"""/api/annotate/preview:插件抽屉「高级 · 问法」看 Jev 实际收到的题。只拼题,不问 Jev、不记用量、不要 key。"""

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.annotate import client as jev_client
from app.config import settings


@pytest.fixture
def no_network(monkeypatch) -> Iterator[list[httpx.Request]]:
    """有人去连 Jev 就记下来(这个接口一次都不该连)"""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(500)

    monkeypatch.setattr(jev_client, "make_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(settings, "jev_api_key", None)
    jev_client.reset()
    yield seen
    jev_client.reset()


PAYLOAD = {
    "char": "刻晴",
    "user": "Lj",
    "lines": [
        {"text": "「哼,才不是特意在这里等你的。」", "speaker": "刻晴"},
        {"text": "两人走进了茶馆。", "speaker": None},
    ],
    "targets": [0, 1],
    "emotions": [{"label": "害羞", "description": "脸红,别过头"}, {"label": "生气"}],
    "bgs": [{"label": "刻晴的房间"}, {"label": "茶馆", "description": "璃月港的茶馆"}],
    "bgms": [{"label": "日常"}, {"label": "俏皮"}],
    "scene": {"bg": "刻晴的房间", "bgm": "日常"},
}


def test_preview_uses_the_edited_prompt_and_lists_the_choices(client: TestClient, no_network):
    r = client.post(
        "/api/annotate/preview",
        json={**PAYLOAD, "prompts": {"emotion": "第 {{n}} 句 {{line}} 这一刻,{{char}}是什么表情?"}},
    )
    assert r.status_code == 200, r.text
    text = r.json()["prompts"]["e1"]
    assert text.startswith("第 1 句 「哼,才不是特意在这里等你的。」 这一刻,刻晴是什么表情?")
    # 选项和发给 Jev 的一样:有说明的带说明
    assert "- 害羞:脸红,别过头" in text
    assert "- 生气" in text


def test_preview_falls_back_to_the_default_prompts(client: TestClient, no_network):
    r = client.post("/api/annotate/preview", json={**PAYLOAD, "targets": [1]})
    assert r.status_code == 200, r.text
    prompts = r.json()["prompts"]
    assert "人物在哪个场景" in prompts["bg2"]
    # 「不换」排第一,它的说明代入了现在的场景
    assert prompts["bg2"].split("选项:\n")[1].startswith("- 不换:还在「刻晴的房间」")
    assert "最适合放哪首背景音乐" in prompts["bgm2"]


def test_preview_only_builds_the_first_target(client: TestClient, no_network):
    r = client.post("/api/annotate/preview", json=PAYLOAD)
    assert r.status_code == 200, r.text
    assert set(r.json()["prompts"]) == {"s1", "e1", "bg1", "bgm1"}


def test_preview_needs_no_key_and_never_calls_jev(client: TestClient, no_network):
    r = client.post("/api/annotate/preview", json=PAYLOAD)
    assert r.status_code == 200, r.text
    assert no_network == []
    usage = client.get("/api/annotate/usage").json()
    assert usage["all"]["requests"] == 0


def test_preview_rejects_unknown_prompt_keys_like_the_real_request(client: TestClient, no_network):
    r = client.post("/api/annotate/preview", json={**PAYLOAD, "prompts": {"nope": "x"}})
    assert r.status_code == 422
