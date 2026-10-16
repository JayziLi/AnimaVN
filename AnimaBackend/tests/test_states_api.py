"""状态组(app/states.py):查组、卡列表的 state_of、删主卡 / 删状态卡。"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models import CardState, CardStateGroup


@pytest.fixture
def db(client: TestClient) -> Iterator[Session]:
    gen = app.dependency_overrides[get_db]()
    session = next(gen)
    yield session
    session.close()


def _group(db: Session, main: str, other: str) -> None:
    db.add(CardStateGroup(id="g1", main_card_id=main))
    db.add_all(
        [
            CardState(card_id=main, group_id="g1", name="普通", sort=0),
            CardState(card_id=other, group_id="g1", name="私服", sort=1),
        ]
    )
    db.commit()


def test_group_lookup_and_state_of(client: TestClient, db: Session, make_card):
    main, other, alone = make_card(name="香奈美"), make_card(name="香奈美"), make_card(name="星绘")
    _group(db, main["id"], other["id"])
    got = client.get(f"/api/tavern/cards/{other['id']}/states").json()
    assert got["group_id"] == "g1" and got["main_card_id"] == main["id"]
    assert [(s["card_id"], s["name"]) for s in got["states"]] == [(main["id"], "普通"), (other["id"], "私服")]
    assert client.get(f"/api/tavern/cards/{alone['id']}/states").json() == {"group_id": None, "main_card_id": None, "states": []}
    listed = {c["id"]: c["state_of"] for c in client.get("/api/tavern/cards").json()}
    assert listed == {main["id"]: None, other["id"]: main["id"], alone["id"]: None}
    assert client.get(f"/api/tavern/cards/{other['id']}").json()["state_of"] == main["id"]


def test_deleting_a_state_card_moves_its_chats_to_the_main_card(client: TestClient, db: Session, make_card, make_debug_chat):
    main, other = make_card(), make_card()
    _group(db, main["id"], other["id"])
    chat = make_debug_chat(card_id=other["id"])
    assert client.delete(f"/api/tavern/cards/{other['id']}").status_code == 204
    assert client.get(f"/api/debug/chats/{chat['id']}").json()["card_id"] == main["id"]
    got = client.get(f"/api/tavern/cards/{main['id']}/states").json()
    assert [s["card_id"] for s in got["states"]] == [main["id"]]


def test_deleting_the_main_card_takes_its_states_along(client: TestClient, db: Session, make_card, make_debug_chat):
    main, other, alone = make_card(), make_card(), make_card()
    _group(db, main["id"], other["id"])
    chat = make_debug_chat(card_id=other["id"])
    assert client.delete(f"/api/tavern/cards/{main['id']}").status_code == 204
    assert [c["id"] for c in client.get("/api/tavern/cards").json()] == [alone["id"]]
    assert client.get(f"/api/debug/chats/{chat['id']}").json()["card_id"] is None
    assert db.query(CardState).count() == 0 and db.query(CardStateGroup).count() == 0


def test_duplicating_a_state_card_gives_an_independent_card(client: TestClient, db: Session, make_card):
    main, other = make_card(), make_card()
    _group(db, main["id"], other["id"])
    copy = client.post(f"/api/tavern/cards/{other['id']}/duplicate", json={}).json()
    assert copy["state_of"] is None
    assert client.get(f"/api/tavern/cards/{copy['id']}/states").json()["group_id"] is None
