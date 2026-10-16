"""让聊天模型重配(素材架构第 1d 期,设计 1.6.3、1.6.8):GET /api/pairings/{id}/estimate、POST /api/pairings/{id}/suggest
和 app/pairing/prompt.py 的拼请求、解析回复。不发真的请求:聊天连接是 mock,要它回指定的字时换成假的 provider。"""

from collections.abc import Iterator
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.llm.errors import LLMError
from app.main import app
from app.models import PackSprite, Pairing, PairingRow, SceneAsset, ScenePack, SpritePack, VoiceEmotion, VoiceProfile
from app.pairing.prompt import BadReply, letter, parse_reply

# ── 纯逻辑 ──────────────────────────────


def test_letters_go_on_after_z():
    assert [letter(i) for i in (0, 1, 25, 26, 27, 51, 52)] == ["A", "B", "Z", "AA", "AB", "AZ", "BA"]


@pytest.mark.parametrize(
    "reply",
    [
        '{"1": "A", "2": "C"}',
        '```json\n{"1": "A", "2": "C"}\n```',
        '好的,配好了:\n{"1": "A",\n "2": "C"}\n以上。',
        '{ "1": " a ", "02": "c" }',  # 小写、空白、补零都认
        '先说明一下 {这不是 JSON} 结果是 {"1": "A", "2": "C"}',
    ],
)
def test_the_first_json_object_in_the_reply_is_read(reply):
    assert parse_reply(reply, 3, 3) == {1: 0, 2: 2}


@pytest.mark.parametrize(
    ("reply", "why"),
    [
        ("我觉得都挺好", "JSON"),
        ('["A", "B"]', "JSON"),
        ("{}", "一项"),
        ('{"1": "D"}', "D"),  # 右边只有 A–C
        ('{"4": "A"}', "4"),  # 左边只有 3 项
        ('{"0": "A"}', "0"),
        ('{"speaker": "小灵"}', "speaker"),
        ('{"1": 1}', "1"),
        ('{"1": "A. 平静"}', "A. 平静"),
    ],
)
def test_a_reply_that_cannot_be_used_says_why(reply, why):
    with pytest.raises(BadReply) as e:
        parse_reply(reply, 3, 3)
    assert why in str(e.value)


# ── 接口 ──────────────────────────────


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    gen.close()


OLD = datetime(2026, 1, 1, tzinfo=timezone.utc)
LONG = "这是一段很长的参考音频原文,用来看看发给模型的时候会不会只截前四十个字,后面这些都不该出现在提示词里"


@pytest.fixture
def world(db: Session) -> dict[str, str]:
    db.add(SpritePack(id="p1", name="舞台装"))
    db.add_all(
        [
            PackSprite(id="s1", pack_id="p1", label="微笑", description="平常带笑意地说话", aliases=["说话", " ", "默认"], sort=0),
            PackSprite(id="s2", pack_id="p1", label="认真", description="讲正事、\n叮嘱", sort=1),
            PackSprite(id="s3", pack_id="p1", label="嘟嘴", sort=2),
            PackSprite(id="s4", pack_id="p1", label="停用的", enabled=False, sort=3),
        ]
    )
    db.add(VoiceProfile(id="v1", name="舞台声", connection_id="t1"))
    db.add_all(
        [
            VoiceEmotion(id="e1", profile_id="v1", label="平静", prompt_text=" 今天的风有点大呢 ", sort=0),
            VoiceEmotion(id="e2", profile_id="v1", label="开心", aliases=["高兴"], prompt_text=LONG, sort=1),
            # 两段声线版本:不单独列
            VoiceEmotion(id="e3", profile_id="v1", label="平静·轻声", prompt_text="轻声", sort=2),
            VoiceEmotion(id="e4", profile_id="v1", label="开心·轻声", prompt_text="轻声", sort=3),
            VoiceEmotion(id="e5", profile_id="v1", label="认真", sort=4),
        ]
    )
    db.add(ScenePack(id="sp1", name="教室"))
    db.add_all(
        [
            SceneAsset(id="c1", pack_id="sp1", kind="cg", label="牵手", mime="image/png"),
            SceneAsset(id="f1", pack_id="sp1", kind="cg", label="微笑", description="笑着牵手", parent_id="c1", mime="image/png", sort=0),
            SceneAsset(id="f2", pack_id="sp1", kind="cg", label="害羞", parent_id="c1", mime="image/png", sort=1),
            SceneAsset(id="f3", pack_id="sp1", kind="cg", label="没图", parent_id="c1", sort=2),
        ]
    )
    voice = Pairing(follower="voice", list_ref="pack:p1", target="v1", updated_at=OLD)
    cg = Pairing(follower="cg", list_ref="pack:p1", target="c1", updated_at=OLD)
    builtin = Pairing(follower="voice", list_ref="builtin", target="v1")
    db.add_all([voice, cg, builtin])
    db.flush()
    db.add_all(
        [
            PairingRow(pairing_id=voice.id, item="s1", value="e1", source="name"),
            PairingRow(pairing_id=voice.id, item="s2", value="e5", source="migrated", guessed=True),
            PairingRow(pairing_id=voice.id, item="s4", value="e2", source="player"),
            PairingRow(pairing_id=cg.id, item="s1", value="f1", source="name"),
            PairingRow(pairing_id=cg.id, item="s2", value=None, source="migrated"),
        ]
    )
    db.commit()
    return {"voice": voice.id, "cg": cg.id, "builtin": builtin.id}


VOICE_PROMPT = (
    "左边是立绘包「舞台装」的立绘(名字:说明;也叫:别名)\n"
    "  1. 微笑:平常带笑意地说话  也叫:说话、默认\n"
    "  2. 认真:讲正事、 叮嘱\n"
    "  3. 嘟嘴\n"
    "右边是声音「舞台声」的语气(名字;原文:这段参考音频说的话,截前 40 个字)\n"
    "  A. 平静  原文:今天的风有点大呢\n"
    f"  B. 开心  原文:{LONG[:40]}\n"
    "  C. 认真\n"
    "给左边每一项挑右边最合适的一项,只能从右边挑,每一项都要挑。"
    '只输出 JSON,不要别的字:{"1": "A", "2": "B", …}'
)

CG_PROMPT = (
    "左边是立绘包「舞台装」的立绘(名字:说明;也叫:别名)\n"
    "  1. 微笑:平常带笑意地说话  也叫:说话、默认\n"
    "  2. 认真:讲正事、 叮嘱\n"
    "  3. 嘟嘴\n"
    "右边是 CG「牵手」的差分(名字:说明;最后一项是不换差分)\n"
    "  A. 微笑:笑着牵手\n"
    "  B. 害羞\n"
    "  C. 保持构图本身\n"
    "给左边每一项挑右边最合适的一项,只能从右边挑,每一项都要挑。"
    '只输出 JSON,不要别的字:{"1": "A", "2": "B", …}'
)


def estimate(client: TestClient, table: str):
    return client.get(f"/api/pairings/{table}/estimate")


def test_the_voice_request_lists_sprites_and_base_tones(client: TestClient, world):
    r = estimate(client, world["voice"])
    assert r.status_code == 200, r.text
    assert r.json() == {"chars": len(VOICE_PROMPT), "prompt": VOICE_PROMPT}


def test_the_cg_request_lists_variants_with_a_file_and_keeping_the_composition(client: TestClient, world):
    assert estimate(client, world["cg"]).json() == {"chars": len(CG_PROMPT), "prompt": CG_PROMPT}


def test_estimate_checks_the_table(client: TestClient, db: Session, world):
    assert estimate(client, "nope").status_code == 404
    assert estimate(client, world["builtin"]).status_code == 422
    # 声音没了
    db.add(Pairing(id="gone", follower="voice", list_ref="pack:p1", target="v9"))
    db.commit()
    assert estimate(client, "gone").status_code == 404


class StubProvider:
    """假的聊天模型:记下收到的请求,回指定的字(或抛指定的错)"""

    def __init__(self):
        self.reply: str | Exception = ""
        self.calls: list[tuple[list, str]] = []

    async def complete(self, messages, model):
        self.calls.append((messages, model))
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


@pytest.fixture
def stub(monkeypatch) -> StubProvider:
    s = StubProvider()
    monkeypatch.setattr("app.api.pairings.provider_for", lambda conn: s)
    return s


def suggest(client: TestClient, table: str, **body):
    return client.post(f"/api/pairings/{table}/suggest", json=body)


def snapshot(db: Session, table: str) -> tuple:
    db.expire_all()
    rows = db.scalars(select(PairingRow).where(PairingRow.pairing_id == table).order_by(PairingRow.item))
    t = db.get(Pairing, table)
    return t.updated_at, [(r.item, r.value, r.source, r.guessed, r.pending, r.updated_at) for r in rows]


def test_voice_suggestions_list_only_what_differs_and_leave_the_table_alone(
    client: TestClient, db: Session, make_connection, stub, world
):
    make_connection(model="mock-large")
    stub.reply = '```json\n{"1": "A", "2": "b", "3": "B"}\n```'
    before = snapshot(db, world["voice"])
    r = suggest(client, world["voice"])
    assert r.status_code == 200, r.text
    assert r.json() == {
        "suggestions": [
            {"item": "s2", "current": "e5", "suggested": "e2", "new": False},
            # 表里还没有这一格:采纳就是新加
            {"item": "s3", "current": None, "suggested": "e2", "new": True},
        ],
        "unanswered": [],
    }
    [(messages, model)] = stub.calls
    assert model == "mock-large"
    assert [(m.role, m.content) for m in messages] == [("user", VOICE_PROMPT)]
    assert snapshot(db, world["voice"]) == before


def test_cg_suggestions_can_be_the_composition_itself(client: TestClient, db: Session, make_connection, stub, world):
    make_connection()
    stub.reply = '{"1": "C", "2": "B", "3": "C"}'
    before = snapshot(db, world["cg"])
    body = suggest(client, world["cg"]).json()
    assert body["suggestions"] == [
        {"item": "s1", "current": "f1", "suggested": None, "new": False},
        {"item": "s2", "current": None, "suggested": "f2", "new": False},
        {"item": "s3", "current": None, "suggested": None, "new": True},
    ]
    assert stub.calls[0][0][0].content == CG_PROMPT
    assert snapshot(db, world["cg"]) == before


def test_items_the_model_left_out_are_reported(client: TestClient, make_connection, stub, world):
    make_connection()
    stub.reply = '{"2": "C"}'
    assert suggest(client, world["voice"]).json() == {"suggestions": [], "unanswered": ["s1", "s3"]}


@pytest.mark.parametrize("reply", ["好的", '{"1": "D"}', '{"7": "A"}', "{}"])
def test_a_reply_that_cannot_be_used_is_502(client: TestClient, db: Session, make_connection, stub, world, reply):
    make_connection()
    stub.reply = reply
    before = snapshot(db, world["voice"])
    r = suggest(client, world["voice"])
    assert r.status_code == 502, r.text
    assert "模型" in r.json()["detail"]
    assert snapshot(db, world["voice"]) == before


def test_the_offline_mock_connection_answers_something_else_and_gets_502(
    client: TestClient, make_connection, world
):
    # 真的 mock provider 回的是一段对话 JSON,不是配对
    make_connection()
    r = suggest(client, world["voice"])
    assert r.status_code == 502, r.text


def test_a_failing_request_is_502_with_the_reason(client: TestClient, make_connection, stub, world):
    make_connection()
    stub.reply = LLMError("密钥不对")
    r = suggest(client, world["voice"])
    assert r.status_code == 502
    assert "密钥不对" in r.json()["detail"]


def test_without_a_chat_connection_nothing_is_sent(client: TestClient, stub, world):
    r = suggest(client, world["voice"])
    assert r.status_code == 400
    assert r.json()["detail"] == "没有可用的聊天连接"
    assert stub.calls == []


def test_a_given_connection_is_used_instead_of_the_active_one(client: TestClient, make_connection, stub, world):
    make_connection(model="active-model")
    other = make_connection(name="另一个", model="other-model")
    stub.reply = '{"1": "A"}'
    assert suggest(client, world["voice"], connection_id=other["id"]).status_code == 200
    assert stub.calls[0][1] == "other-model"
    assert suggest(client, world["voice"], connection_id="nope").status_code == 404
    assert len(stub.calls) == 1


def test_a_connection_without_a_model_name_is_400(client: TestClient, make_connection, stub, world):
    make_connection(api_type="openai_compatible", base_url="http://127.0.0.1:9", model="")
    r = suggest(client, world["voice"])
    assert r.status_code == 400
    assert stub.calls == []


def test_suggest_checks_the_table_before_sending(client: TestClient, make_connection, stub, world):
    make_connection()
    assert suggest(client, "nope").status_code == 404
    assert suggest(client, world["builtin"]).status_code == 422
    assert stub.calls == []


def test_taking_a_suggestion_writes_the_cell_as_the_chat_models(client: TestClient, db: Session, world):
    """采纳一条建议 = 改那一格,来源记「聊天模型配的」(前端发 PUT 一格,带 source)"""
    r = client.put(f"/api/pairings/{world['voice']}/cells/s2", json={"value": "e2", "source": "chat"})
    assert r.status_code == 200, r.text
    assert r.json() == {"item": "s2", "value": "e2", "source": "chat", "guessed": False, "pending": False, "unstable": False}
    # 不写就是「你改的」;别的来源不收
    assert client.put(f"/api/pairings/{world['voice']}/cells/s3", json={"value": "e1"}).json()["source"] == "player"
    assert client.put(f"/api/pairings/{world['voice']}/cells/s3", json={"value": "e1", "source": "name"}).status_code == 422
