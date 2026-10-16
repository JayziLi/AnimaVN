"""缺格补配(素材架构第 1d 期,设计 1.6.2):POST /api/pairings/fill 和 app/pairing/fill.py 的比名字、挑基础行。
本地认词模型用假 encoder;表和素材直接插进 client 夹具的内存库,编号写死看着方便。"""

from collections.abc import Iterator
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.emotion import use_matcher_source
from app.db import get_db
from app.emotion.lists import Item
from app.emotion.matcher import EmotionMatcher
from app.main import app
from app.models import (
    PackSprite,
    Pairing,
    PairingRow,
    SceneAsset,
    ScenePack,
    SpritePack,
    VoiceEmotion,
    VoiceProfile,
)
from app.pairing.fill import base_rows, name_match

# ── 纯逻辑 ──────────────────────────────


def row(id: str, label: str, *aliases: str):
    return SimpleNamespace(id=id, label=label, aliases=list(aliases))


def test_names_match_on_either_side_label_or_alias():
    rows = [row("a", "平静", "说话"), row("b", "眨眼"), row("c", "happy")]
    assert name_match(Item("s", "说话", ()), rows).id == "a"  # 名字 = 别名
    assert name_match(Item("s", "坏笑", ("眨眼",)), rows).id == "b"  # 别名 = 名字
    assert name_match(Item("s", "微笑", ("聊天", "说话")), rows).id == "a"  # 别名 = 别名
    # 只去首尾空白、英文不分大小写
    assert name_match(Item("s", " HAPPY ", ()), rows).id == "c"
    assert name_match(Item("s", "平 静", ()), rows) is None
    assert name_match(Item("s", "生气", ()), rows) is None


def test_the_first_matching_row_wins():
    rows = [row("a", "闲聊", "说话"), row("b", "说话")]
    assert name_match(Item("s", "说话", ()), rows).id == "a"
    assert name_match(Item("s", "说话", ()), rows[::-1]).id == "b"


def test_empty_names_never_match():
    rows = [row("a", "平静", " ")]
    assert name_match(Item("s", "微笑", ("", "  ")), rows) is None


def test_a_tone_version_is_a_suffix_hung_on_two_or_more_rows():
    rows = [
        row("1", "平静"),
        row("2", "开心"),
        row("3", "平静·轻声"),
        row("4", "开心·轻声"),
        # 后缀只挂在一行上:是一段单独的语气
        row("5", "平静·认真"),
        # 前面那段不存在:也是单独的
        row("6", "生气·轻声"),
        # 挂在单独那段上的版本也算
        row("7", "平静·认真·轻声"),
    ]
    assert [r.id for r in base_rows(rows)] == ["1", "2", "5", "6"]


def test_without_versions_every_row_is_a_base_row():
    # 「生气·嘴硬」「生气·委屈」各是一段单独的语气,不是「生气」的版本
    rows = [row("1", "生气"), row("2", "生气·嘴硬"), row("3", "生气·委屈"), row("4", "微笑")]
    assert base_rows(rows) == rows


# ── 接口 ──────────────────────────────


class FakeEncoder:
    """表里的词给固定向量,别的词一律 [0, 0, 1]"""

    name = "fake"
    TABLE = {"嘟嘴": [0.1, 1, 0], "眨眼": [0, 1, 0], "平静·轻声": [1, 0, 0], "平静": [1, 0, 0.1]}

    def encode(self, texts):
        a = np.array([self.TABLE.get(t, [0, 0, 1]) for t in texts], dtype=np.float32)
        return a / np.linalg.norm(a, axis=1, keepdims=True)


@pytest.fixture
def fake_model():
    app.dependency_overrides[use_matcher_source] = lambda: (lambda: EmotionMatcher(FakeEncoder()))
    yield
    app.dependency_overrides.pop(use_matcher_source, None)


@pytest.fixture
def no_model_allowed():
    """这次不该用到认词模型:用了就让测试失败"""

    def source():
        raise AssertionError("不该加载认词模型")

    app.dependency_overrides[use_matcher_source] = lambda: source
    yield
    app.dependency_overrides.pop(use_matcher_source, None)


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    gen.close()


OLD = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def world(db: Session) -> dict[str, str]:
    db.add(SpritePack(id="p1", name="舞台装"))
    db.add_all(
        [
            PackSprite(id="s1", pack_id="p1", label="微笑", aliases=["说话"], sort=0),
            PackSprite(id="s2", pack_id="p1", label=" Happy ", sort=1),
            PackSprite(id="s3", pack_id="p1", label="坏笑", aliases=["眨眼"], sort=2),
            PackSprite(id="s4", pack_id="p1", label="嘟嘴", sort=3),
            PackSprite(id="s5", pack_id="p1", label="平静·轻声", sort=4),
            PackSprite(id="s6", pack_id="p1", label="生气", sort=5),
            PackSprite(id="s8", pack_id="p1", label="平静·认真", sort=6),
            PackSprite(id="s7", pack_id="p1", label="停用的", enabled=False, sort=7),
        ]
    )
    db.add_all([VoiceProfile(id="v1", name="舞台声", connection_id="t1"), VoiceProfile(id="v0", name="空", connection_id="t1")])
    # 故意倒着插:排序看 sort
    db.add_all(
        [
            VoiceEmotion(id="e8", profile_id="v1", label="平静·认真", sort=7),
            VoiceEmotion(id="e7", profile_id="v1", label="开心·轻声", sort=6),
            VoiceEmotion(id="e6", profile_id="v1", label="平静·轻声", sort=5),
            VoiceEmotion(id="e5", profile_id="v1", label="眨眼", sort=4),
            VoiceEmotion(id="e4", profile_id="v1", label="闲聊", aliases=["说话"], sort=3),
            VoiceEmotion(id="e3", profile_id="v1", label="说话", sort=2),
            VoiceEmotion(id="e2", profile_id="v1", label="开心", aliases=["happy"], sort=1),
            VoiceEmotion(id="e1", profile_id="v1", label="平静", sort=0),
        ]
    )
    db.add(ScenePack(id="sp1", name="教室"))
    db.add_all(
        [
            SceneAsset(id="c1", pack_id="sp1", kind="cg", label="牵手", mime="image/png"),
            SceneAsset(id="f1", pack_id="sp1", kind="cg", label="微笑", parent_id="c1", mime="image/png"),
            SceneAsset(id="f2", pack_id="sp1", kind="cg", label="调皮", aliases=["眨眼"], parent_id="c1", mime="image/png"),
            # 没传图的差分、停用的差分都不算
            SceneAsset(id="f3", pack_id="sp1", kind="cg", label="嘟嘴", parent_id="c1"),
            SceneAsset(id="f4", pack_id="sp1", kind="cg", label="happy", parent_id="c1", mime="image/png", enabled=False),
            SceneAsset(id="c9", pack_id="sp1", kind="cg", label="回头", mime="image/png"),
            SceneAsset(id="f9", pack_id="sp1", kind="cg", label="微笑", parent_id="c9"),
        ]
    )
    voice = Pairing(follower="voice", list_ref="pack:p1", target="v1", updated_at=OLD)
    own = Pairing(follower="voice", list_ref="pack:p1", target="v1", card_id="k1")
    db.add_all([voice, own])
    db.flush()
    db.add_all(
        [
            PairingRow(pairing_id=voice.id, item="s6", value="e1", source="player"),
            PairingRow(pairing_id=own.id, item="s1", value="e1", source="player"),
        ]
    )
    db.commit()
    return {"voice": voice.id, "own": own.id}


def fill(client: TestClient, follower: str, list_ref: str, target: str):
    return client.post("/api/pairings/fill", json={"follower": follower, "list_ref": list_ref, "target": target})


def cell(item: str, value: str | None, source: str, *, guessed: bool = False, pending: bool = False) -> dict:
    return {"item": item, "value": value, "source": source, "guessed": guessed, "pending": pending, "unstable": False}


def stored(db: Session, table: str) -> dict[str, tuple]:
    db.expire_all()
    rows = db.scalars(select(PairingRow).where(PairingRow.pairing_id == table))
    return {r.item: (r.value, r.source, r.guessed, r.pending) for r in rows}


def table_time(db: Session, table: str) -> datetime:
    db.expire_all()
    return db.get(Pairing, table).updated_at.replace(tzinfo=timezone.utc)


def test_voice_fill_matches_names_then_asks_the_local_model(client: TestClient, db: Session, fake_model, world):
    r = fill(client, "voice", "pack:p1", "v1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["table_id"] == world["voice"]
    assert body["added"] == [
        cell("s1", "e3", "name"),  # 别名「说话」:排前面的「说话」那行,不是别名里写了说话的「闲聊」
        cell("s2", "e2", "name"),  # 去空白、不分大小写对上别名 happy
        cell("s3", "e5", "name"),  # 别名「眨眼」= 语气名
        cell("s4", "e5", "local", guessed=True, pending=True),
        # 「平静·轻声」那行是声线版本,不单独配:本地模型在基础行里挑
        cell("s5", "e1", "local", guessed=True, pending=True),
        # 后缀只挂一行的是单独一段,照名字配
        cell("s8", "e8", "name"),
    ]
    assert body["skipped"] == []
    # 已有的不动,停用的不补,只给卡另存的表不碰
    after = stored(db, world["voice"])
    assert after["s6"] == ("e1", "player", False, False)
    assert "s7" not in after
    assert len(after) == 7
    assert stored(db, world["own"]) == {"s1": ("e1", "player", False, False)}
    assert table_time(db, world["voice"]) > OLD


def test_a_second_fill_adds_nothing_and_leaves_the_table_alone(client: TestClient, db: Session, fake_model, world):
    assert fill(client, "voice", "pack:p1", "v1").status_code == 200
    db.get(Pairing, world["voice"]).updated_at = OLD
    db.commit()
    again = fill(client, "voice", "pack:p1", "v1").json()
    assert again == {"table_id": world["voice"], "added": [], "skipped": []}
    assert table_time(db, world["voice"]) == OLD


def test_without_the_local_model_the_rest_is_left_out_and_reported(client: TestClient, db: Session, world):
    # conftest 默认当作模型没装
    body = fill(client, "voice", "pack:p1", "v1").json()
    assert [c["item"] for c in body["added"]] == ["s1", "s2", "s3", "s8"]
    assert [s["item"] for s in body["skipped"]] == ["s4", "s5"]
    assert all("模型" in s["reason"] for s in body["skipped"])
    assert set(stored(db, world["voice"])) == {"s1", "s2", "s3", "s6", "s8"}


def test_all_names_matching_never_loads_the_model(client: TestClient, db: Session, no_model_allowed, world):
    for s in ("s4", "s5"):
        db.add(PairingRow(pairing_id=world["voice"], item=s, value="e1", source="player"))
    db.commit()
    body = fill(client, "voice", "pack:p1", "v1").json()
    assert [c["item"] for c in body["added"]] == ["s1", "s2", "s3", "s8"]


def test_a_missing_table_is_created_as_the_shared_one(client: TestClient, db: Session, fake_model, world):
    db.add(VoiceEmotion(id="x1", profile_id="v0", label="微笑"))
    db.commit()
    body = fill(client, "voice", "pack:p1", "v0").json()
    table = db.get(Pairing, body["table_id"])
    assert (table.follower, table.list_ref, table.target, table.card_id) == ("voice", "pack:p1", "v0", "")
    assert body["added"][0] == cell("s1", "x1", "name")
    assert len(body["added"]) == 7


def test_cg_fill_matches_variant_names_and_otherwise_keeps_the_composition(
    client: TestClient, db: Session, no_model_allowed, world
):
    r = fill(client, "cg", "pack:p1", "c1")
    assert r.status_code == 200, r.text
    body = r.json()
    table = db.get(Pairing, body["table_id"])
    assert (table.follower, table.target, table.card_id) == ("cg", "c1", "")
    keep = {"source": "local", "pending": True}
    assert body["added"] == [
        cell("s1", "f1", "name"),
        cell("s2", None, **keep),  # 「happy」那张差分停用了
        cell("s3", "f2", "name"),  # 别名对别名
        cell("s4", None, **keep),  # 「嘟嘴」那张差分没传图
        cell("s5", None, **keep),
        cell("s6", None, **keep),
        cell("s8", None, **keep),
    ]
    assert body["skipped"] == []


@pytest.mark.parametrize(
    ("follower", "list_ref", "target", "status"),
    [
        ("voice", "builtin", "v1", 422),  # 现在只补立绘包的名单
        ("voice", "pack:nope", "v1", 404),
        ("voice", "pack:p1", "nope", 404),
        ("cg", "pack:p1", "nope", 404),
        ("cg", "pack:p1", "f1", 404),  # 差分不是构图
        ("cg", "pack:p1", "e1", 404),
        ("voice", "pack:p1", "v0", 422),  # 这个声音还没有语气
        ("cg", "pack:p1", "c9", 422),  # 这张 CG 没有带图的差分
        ("xx", "pack:p1", "v1", 422),
    ],
)
def test_fill_checks_what_it_is_given(client: TestClient, db: Session, world, follower, list_ref, target, status):
    tables = db.scalar(select(Pairing.id).where(Pairing.target == target, Pairing.card_id == ""))
    r = fill(client, follower, list_ref, target)
    assert r.status_code == status, r.text
    # 没建表
    db.expire_all()
    assert db.scalar(select(Pairing.id).where(Pairing.target == target, Pairing.card_id == "")) == tables


def test_two_fills_at_once_one_of_them_is_told_to_retry(client: TestClient, db: Session, fake_model, world, monkeypatch):
    def clash(self):
        raise IntegrityError("INSERT INTO pairing_rows", {}, Exception("UNIQUE constraint failed"))

    monkeypatch.setattr(Session, "commit", clash)
    r = fill(client, "voice", "pack:p1", "v1")
    assert r.status_code == 409, r.text
    monkeypatch.undo()
    assert set(stored(db, world["voice"])) == {"s6"}
