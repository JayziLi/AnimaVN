"""/api/annotate:Jev 标注的接口、key 的存取。Jev 用假的(httpx.MockTransport)。"""

import asyncio
import json
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.annotate import client as jev_client
from app.annotate import judge
from app.config import settings


class FakeJev:
    """假装是 api.typesafe.ai。answers 是要回的答案;reply 设成 httpx.Response 就原样回它,设成异常就抛出"""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.answers: dict = {}
        self.reply: httpx.Response | Exception | None = None
        # 第 n 个 POST 先等这么多秒再回(模拟 Jev 偶尔很慢)
        self.delays: list[float] = []

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "POST" and self.delays:
            await asyncio.sleep(self.delays.pop(0))
        if isinstance(self.reply, Exception):
            raise self.reply
        if self.reply is not None:
            return self.reply
        if request.url.path != "/v1/systemone":
            return httpx.Response(404, json={"error": "not found"})
        body = json.loads(request.content)
        answers = {k: v for k, v in self.answers.items() if k in body["questions"]}
        return httpx.Response(
            200, json={"model": "jev-1.13.0", "answers": answers, "usage": {"input_tokens": 1234}}
        )

    def bodies(self) -> list[dict]:
        return [json.loads(r.content) for r in self.requests if r.method == "POST"]


@pytest.fixture
def jev(monkeypatch) -> Iterator[FakeJev]:
    fake = FakeJev()
    monkeypatch.setattr(
        jev_client, "make_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    )
    monkeypatch.setattr(settings, "jev_api_key", None)
    jev_client.reset()
    yield fake
    jev_client.reset()


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setattr(settings, "jev_api_key", "test-key")


PAYLOAD = {
    "char": "星绘",
    "user": "Lj",
    "prev": "——去食堂",
    "lines": [
        {"text": "两人走进了食堂。", "speaker": None},
        {"text": "「哇,今天有咖喱!」", "speaker": "星绘"},
        {"text": "「小心烫。」", "speaker": "店员"},
    ],
    "targets": [0, 1],
    "emotions": [{"label": "微笑", "aliases": ["开心"], "description": "心情不错"}, {"label": "害羞"}],
    "bgs": [{"label": "教室"}, {"label": "食堂", "description": "学校食堂"}],
    "bgms": [{"label": "日常"}, {"label": "紧张"}],
    "scene": {"bg": "教室", "bgm": "日常"},
}


def key_status(client: TestClient) -> dict:
    """状态接口里 key 的那两项(还有地址、模型名,另有测试)"""
    body = client.get("/api/annotate/status").json()
    return {"has_key": body["has_key"], "source": body["source"]}


def choice(c, conf=0.9):
    return {"type": "choice", "choice": c, "confidence": conf, "probabilities": {c: conf}}


def test_annotate_needs_a_key(client: TestClient, jev):
    r = client.post("/api/annotate/lines", json=PAYLOAD)
    assert r.status_code == 503
    assert "key" in r.json()["detail"]
    assert jev.requests == []


def test_annotate_returns_one_decision_per_target(client: TestClient, jev, with_key):
    jev.answers = {
        "bg1": choice("食堂", 0.95),
        "bgm1": choice("不换"),
        "s2": choice("char", 0.97),
        "e2": choice("微笑", 0.6),
    }
    r = client.post("/api/annotate/lines", json=PAYLOAD)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lines"] == [
        {"index": 0, "speaker": None, "emotion": None, "bg": "食堂", "bgm": None, "cg": None, "cg_off": False,
         "tone": None, "confidence": {"bg": 0.95}},
        {"index": 1, "speaker": "char", "emotion": "微笑", "bg": None, "bgm": None, "cg": None, "cg_off": False,
         "tone": None, "confidence": {"speaker": 0.97, "emotion": 0.6}},
    ]
    assert body["tokens"] == 1234
    assert body["ms"] >= 0

    (req,) = [r for r in jev.requests if r.method == "POST"]
    assert req.headers["authorization"] == "Bearer test-key"
    sent = json.loads(req.content)
    assert sent["model"] == "jev-latest"
    assert set(sent["questions"]) == {"bg1", "bgm1", "s2", "e2"}
    assert [x["内容"] for x in sent["state"]["本条回复"]] == ["两人走进了食堂。", "「哇,今天有咖喱!」"]


def test_annotate_follows_the_modes_thresholds_and_edited_prompts(client: TestClient, jev, with_key):
    jev.answers = {"bg1": choice("食堂", 0.7), "s2": choice("user", 0.85)}
    r = client.post(
        "/api/annotate/lines",
        json={
            **PAYLOAD,
            # 只有背景和玩家台词是 Jev:不带表情、音乐
            "emotions": [],
            "bgms": [],
            "thresholds": {"speaker": 0.9, "bg": 0.65},
            "prompts": {"speaker": "第 {{n}} 句是谁说的?", "bg_keep": "  "},
        },
    )
    assert r.status_code == 200, r.text
    lines = r.json()["lines"]
    assert lines[0]["bg"] == "食堂"
    # 0.85 < 0.9:还算角色的
    assert lines[1]["speaker"] == "char"
    sent = jev.bodies()[-1]["questions"]
    assert set(sent) == {"bg1", "s2"}
    assert sent["s2"]["instructions"] == "第 2 句是谁说的?"
    # 只有空白的当没改
    assert sent["bg1"]["criteria"]["不换"].startswith("还在「教室」")

    no_speaker = client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1], "ask_speaker": False})
    assert set(jev.bodies()[-1]["questions"]) == {"e2"}
    assert no_speaker.json()["lines"][0]["speaker"] is None


def test_annotate_asks_the_registered_tone_only_when_told(client: TestClient, jev, with_key, monkeypatch):
    # 「这句的档」题由卡带登记;这里登记一道中性的假题(真的在声线卡带里)
    monkeypatch.setattr(judge, "_tone", judge.TwoLevel("高", "低", 0.3, "lv", "lv_hi", "lv_lo"))
    for key in ("lv", "lv_hi", "lv_lo"):
        monkeypatch.setitem(judge.DEFAULT_PROMPTS, key, key)
    jev.answers = {"s2": choice("char", 0.97), "e2": choice("害羞", 0.8), "t2": choice("高", 0.7)}
    payload = {**PAYLOAD, "targets": [1], "ask_tone": True, "prompts": {"lv": "改过的"}}
    r = client.post("/api/annotate/lines", json=payload)
    assert r.status_code == 200, r.text
    (line,) = r.json()["lines"]
    assert (line["emotion"], line["tone"]) == ("害羞", "高")
    assert line["confidence"]["tone"] == 0.7
    sent = jev.bodies()[-1]["questions"]
    assert set(sent) == {"s2", "e2", "t2"}
    assert sent["t2"]["instructions"] == "改过的"
    assert set(sent["t2"]["criteria"]) == {"高", "低"}

    plain = client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    assert set(jev.bodies()[-1]["questions"]) == {"s2", "e2"}
    assert plain.json()["lines"][0]["tone"] is None


def test_a_slow_answer_is_raced_by_a_second_request(client: TestClient, jev, with_key, monkeypatch):
    monkeypatch.setattr(jev_client, "HEDGE_AFTER", 0.05)
    jev.answers = {"s2": choice("char"), "e2": choice("害羞")}
    jev.delays = [2.0, 0.0]
    r = client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    assert r.status_code == 200, r.text
    assert r.json()["lines"][0]["emotion"] == "害羞"
    assert r.json()["ms"] < 1500
    assert len(jev.bodies()) == 2
    assert jev.bodies()[0] == jev.bodies()[1]


def test_a_fast_answer_is_not_sent_twice(client: TestClient, jev, with_key, monkeypatch):
    monkeypatch.setattr(jev_client, "HEDGE_AFTER", 0.5)
    jev.answers = {"s2": choice("char"), "e2": choice("害羞")}
    assert client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]}).status_code == 200
    assert len(jev.bodies()) == 1


def test_annotate_does_not_call_jev_when_nothing_is_asked(client: TestClient, jev, with_key):
    r = client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [2]})
    assert r.status_code == 200, r.text
    assert r.json()["lines"] == [
        {"index": 2, "speaker": None, "emotion": None, "bg": None, "bgm": None, "cg": None, "cg_off": False,
         "tone": None, "confidence": {}}
    ]
    assert r.json()["tokens"] == 0
    assert jev.requests == []


@pytest.mark.parametrize(
    ("reply", "status", "words"),
    [
        (httpx.Response(401, json={"error": "invalid key"}), 502, "key"),
        (httpx.Response(429, json={"error": "rate limited"}), 502, "429"),
        (httpx.Response(500, text="boom"), 502, "500"),
        (httpx.ReadTimeout("slow"), 504, "超时"),
        (httpx.ConnectError("refused"), 502, "连不上"),
    ],
)
def test_annotate_explains_jev_failures(client: TestClient, jev, with_key, reply, status, words):
    jev.reply = reply
    r = client.post("/api/annotate/lines", json=PAYLOAD)
    assert r.status_code == status
    assert words in r.json()["detail"]


@pytest.mark.parametrize(
    "change",
    [
        {"targets": []},
        {"targets": [3]},
        {"targets": [-1]},
        {"targets": list(range(17))},
        {"lines": []},
        {"char": ""},
        {"emotions": [{"label": "长" * 41}]},
        {"thresholds": {"bg": 0.2}},
        {"thresholds": {"speaker": 1.0}},
        {"prompts": {"unknown": "x"}},
        {"prompts": {"bg": "长" * 501}},
    ],
)
def test_annotate_validates_payload(client: TestClient, jev, with_key, change):
    assert client.post("/api/annotate/lines", json={**PAYLOAD, **change}).status_code == 422


def test_defaults_come_from_the_backend(client: TestClient):
    body = client.get("/api/annotate/defaults").json()
    assert body["keep"] == "不换"
    assert body["thresholds"] == {"speaker": 0.8, "bg": 0.6, "bgm": 0.6, "cg": 0.6}
    assert body["cg_off"] == "不显示CG"
    # 内核的问法,加上卡带登记的(公开版没有卡带)
    assert set(body["prompts"]) >= {
        "state", "speaker", "speaker_char", "speaker_user", "speaker_other", "speaker_none",
        "emotion", "bg", "bg_keep", "bgm", "bgm_keep", "cg", "cg_keep", "cg_off",
    }
    assert set(body["prompts"]) == set(judge.DEFAULT_PROMPTS)


def test_unknown_prompt_keys_are_rejected(client: TestClient, jev, with_key):
    r = client.post("/api/annotate/lines", json={**PAYLOAD, "prompts": {"no_such_prompt": "x"}})
    assert r.status_code == 422


def test_key_test_asks_jev_one_small_question(client: TestClient, jev):
    assert client.post("/api/annotate/test").status_code == 503
    client.put("/api/annotate/key", json={"key": "k"})
    ok = client.post("/api/annotate/test")
    assert ok.status_code == 200, ok.text
    assert ok.json()["ms"] >= 0
    assert len(jev.bodies()) == 1
    jev.reply = httpx.Response(401, json={"error": "invalid key"})
    bad = client.post("/api/annotate/test")
    assert bad.status_code == 502
    assert "key" in bad.json()["detail"]


def test_key_can_be_set_from_the_page_but_never_read_back(client: TestClient, jev):
    assert key_status(client) == {"has_key": False, "source": None}

    assert client.put("/api/annotate/key", json={"key": " sk-jev "}).status_code == 204
    assert key_status(client) == {"has_key": True, "source": "settings"}
    # 通用的设置接口读不到、也写不了
    assert client.get("/api/settings/secret.jev_key").status_code == 400
    assert client.put("/api/settings/secret.jev_key", json={"value": "x"}).status_code == 400

    jev.answers = {"s2": choice("char"), "e2": choice("害羞")}
    assert client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]}).status_code == 200
    assert jev.requests[-1].headers["authorization"] == "Bearer sk-jev"

    assert client.put("/api/annotate/key", json={"key": ""}).status_code == 204
    assert key_status(client) == {"has_key": False, "source": None}


def test_key_from_the_environment_wins(client: TestClient, jev, with_key):
    client.put("/api/annotate/key", json={"key": "from-page"})
    assert key_status(client) == {"has_key": True, "source": "env"}


def test_warmup_opens_a_connection_only_with_a_key(client: TestClient, jev):
    assert client.post("/api/annotate/warmup").status_code == 204
    assert jev.requests == []
    client.put("/api/annotate/key", json={"key": "k"})
    assert client.post("/api/annotate/warmup").status_code == 204
    assert [r.method for r in jev.requests] == ["GET"]
    # 连不上也不报错:预热只是顺手
    jev.reply = httpx.ConnectError("down")
    assert client.post("/api/annotate/warmup").status_code == 204


def test_long_descriptions_and_names_are_clipped_not_rejected(client: TestClient, jev, with_key):
    # 库里的描述、别名个数、卡名都没有上限:写得细一点的 CG 描述、一条长回复不能让整批标注 422
    jev.answers = {"bg1": choice("食堂", 0.95), "bgm1": choice("不换"), "s2": choice("char"), "e2": choice("微笑")}
    payload = {
        **PAYLOAD,
        "char": "星" * 120,
        "prev": "长" * 9000,
        "emotions": [
            {"label": "微笑", "aliases": [f"别名{i}" for i in range(30)], "description": "细" * 500},
            {"label": "害羞"},
        ],
        "scene": {"bg": "教室", "bgm": "日常", "place": "教室:" + "描" * 600},
    }
    r = client.post("/api/annotate/lines", json=payload)
    assert r.status_code == 200, r.text


def test_a_blank_character_name_is_still_rejected(client: TestClient, jev, with_key):
    assert client.post("/api/annotate/lines", json={**PAYLOAD, "char": "   "}).status_code == 422
    jev.answers = {"bg1": choice("食堂", 0.95), "bgm1": choice("不换"), "s2": choice("char"), "e2": choice("微笑")}
    r = client.post("/api/annotate/lines", json={**PAYLOAD, "char": " " * 79 + "星绘"})
    assert r.status_code == 200, r.text


# ---- 带上一条回复(specs/2026-10-16-jev-page-and-previous-reply.md 第四节) ----


def test_the_previous_reply_goes_in_before_the_players_line(client: TestClient, jev, with_key):
    jev.answers = {"s2": choice("char"), "e2": choice("害羞")}
    before = [{"text": "她把伞收了起来。", "speaker": None}, {"text": "「明天见。」", "speaker": "星绘"}]
    r = client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1], "before": before})
    assert r.status_code == 200, r.text
    state = jev.bodies()[-1]["state"]
    assert list(state)[:4] == ["说明", "上一条回复的最后几句", "玩家上一句", "本条回复"]
    assert state["说明"].endswith(judge.DEFAULT_PROMPTS["before"])
    assert state["上一条回复的最后几句"] == [
        {"类型": "旁白", "内容": "她把伞收了起来。"},
        {"类型": "引号里的话", "内容": "「明天见。」"},
    ]


def test_without_the_previous_reply_the_request_is_as_before(client: TestClient, jev, with_key):
    jev.answers = {"s2": choice("char"), "e2": choice("害羞")}
    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1], "before": []})
    a, b = jev.bodies()
    assert a == b
    assert "上一条回复的最后几句" not in a["state"]
    assert judge.DEFAULT_PROMPTS["before"] not in a["state"]["说明"]


def test_the_previous_reply_keeps_its_last_lines_and_long_ones_are_clipped(client: TestClient, jev, with_key):
    jev.answers = {"s2": choice("char")}
    before = [{"text": f"第{i}句。", "speaker": None} for i in range(30)]
    before[-1] = {"text": "长" * 3000, "speaker": None}
    r = client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1], "before": before})
    assert r.status_code == 200, r.text
    sent = jev.bodies()[-1]["state"]["上一条回复的最后几句"]
    assert len(sent) == 24
    assert sent[0]["内容"] == "第6句。"
    assert len(sent[-1]["内容"]) == 2000


def test_the_previous_reply_note_can_be_edited(client: TestClient, jev, with_key):
    jev.answers = {"s2": choice("char")}
    r = client.post(
        "/api/annotate/lines",
        json={**PAYLOAD, "targets": [1], "before": [{"text": "前情。"}], "prompts": {"before": "改过的前情说明。"}},
    )
    assert r.status_code == 200, r.text
    assert jev.bodies()[-1]["state"]["说明"].endswith("改过的前情说明。")


# ---- 地址、模型名(走中转) ----

RELAY = "https://relay.example.com/v1/systemone"


def test_the_endpoint_defaults_to_the_official_one(client: TestClient):
    body = client.get("/api/annotate/status").json()
    assert body["url"] == body["default_url"] == "https://api.typesafe.ai/v1/systemone"
    assert body["model"] == body["default_model"] == "jev-latest"
    assert body["url_source"] == body["model_source"] == "default"


def test_a_relay_address_and_model_name_are_used(client: TestClient, jev, with_key):
    assert client.put("/api/annotate/endpoint", json={"url": f" {RELAY} ", "model": "typesafe/jev"}).status_code == 204
    body = client.get("/api/annotate/status").json()
    assert (body["url"], body["model"], body["url_source"], body["model_source"]) == (
        RELAY, "typesafe/jev", "settings", "settings")

    jev.answers = {"s2": choice("char")}
    assert client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]}).status_code == 200
    req = [r for r in jev.requests if r.method == "POST"][-1]
    assert str(req.url) == RELAY
    assert json.loads(req.content)["model"] == "typesafe/jev"
    assert client.post("/api/annotate/test").status_code == 200
    assert str([r for r in jev.requests if r.method == "POST"][-1].url) == RELAY
    client.post("/api/annotate/warmup")
    assert str(jev.requests[-1].url) == "https://relay.example.com/"

    # 空串 = 回到官方的
    assert client.put("/api/annotate/endpoint", json={"url": "", "model": ""}).status_code == 204
    body = client.get("/api/annotate/status").json()
    assert (body["url"], body["model"], body["url_source"]) == (body["default_url"], "jev-latest", "default")


def test_a_bad_address_is_rejected(client: TestClient):
    r = client.put("/api/annotate/endpoint", json={"url": "relay.example.com", "model": ""})
    assert r.status_code == 422
    assert "http" in r.json()["detail"]


def test_the_environment_address_wins(client: TestClient, jev, with_key, monkeypatch):
    monkeypatch.setattr(settings, "jev_base_url", "https://env.example.com/v1/systemone")
    client.put("/api/annotate/endpoint", json={"url": RELAY, "model": ""})
    body = client.get("/api/annotate/status").json()
    assert (body["url"], body["url_source"]) == ("https://env.example.com/v1/systemone", "env")


# ---- 用量(只数 token) ----


@pytest.fixture
def day(monkeypatch):
    from datetime import date

    from app.annotate import usage

    now = {"d": date(2026, 10, 16)}
    monkeypatch.setattr(usage, "today", lambda: now["d"])
    return now


def test_usage_counts_every_call_per_day(client: TestClient, jev, with_key, day):
    from datetime import date

    jev.answers = {"s2": choice("char")}
    empty = {"requests": 0, "tokens": 0}
    assert client.get("/api/annotate/usage").json() == {"today": empty, "week": empty, "month": empty, "all": empty}

    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    client.post("/api/annotate/test")
    # 没问 Jev 的不算
    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [2]})
    u = client.get("/api/annotate/usage").json()
    assert u["today"] == u["all"] == {"requests": 3, "tokens": 3 * 1234}

    day["d"] = date(2026, 10, 30)
    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    day["d"] = date(2026, 11, 2)
    client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]})
    u = client.get("/api/annotate/usage").json()
    assert u["today"] == {"requests": 1, "tokens": 1234}
    # 这 7 天:10-27 到 11-02
    assert u["week"] == {"requests": 2, "tokens": 2 * 1234}
    assert u["month"] == {"requests": 1, "tokens": 1234}
    assert u["all"] == {"requests": 5, "tokens": 5 * 1234}


def test_a_raced_request_counts_twice(client: TestClient, jev, with_key, day, monkeypatch):
    monkeypatch.setattr(jev_client, "HEDGE_AFTER", 0.05)
    jev.answers = {"s2": choice("char")}
    jev.delays = [2.0, 0.0]
    assert client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]}).status_code == 200
    assert client.get("/api/annotate/usage").json()["today"] == {"requests": 2, "tokens": 2 * 1234}


def test_failed_calls_are_not_counted(client: TestClient, jev, with_key, day):
    jev.reply = httpx.Response(401, json={"error": "invalid key"})
    assert client.post("/api/annotate/lines", json={**PAYLOAD, "targets": [1]}).status_code == 502
    assert client.get("/api/annotate/usage").json()["today"] == {"requests": 0, "tokens": 0}

