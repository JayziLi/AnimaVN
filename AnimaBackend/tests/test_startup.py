import importlib
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base

db_module = importlib.import_module("app.db")
main_module = importlib.import_module("app.main")


@pytest.fixture
def start_app(monkeypatch) -> Iterator[Callable[[], TestClient]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    monkeypatch.setattr(main_module, "engine", engine)
    monkeypatch.setattr(main_module, "SessionLocal", testing_session)
    monkeypatch.setattr(db_module, "SessionLocal", testing_session)
    monkeypatch.setattr(main_module.settings, "anthropic_api_key", None)
    monkeypatch.setattr(main_module.settings, "openai_api_key", None)
    monkeypatch.setattr(main_module.settings, "openai_base_url", None)
    # 自带角色有立绘,预转 WebP 的后台线程会在测试拆掉内存库之后还在读它
    monkeypatch.setattr(main_module, "prewarm", lambda session_factory: None)
    main_module.app.dependency_overrides.clear()

    yield lambda: TestClient(main_module.app)

    main_module.app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def snapshot(client: TestClient) -> dict:
    return {
        "personas": client.get("/api/personas").json(),
        "connections": client.get("/api/connections").json(),
        "cards": client.get("/api/tavern/cards").json(),
        "presets": client.get("/api/tavern/presets").json(),
    }


def test_first_start_seeds_every_resource_needed_for_offline_use(start_app):
    with start_app() as client:
        data = snapshot(client)
        health = client.get("/api/health")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert [(item["name"], item["is_active"]) for item in data["personas"]] == [
        ("旅行者", True)
    ]
    assert [item["name"] for item in data["connections"]] == ["Mock（本地测试）"]
    assert data["connections"][0]["is_active"] is True
    assert data["connections"][0]["model"] == "mock"
    assert [item["name"] for item in data["cards"]] == ["DeepSeek娘"]
    assert data["cards"][0]["has_avatar"] is True
    assert [item["name"] for item in data["presets"]] == ["默认预设"]


def test_bundled_card_comes_with_its_sprite_pack(start_app):
    with start_app() as client:
        card = client.get("/api/tavern/cards").json()[0]
        bound = client.get(f"/api/tavern/cards/{card['id']}/sprite-packs").json()
        packs = client.get("/api/sprite-packs").json()
        sprites = client.get(f"/api/tavern/cards/{card['id']}/sprites").json()
        image = client.get(f"/api/sprite-packs/{bound['current']}/sprites/{sprites[0]['id']}/image")
        preset = client.get("/api/tavern/presets").json()[0]

    assert [(p["name"], p["sprite_count"], p["card_count"]) for p in packs] == [
        ("DeepSeek娘 · 女仆", 16, 1)
    ]
    assert bound["pack_ids"] == [packs[0]["id"]]
    assert bound["current"] == packs[0]["id"]
    # 排第一的是默认表情;脸的位置随包带着,首启不用再找
    assert sprites[0]["label"] == "微笑"
    assert all(s["face_scan"] and s["face_scan"].get("face") for s in sprites)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/webp"
    # 默认预设带着世界书和立绘指令,自带角色开箱就能换表情
    enabled = [o["identifier"] for o in preset["prompt_order"][0]["order"] if o["enabled"]]
    assert {"worldInfoBefore", "worldInfoAfter", "anima_sprite"} <= set(enabled)


def test_restarting_app_is_idempotent_and_preserves_user_edits(start_app):
    with start_app() as client:
        first = snapshot(client)
        persona_id = first["personas"][0]["id"]
        response = client.patch(
            f"/api/personas/{persona_id}", json={"description": "用户修改后的描述"}
        )
        assert response.status_code == 200

    with start_app() as client:
        second = snapshot(client)

    assert {key: len(value) for key, value in second.items()} == {
        "personas": 1,
        "connections": 1,
        "cards": 1,
        "presets": 1,
    }
    assert second["personas"][0]["id"] == persona_id
    assert second["personas"][0]["description"] == "用户修改后的描述"


def test_environment_connections_are_seeded_once_and_real_connection_is_preferred(
    start_app, monkeypatch
):
    monkeypatch.setattr(main_module.settings, "anthropic_api_key", "anthropic-test-key")
    monkeypatch.setattr(main_module.settings, "openai_api_key", "openai-test-key")
    monkeypatch.setattr(main_module.settings, "openai_base_url", "https://relay.test/v1")

    with start_app() as client:
        first = client.get("/api/connections").json()
    with start_app() as client:
        second = client.get("/api/connections").json()

    assert [item["name"] for item in first] == [
        "Mock（本地测试）",
        "Anthropic（来自 .env）",
        "OpenAI（来自 .env）",
    ]
    assert [item["id"] for item in second] == [item["id"] for item in first]
    assert [item["name"] for item in first if item["is_active"]] == ["OpenAI（来自 .env）"]
    assert first[-1]["base_url"] == "https://relay.test/v1"
    assert all(item["has_api_key"] for item in first[1:])
    assert "anthropic-test-key" not in str(first)
    assert "openai-test-key" not in str(first)


def test_deleted_bundled_card_is_recreated_without_overwriting_existing_preset(start_app):
    with start_app() as client:
        card = client.get("/api/tavern/cards").json()[0]
        preset = client.get("/api/tavern/presets").json()[0]
        assert client.delete(f"/api/tavern/cards/{card['id']}").status_code == 204

    with start_app() as client:
        cards = client.get("/api/tavern/cards").json()
        presets = client.get("/api/tavern/presets").json()

    assert len(cards) == 1
    assert cards[0]["name"] == "DeepSeek娘"
    assert cards[0]["id"] != card["id"]
    assert len(presets) == 1
    assert presets[0]["id"] == preset["id"]


def test_recreated_bundled_card_reuses_the_existing_sprite_pack(start_app):
    with start_app() as client:
        card = client.get("/api/tavern/cards").json()[0]
        pack = client.get("/api/sprite-packs").json()[0]
        assert client.delete(f"/api/tavern/cards/{card['id']}").status_code == 204

    with start_app() as client:
        new_card = client.get("/api/tavern/cards").json()[0]
        packs = client.get("/api/sprite-packs").json()
        bound = client.get(f"/api/tavern/cards/{new_card['id']}/sprite-packs").json()

    assert [p["id"] for p in packs] == [pack["id"]]
    assert bound["current"] == pack["id"]
