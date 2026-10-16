"""认词记录(素材架构第 1b 期):/api/emotion/resolve、/records、/records/summary。认词模型用假 encoder。
第 1d 期加了改和删:PUT / DELETE /api/emotion/records。"""

from collections.abc import Iterator
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.emotion import use_matcher_source
from app.db import get_db
from app.emotion.matcher import EmotionMatcher
from app.main import app
from app.models import WordRecord


class FakeEncoder:
    """表里的词给固定向量;别的词(内置表情的那些名字)按字算一个,结果确定"""

    name = "fake"
    TABLE = {"嘟嘴": [0.1, 1, 0], "微笑": [0, 1, 0], "说话": [0, 0.9, 0.1], "生气": [1, 0, 0], "火大": [0.9, 0.1, 0]}

    def encode(self, texts):
        rows = [self.TABLE.get(t, [len(t), sum(map(ord, t)) % 7 + 1, 1]) for t in texts]
        a = np.array(rows, dtype=np.float32)
        return a / np.linalg.norm(a, axis=1, keepdims=True)


@pytest.fixture
def fake_model():
    app.dependency_overrides[use_matcher_source] = lambda: (lambda: EmotionMatcher(FakeEncoder()))
    yield
    app.dependency_overrides.pop(use_matcher_source, None)


@pytest.fixture
def pack(client: TestClient, make_sprite_pack):
    p = make_sprite_pack()
    base = f"/api/sprite-packs/{p['id']}/sprites"
    smile = client.post(base, json={"label": "微笑", "aliases": ["说话"]}).json()
    angry = client.post(base, json={"label": "生气"}).json()
    return {"ref": f"pack:{p['id']}", "base": base, "smile": smile["id"], "angry": angry["id"]}


def resolve(client: TestClient, ref: str, *words: str) -> dict:
    r = client.post("/api/emotion/resolve", json={"list_ref": ref, "words": list(words)})
    assert r.status_code == 200, r.text
    return r.json()


def records(client: TestClient, ref: str) -> list[dict]:
    return client.get("/api/emotion/records", params={"list_ref": ref}).json()["records"]


def test_a_new_word_is_recognized_once_and_then_read_from_the_record(client: TestClient, fake_model, pack):
    body = resolve(client, pack["ref"], " 嘟嘴 ", "火大")
    assert body["model"] == "fake"
    assert [(x["word"], x["key"], x["label"], x["how"]) for x in body["results"]] == [
        ("嘟嘴", pack["smile"], "微笑", "model"),
        ("火大", pack["angry"], "生气", "model"),
    ]
    assert [(r["word"], r["item"], r["source"], r["guessed"], r["unstable"]) for r in records(client, pack["ref"])] == [
        ("嘟嘴", pack["smile"], "model", True, False),
        ("火大", pack["angry"], "model", True, False),
    ]
    again = resolve(client, pack["ref"], "嘟嘴")
    assert again["model"] is None  # 记录里有,不用模型
    assert [(x["how"], x["source"], x["key"]) for x in again["results"]] == [("record", "model", pack["smile"])]


def test_names_and_aliases_win_and_are_not_recorded(client: TestClient, fake_model, pack):
    body = resolve(client, pack["ref"], "说话", "生气")
    assert [(x["how"], x["label"]) for x in body["results"]] == [("name", "微笑"), ("name", "生气")]
    assert body["model"] is None
    assert records(client, pack["ref"]) == []


def test_a_record_pointing_at_a_disabled_sprite_is_skipped_but_kept(client: TestClient, fake_model, pack):
    resolve(client, pack["ref"], "嘟嘴")
    assert client.put(f"{pack['base']}/{pack['smile']}", json={"enabled": False}).status_code == 200
    body = resolve(client, pack["ref"], "嘟嘴")
    assert [(x["how"], x["key"]) for x in body["results"]] == [("model", pack["angry"])]  # 只剩生气
    # 记录没改:那张图重新启用以后照旧
    assert [(r["word"], r["item"]) for r in records(client, pack["ref"])] == [("嘟嘴", pack["smile"])]


def test_the_builtin_list_and_unknown_lists(client: TestClient, fake_model):
    body = resolve(client, "builtin", "火大")
    [hit] = body["results"]
    assert hit["key"] == hit["label"]  # 内置表情的编号就是名字
    assert [r["item"] for r in records(client, "builtin")] == [hit["key"]]
    for ref in ("pack:nope", "voice:x", "什么"):
        assert client.post("/api/emotion/resolve", json={"list_ref": ref, "words": ["a"]}).status_code == 404


def test_the_model_is_needed_only_for_new_words(client: TestClient, pack):
    # 没换假模型:conftest 把模型目录指到了空文件夹
    assert client.post("/api/emotion/resolve", json={"list_ref": pack["ref"], "words": ["微笑"]}).status_code == 200
    r = client.post("/api/emotion/resolve", json={"list_ref": pack["ref"], "words": ["嘟嘴"]})
    assert r.status_code == 503
    assert "情绪识别模型没装" in r.json()["detail"]
    assert records(client, pack["ref"]) == []


def test_summary_counts_records_by_source(client: TestClient, fake_model, pack):
    assert client.get("/api/emotion/records/summary").json() == {"total": 0, "lists": 0, "by_source": {}}
    resolve(client, pack["ref"], "嘟嘴")
    resolve(client, "builtin", "火大")
    assert client.get("/api/emotion/records/summary").json() == {"total": 2, "lists": 2, "by_source": {"model": 2}}


@pytest.mark.parametrize(
    "payload",
    [
        {"list_ref": "builtin", "words": []},
        {"list_ref": "", "words": ["a"]},
        {"list_ref": "builtin", "words": ["  "]},
        {"list_ref": "builtin", "words": ["长" * 41]},
        {"list_ref": "builtin", "words": ["a"] * 51},
    ],
)
def test_resolve_validates_payload(client: TestClient, fake_model, payload):
    assert client.post("/api/emotion/resolve", json=payload).status_code == 422


# ── 改和删(第 1d 期) ──────────────────────────────


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    """和接口同一个内存库的会话"""
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    gen.close()


def put_record(client: TestClient, ref: str, word: str, item: str):
    return client.put("/api/emotion/records", json={"list_ref": ref, "word": word, "item": item})


def test_a_player_points_a_recorded_word_at_another_item(client: TestClient, fake_model, pack):
    resolve(client, pack["ref"], "嘟嘴", "火大")
    r = put_record(client, pack["ref"], " 嘟嘴 ", pack["angry"])
    assert r.status_code == 200, r.text
    assert r.json() == {
        "word": "嘟嘴",
        "item": pack["angry"],
        "source": "player",
        "guessed": False,
        "unstable": False,
        "score": None,
    }
    # 只动这一条
    assert [(x["word"], x["item"], x["source"], x["guessed"]) for x in records(client, pack["ref"])] == [
        ("嘟嘴", pack["angry"], "player", False),
        ("火大", pack["angry"], "model", True),
    ]
    again = resolve(client, pack["ref"], "嘟嘴")
    assert [(x["how"], x["source"], x["key"]) for x in again["results"]] == [("record", "player", pack["angry"])]


def test_a_new_word_is_added_as_the_players(client: TestClient, pack):
    r = put_record(client, pack["ref"], "撒娇", pack["smile"])
    assert r.status_code == 200, r.text
    [rec] = records(client, pack["ref"])
    assert rec == r.json()
    assert (rec["word"], rec["item"], rec["source"], rec["guessed"], rec["unstable"], rec["score"]) == (
        "撒娇",
        pack["smile"],
        "player",
        False,
        False,
        None,
    )
    # 内置名单的一项就是名字
    assert put_record(client, "builtin", "火大", "生气").json()["item"] == "生气"
    assert [(x["word"], x["item"]) for x in records(client, "builtin")] == [("火大", "生气")]


def test_editing_keeps_unstable_and_bumps_the_time(client: TestClient, db: Session, pack):
    old = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rec = WordRecord(list_ref=pack["ref"], word="嘟嘴", item=pack["smile"], source="migrated", updated_at=old)
    rec.guessed, rec.unstable, rec.score = True, True, 0.8
    db.add(rec)
    db.commit()
    body = put_record(client, pack["ref"], "嘟嘴", pack["smile"]).json()
    assert (body["source"], body["guessed"], body["unstable"], body["score"]) == ("player", False, True, None)
    db.expire_all()
    row = db.scalars(select(WordRecord).where(WordRecord.word == "嘟嘴")).one()
    assert row.updated_at.replace(tzinfo=timezone.utc) > old


def test_the_item_must_be_in_the_list_now(client: TestClient, pack):
    assert put_record(client, pack["ref"], "嘟嘴", "nope").status_code == 422
    assert put_record(client, "builtin", "嘟嘴", "nope").status_code == 422
    # 停用的立绘不在名单里
    assert client.put(f"{pack['base']}/{pack['smile']}", json={"enabled": False}).status_code == 200
    r = put_record(client, pack["ref"], "嘟嘴", pack["smile"])
    assert r.status_code == 422
    assert "名单里没有" in r.json()["detail"]
    for ref in ("pack:nope", "voice:x"):
        assert put_record(client, ref, "嘟嘴", pack["angry"]).status_code == 404
    assert records(client, pack["ref"]) == []


@pytest.mark.parametrize("word", ["", "  ", "长" * 41])
def test_put_validates_the_word(client: TestClient, pack, word):
    assert put_record(client, pack["ref"], word, pack["smile"]).status_code == 422


def test_delete_removes_only_that_record(client: TestClient, pack):
    put_record(client, pack["ref"], "嘟嘴", pack["smile"])
    put_record(client, pack["ref"], "火大", pack["angry"])
    put_record(client, "builtin", "嘟嘴", "微笑")
    r = client.delete("/api/emotion/records", params={"list_ref": pack["ref"], "word": "嘟嘴"})
    assert r.status_code == 204
    assert [x["word"] for x in records(client, pack["ref"])] == ["火大"]
    assert [x["word"] for x in records(client, "builtin")] == ["嘟嘴"]
    again = client.delete("/api/emotion/records", params={"list_ref": pack["ref"], "word": "嘟嘴"})
    assert again.status_code == 404
    assert client.delete("/api/emotion/records", params={"list_ref": "pack:nope", "word": "火大"}).status_code == 404
