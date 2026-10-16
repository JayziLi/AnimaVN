"""配对表的接口:GET /api/pairings(素材架构第 1c 期)、表被哪些卡用和改一格(第 1d 期)。
表和素材直接插进 client 夹具的内存库。"""

from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models import (
    CardScenePack,
    CardSpritePack,
    CardVoice,
    PackSprite,
    Pairing,
    PairingRow,
    SceneAsset,
    ScenePack,
    SpritePack,
    VoiceEmotion,
    VoiceProfile,
)


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    """和接口同一个内存库的会话"""
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    gen.close()


@pytest.fixture
def tables(db: Session) -> dict[str, str]:
    shared = Pairing(follower="voice", list_ref="pack:p1", target="v1")
    own = Pairing(follower="voice", list_ref="pack:p1", target="v1", card_id="k1")
    other_list = Pairing(follower="voice", list_ref="pack:p2", target="v1")
    cg = Pairing(follower="cg", list_ref="pack:p1", target="c1")
    db.add_all([shared, own, other_list, cg])
    db.flush()
    db.add_all(
        [
            PairingRow(pairing_id=shared.id, item="s2", value="e1", source="migrated"),
            PairingRow(pairing_id=shared.id, item="s1", value=None, source="local", guessed=True, unstable=True),
            PairingRow(pairing_id=own.id, item="s1", value="e2", source="player"),
            PairingRow(pairing_id=cg.id, item="s1", value="f1", source="name", pending=True),
        ]
    )
    db.commit()
    return {"shared": shared.id, "cg": cg.id}


def get(client: TestClient, **params):
    return client.get("/api/pairings", params=params)


def test_only_the_shared_table_of_the_list_comes_back(client: TestClient, tables):
    r = get(client, follower="voice", list_ref="pack:p1")
    assert r.status_code == 200, r.text
    assert r.json() == [
        {
            "id": tables["shared"],
            "follower": "voice",
            "list_ref": "pack:p1",
            "target": "v1",
            "cards": [],
            "cells": [
                {"item": "s1", "value": None, "source": "local", "guessed": True, "pending": False, "unstable": True},
                {"item": "s2", "value": "e1", "source": "migrated", "guessed": False, "pending": False, "unstable": False},
            ],
        }
    ]
    cg = get(client, follower="cg", list_ref="pack:p1").json()
    assert [(t["id"], t["target"], [c["value"] for c in t["cells"]]) for t in cg] == [(tables["cg"], "c1", ["f1"])]
    assert cg[0]["cells"][0]["pending"] is True


def test_tables_are_sorted_by_target_and_can_be_filtered(client: TestClient, db: Session, tables):
    db.add(Pairing(follower="voice", list_ref="pack:p1", target="v0"))
    db.commit()
    both = get(client, follower="voice", list_ref="pack:p1").json()
    assert [(t["target"], len(t["cells"])) for t in both] == [("v0", 0), ("v1", 2)]
    assert [t["id"] for t in get(client, follower="voice", list_ref="pack:p1", target="v1").json()] == [tables["shared"]]
    assert get(client, follower="voice", list_ref="pack:p1", target="v9").json() == []
    assert get(client, follower="voice", list_ref="pack:none").json() == []


def test_follower_must_be_voice_or_cg(client: TestClient):
    assert get(client, follower="xx", list_ref="pack:p1").status_code == 422
    assert get(client, follower="voice").status_code == 422


# ── 表被哪些卡用、改一格(第 1d 期) ──────────────────────────────

OLD = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def world(db: Session) -> dict[str, str]:
    """两个立绘包、两个声音、两个场景包、四张卡,和几张表。编号直接写死,看着方便"""
    db.add_all([SpritePack(id="p1", name="舞台装"), SpritePack(id="p2", name="私服")])
    db.add_all(
        [
            PackSprite(id="s1", pack_id="p1", label="微笑"),
            PackSprite(id="s2", pack_id="p1", label="生气"),
            PackSprite(id="s3", pack_id="p1", label="停用的", enabled=False),
            PackSprite(id="s9", pack_id="p2", label="微笑"),
        ]
    )
    db.add_all([VoiceProfile(id=v, name=v, connection_id="t1") for v in ("v1", "v2")])
    db.add_all(
        [
            VoiceEmotion(id="e1", profile_id="v1", label="平静"),
            VoiceEmotion(id="e2", profile_id="v1", label="开心"),
            VoiceEmotion(id="e9", profile_id="v2", label="平静"),
        ]
    )
    db.add_all([ScenePack(id="sp1", name="教室"), ScenePack(id="sp2", name="海边")])
    db.add_all(
        [
            SceneAsset(id="c1", pack_id="sp1", kind="cg", label="牵手"),
            SceneAsset(id="f1", pack_id="sp1", kind="cg", label="微笑", parent_id="c1"),
            SceneAsset(id="f2", pack_id="sp1", kind="cg", label="生气", parent_id="c1"),
            SceneAsset(id="c2", pack_id="sp1", kind="cg", label="回头"),
            SceneAsset(id="f3", pack_id="sp1", kind="cg", label="微笑", parent_id="c2"),
            SceneAsset(id="c3", pack_id="sp2", kind="cg", label="看海"),
        ]
    )
    # kb:两个包、主声音 v1、教室;ka:p1、主声音 v1、海边;kc:p1、v1 只是附带的(主声音 v2)、教室;kd:只有 p2、主声音 v1、教室
    db.add_all(
        [
            CardSpritePack(card_id="kb", pack_id="p1", is_current=True),
            CardSpritePack(card_id="kb", pack_id="p2", sort=1),
            CardSpritePack(card_id="ka", pack_id="p1", is_current=True),
            CardSpritePack(card_id="kc", pack_id="p1", is_current=True),
            CardSpritePack(card_id="kd", pack_id="p2", is_current=True),
            CardVoice(card_id="kb", profile_id="v1", is_main=True),
            CardVoice(card_id="ka", profile_id="v1", is_main=True),
            CardVoice(card_id="kc", profile_id="v1", is_main=False),
            CardVoice(card_id="kc", profile_id="v2", is_main=True),
            CardVoice(card_id="kd", profile_id="v1", is_main=True),
            CardScenePack(card_id="kb", pack_id="sp1"),
            CardScenePack(card_id="ka", pack_id="sp2"),
            CardScenePack(card_id="kc", pack_id="sp1"),
            CardScenePack(card_id="kd", pack_id="sp1"),
        ]
    )
    voice = Pairing(follower="voice", list_ref="pack:p1", target="v1", updated_at=OLD)
    voice2 = Pairing(follower="voice", list_ref="pack:p1", target="v2")
    voice_p2 = Pairing(follower="voice", list_ref="pack:p2", target="v1")
    builtin = Pairing(follower="voice", list_ref="builtin", target="v1")
    cg = Pairing(follower="cg", list_ref="pack:p1", target="c1", updated_at=OLD)
    cg_sea = Pairing(follower="cg", list_ref="pack:p1", target="c3")
    db.add_all([voice, voice2, voice_p2, builtin, cg, cg_sea])
    db.flush()
    db.add_all(
        [
            PairingRow(
                pairing_id=voice.id, item="s1", value="e1", source="local", guessed=True, pending=True, unstable=True
            ),
            PairingRow(pairing_id=voice.id, item="s2", value="e1", source="name"),
            PairingRow(pairing_id=cg.id, item="s1", value="f1", source="name"),
        ]
    )
    db.commit()
    return {"voice": voice.id, "voice2": voice2.id, "builtin": builtin.id, "cg": cg.id}


def cards_of(client: TestClient, follower: str, list_ref: str) -> list[tuple[str, list[str]]]:
    return [(t["target"], t["cards"]) for t in get(client, follower=follower, list_ref=list_ref).json()]


def test_a_voice_table_lists_the_cards_with_this_pack_and_this_main_voice(client: TestClient, world):
    assert cards_of(client, "voice", "pack:p1") == [("v1", ["ka", "kb"]), ("v2", ["kc"])]
    assert cards_of(client, "voice", "pack:p2") == [("v1", ["kb", "kd"])]


def test_a_cg_table_lists_the_cards_with_this_pack_and_this_composition(client: TestClient, world):
    assert cards_of(client, "cg", "pack:p1") == [("c1", ["kb", "kc"]), ("c3", ["ka"])]


def test_a_table_of_the_builtin_list_has_no_cards(client: TestClient, world):
    assert cards_of(client, "voice", "builtin") == [("v1", [])]


def put_cell(client: TestClient, table: str, item: str, value):
    return client.put(f"/api/pairings/{table}/cells/{item}", json={"value": value})


def player_cell(item: str, value: str | None, unstable: bool) -> dict:
    """改过的一格:来源「你改的」,模型猜的、待重配都清掉"""
    return {"item": item, "value": value, "source": "player", "guessed": False, "pending": False, "unstable": unstable}


def cells_of(client: TestClient, follower: str, list_ref: str, target: str) -> dict[str, tuple]:
    [t] = get(client, follower=follower, list_ref=list_ref, target=target).json()
    return {c["item"]: (c["value"], c["source"], c["guessed"], c["pending"], c["unstable"]) for c in t["cells"]}


def table_time(db: Session, table: str) -> datetime:
    db.expire_all()
    return db.get(Pairing, table).updated_at.replace(tzinfo=timezone.utc)


def test_the_player_changes_one_voice_cell(client: TestClient, db: Session, world):
    r = put_cell(client, world["voice"], "s1", "e2")
    assert r.status_code == 200, r.text
    # 「本来就不稳定」照旧留着,别的标记清掉
    assert r.json() == player_cell("s1", "e2", unstable=True)
    assert cells_of(client, "voice", "pack:p1", "v1") == {
        "s1": ("e2", "player", False, False, True),
        "s2": ("e1", "name", False, False, False),
    }
    assert table_time(db, world["voice"]) > OLD


def test_a_missing_cell_is_added(client: TestClient, world):
    # 停用的立绘也能改:重新启用以后照表走
    r = put_cell(client, world["voice"], "s3", "e2")
    assert r.status_code == 200, r.text
    assert r.json() == player_cell("s3", "e2", unstable=False)
    assert put_cell(client, world["voice2"], "s1", "e9").status_code == 200
    assert cells_of(client, "voice", "pack:p1", "v2") == {"s1": ("e9", "player", False, False, False)}
    # 内置名单的一项就是名字
    assert put_cell(client, world["builtin"], "微笑", "e1").status_code == 200
    assert put_cell(client, world["builtin"], "s1", "e1").status_code == 422


@pytest.mark.parametrize(
    ("item", "value"),
    [
        ("s1", "e9"),  # 别的声音的一行
        ("s1", "nope"),
        ("s1", None),  # 语音没有「不配」
        ("s9", "e1"),  # 别的包的立绘
        ("nope", "e1"),
    ],
)
def test_a_voice_cell_must_be_a_row_of_this_voice(client: TestClient, db: Session, world, item, value):
    r = put_cell(client, world["voice"], item, value)
    assert r.status_code == 422, r.text
    assert cells_of(client, "voice", "pack:p1", "v1")["s1"] == ("e1", "local", True, True, True)
    assert table_time(db, world["voice"]) == OLD


def test_a_cg_cell_is_a_variant_of_this_composition_or_the_composition_itself(client: TestClient, db: Session, world):
    assert put_cell(client, world["cg"], "s2", "f2").json()["value"] == "f2"
    assert put_cell(client, world["cg"], "s1", None).json() == player_cell("s1", None, unstable=False)
    assert cells_of(client, "cg", "pack:p1", "c1") == {
        "s1": (None, "player", False, False, False),
        "s2": ("f2", "player", False, False, False),
    }
    assert table_time(db, world["cg"]) > OLD
    for value in ("f3", "c1", "e1", "nope"):  # 别的构图的差分、构图自己的编号、声音的一行
        assert put_cell(client, world["cg"], "s1", value).status_code == 422, value
    assert cells_of(client, "cg", "pack:p1", "c1")["s1"][0] is None


def test_editing_a_missing_table_is_404(client: TestClient, world):
    r = put_cell(client, "nope", "s1", "e1")
    assert r.status_code == 404
    assert "配对表" in r.json()["detail"]


def test_the_value_must_be_given(client: TestClient, world):
    assert client.put(f"/api/pairings/{world['voice']}/cells/s1", json={}).status_code == 422
