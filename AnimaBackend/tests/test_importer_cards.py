"""读酒馆卡(app/importer/cards.py):和前端导入卡时 POST 的那份一字不差。

期望结果 tests/fixtures/cards/*.expected.json 是前端 cardToStored(parseCardFile(file)) + 头像算出来的,
前端 frontend/src/debug/lib/cardParser.fixtures.test.ts 和同一份比,两边对上就说明解析规则一样。
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.importer.cards import CardError, parse_card

FIXTURES = Path(__file__).parent / "fixtures" / "cards"
CARDS = sorted(p for p in FIXTURES.iterdir() if p.suffix in (".png", ".json") and not p.name.endswith(".expected.json"))
WITH_EXPECTED = [p for p in CARDS if p.with_suffix(".expected.json").exists()]


def _compact(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def test_every_fixture_but_the_broken_one_has_an_expected_result():
    assert len(WITH_EXPECTED) >= 6
    assert {p.name for p in CARDS} - {p.name for p in WITH_EXPECTED} == {"no_card.png"}


@pytest.mark.parametrize("path", WITH_EXPECTED, ids=lambda p: p.name)
def test_parse_card_matches_the_frontend(path: Path):
    want = json.loads(path.with_suffix(".expected.json").read_text(encoding="utf-8"))
    got = parse_card(path.read_bytes())
    assert got == want
    assert _compact(got) == _compact(want)  # 键的先后也一样


def test_png_without_card_data_is_an_error():
    with pytest.raises(CardError, match="没有找到角色卡数据"):
        parse_card((FIXTURES / "no_card.png").read_bytes())


@pytest.mark.parametrize(
    "data",
    [b"", b"not json", b"[1, 2]", b'"just a string"', b"null", b"\x89PNG\r\n\x1a\n" + b"\x00" * 4],
    ids=["empty", "garbage", "array", "string", "null", "truncated-png"],
)
def test_things_that_are_not_cards_are_errors(data: bytes):
    with pytest.raises(CardError):
        parse_card(data)


def test_broken_base64_in_the_card_chunk_is_an_error():
    from tests.fixtures.cards.make_cards import png

    for payload in ("not*base64!", "abcde", "YWJj=ZGVm"):
        with pytest.raises(CardError):
            parse_card(png(("chara", payload)))


def test_the_parsed_card_can_be_created_as_is(client: TestClient):
    """parse_card 的结果原样 POST 给建卡接口就能建(导入执行时就是这么用的)"""
    payload = parse_card((FIXTURES / "v2_chara.png").read_bytes())
    created = client.post("/api/tavern/cards", json=payload)
    assert created.status_code == 200, created.text
    card = created.json()
    assert (card["name"], card["has_avatar"], card["spec"]) == ("刻晴", True, "chara_card_v2")
    assert card["character_book"]["entries"][0]["comment"] == "玉衡星"
