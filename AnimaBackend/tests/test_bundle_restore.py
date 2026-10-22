"""角色包恢复(第 3 步 A2):读清单、校验(app/bundle/read.py),照清单建新行、全部换新编号(restore.py)。

A1 那个库导出 → 解开 → 恢复进同一个库 → 用「去掉编号和名字后缀的规范形」(app/bundle/canon.py)比较原卡组和新卡组。
"""

import json
import zipfile
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings
from app.bundle import canon, collect, read, restore, write
from app.db import Base
from app.models import (
    AppSetting,
    CardState,
    CgPack,
    PackSprite,
    PromptPreset,
    ScenePack,
    SpritePack,
    TavernCard,
    VoiceProfile,
    WordRecord,
)
from tests.bundle_seed import seed


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _unzip(archive, tmp_path, name="out"):
    path = tmp_path / f"{name}.zip"
    write.write_zip(archive, path)
    folder = tmp_path / name
    with zipfile.ZipFile(path) as zf:
        zf.extractall(folder)
    return folder


def test_round_trip_into_the_same_library_is_identical_up_to_ids_and_name_suffixes(db, tmp_path):
    ids = seed(db)
    before = canon.canonical(db, ids["main"])
    folder = _unzip(collect.collect_card(db, ids["main"], exclude=[], with_preset=True), tmp_path)
    manifest = read.read_manifest(folder)
    created = restore.restore_bundle(db, folder, manifest, with_preset=True)
    db.commit()

    assert len(created.cards) == 2 and len(created.sprite_packs) == 1 and len(created.scene_packs) == 1
    assert len(created.cg_packs) == 1 and len(created.presets) == 1 and len(created.state_groups) == 1
    assert set(created.cards).isdisjoint({ids["main"], ids["state"]})
    new_main = created.main_card
    after = canon.canonical(db, new_main)
    assert after == before

    # 名字撞了接「 2」;同一组的两张卡都叫「刻晴 2」
    assert [db.get(TavernCard, c).name for c in created.cards] == ["刻晴 2", "刻晴 2"]
    assert db.get(SpritePack, created.sprite_packs[0]).name == "刻晴 · 玉衡星 2"
    assert db.get(PromptPreset, created.presets[0]).name == "刻晴 DeepSeek 2"
    # 小记号不留在库里
    assert "animavn" not in db.get(TavernCard, new_main).extensions
    # 预设绑到新卡,原来的绑定不动
    cards = db.get(AppSetting, "preset.bindings").value["cards"]
    assert cards[new_main] == created.presets[0] and cards[created.cards[1]] == created.presets[0]
    assert cards[ids["main"]] == ids["preset"]
    # 旧绑定表也写了一份
    assert bindings.primary(db, new_main, bindings.SPRITE) == created.sprite_packs[0]
    # 声音也另建了一个,绑成新卡的主声音(第 4 步);语音服务在另一台电脑:路径空着、等放过去
    assert len(created.voices) == 1 and created.voices[0] != ids["voice"]
    assert bindings.primary(db, new_main, bindings.VOICE) == created.voices[0]
    voice = db.get(VoiceProfile, created.voices[0])
    assert voice.name == "刻晴声音 2" and voice.connection_id == ids["tts"] and voice.files_at == "pending"
    assert voice.gpt_weights == "" and voice.gpt_sha == db.get(VoiceProfile, ids["voice"]).gpt_sha


def test_round_trip_twice_counts_names_up(db, tmp_path):
    ids = seed(db)
    for i in range(2):
        folder = _unzip(collect.collect_card(db, ids["main"], exclude=[], with_preset=False), tmp_path, f"b{i}")
        created = restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=False)
        db.commit()
        assert created.presets == []
    names = sorted(db.scalars(select(SpritePack.name)).all())
    assert names == ["刻晴 · 玉衡星", "刻晴 · 玉衡星 2", "刻晴 · 玉衡星 3"]
    assert db.scalar(select(func.count()).select_from(PromptPreset)) == 2


def test_exported_without_some_packs_restores_without_them(db, tmp_path):
    ids = seed(db)
    before = canon.canonical(db, ids["main"], exclude={f"cg:{ids['cg_pack']}"})
    folder = _unzip(collect.collect_card(db, ids["main"], exclude=[f"cg:{ids['cg_pack']}"], with_preset=True), tmp_path)
    created = restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=True)
    db.commit()
    assert created.cg_packs == []
    assert canon.canonical(db, created.main_card) == before


def test_restore_single_pack_with_word_records(db, tmp_path):
    ids = seed(db)
    before = canon.pack_canonical(db, "scene", ids["scene_pack"])
    folder = _unzip(collect.collect_pack(db, "scene", ids["scene_pack"]), tmp_path)
    created = restore.restore_pack(db, folder, read.read_pack(folder))
    db.commit()
    assert len(created.scene_packs) == 1
    assert canon.pack_canonical(db, "scene", created.scene_packs[0]) == before

    folder = _unzip(collect.collect_pack(db, "sprite", ids["sprite_pack"]), tmp_path, "sp")
    created = restore.restore_pack(db, folder, read.read_pack(folder))
    db.commit()
    new = created.sprite_packs[0]
    assert canon.pack_canonical(db, "sprite", new) == canon.pack_canonical(db, "sprite", ids["sprite_pack"])
    rec = db.scalar(select(WordRecord).where(WordRecord.list_ref == f"pack:{new}"))
    assert rec.word == "开心" and db.get(PackSprite, rec.item).label == "微笑" and rec.item != ids["s1"]


def test_builtin_word_records_only_fill_gaps(db, tmp_path):
    ids = seed(db)
    db.add(WordRecord(list_ref="builtin", word="笑嘻嘻", item="开心", source="model"))
    db.commit()
    folder = _unzip(collect.collect_card(db, ids["lonely"], exclude=[], with_preset=True), tmp_path)
    m = json.loads((folder / "animavn.json").read_text("utf-8"))
    m["word_records"].append({"list": "builtin", "word": "哼", "item": "生气", "source": "model", "guessed": False,
                              "unstable": False, "score": None})
    (folder / "animavn.json").write_text(json.dumps(m, ensure_ascii=False), "utf-8")
    created = restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=True)
    db.commit()
    assert db.scalar(select(func.count()).select_from(WordRecord).where(WordRecord.list_ref == "builtin")) == 2
    assert len(created.word_records) == 1
    assert db.get(TavernCard, created.main_card).name == "路人 2"
    assert db.get(CardState, created.main_card) is None


# ── 校验 ──


def _bundle_folder(db, tmp_path):
    ids = seed(db)
    return _unzip(collect.collect_card(db, ids["main"], exclude=[], with_preset=True), tmp_path), ids


def _edit(folder, fn):
    m = json.loads((folder / "animavn.json").read_text("utf-8"))
    fn(m)
    (folder / "animavn.json").write_text(json.dumps(m, ensure_ascii=False), "utf-8")


@pytest.mark.parametrize(
    "change, message",
    [
        (lambda m: m.update(format="other"), "不是 AnimaVN 角色包"),
        (lambda m: m.update(version=2), "新版"),
        (lambda m: m["cards"][0].update(file="../../evil.json"), "路径不安全"),
        (lambda m: m["cards"][0].update(file="C:/evil.json"), "路径不安全"),
        (lambda m: m["cards"][0].update(avatar="assets/missing.png"), "缺文件"),
        (lambda m: m.update(main_card="nope"), "主卡"),
        (lambda m: m["packs"][0].update(kind="music"), "不认识"),
    ],
)
def test_bad_manifests_are_refused(db, tmp_path, change, message):
    folder, _ = _bundle_folder(db, tmp_path)
    _edit(folder, change)
    with pytest.raises(read.BundleError, match=message):
        read.read_manifest(folder)


def test_a_pack_item_pointing_at_a_missing_file_is_refused(db, tmp_path):
    folder, ids = _bundle_folder(db, tmp_path)
    pack = folder / "packs" / ids["sprite_pack"] / "pack.json"
    data = json.loads(pack.read_text("utf-8"))
    data["items"][0]["file"] = "assets/" + "0" * 64 + ".png"
    pack.write_text(json.dumps(data), "utf-8")
    with pytest.raises(read.BundleError, match="缺文件"):
        read.read_manifest(folder)


def test_nothing_is_written_when_restore_fails_halfway(db, tmp_path):
    folder, ids = _bundle_folder(db, tmp_path)
    counts = {m: db.scalar(select(func.count()).select_from(m)) for m in (TavernCard, SpritePack, ScenePack, CgPack)}
    manifest = read.read_manifest(folder)
    manifest.data["state_group"]["states"][0]["card"] = "missing-card"
    with pytest.raises(read.BundleError):
        restore.restore_bundle(db, folder, manifest, with_preset=True)
    db.rollback()
    assert counts == {m: db.scalar(select(func.count()).select_from(m)) for m in (TavernCard, SpritePack, ScenePack, CgPack)}


@pytest.mark.parametrize("what", ["effect", "parts", "pairing", "pref", "avatar"])
def test_the_canonical_form_notices_a_difference(db, tmp_path, what):
    """规范形别比得太松:导回来以后改一处,就对不上"""
    from app.models import AssetBinding, CardPref, PairingRow

    ids = seed(db)
    before = canon.canonical(db, ids["main"])
    folder = _unzip(collect.collect_card(db, ids["main"], exclude=[], with_preset=True), tmp_path)
    created = restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=True)
    db.commit()
    new = created.main_card
    if what == "effect":
        row = db.scalar(select(PackSprite).where(PackSprite.pack_id == created.sprite_packs[0], PackSprite.label == "微笑"))
        row.effect = {"motion": "shake", "bubble": None, "sound": None}
    elif what == "parts":
        db.scalar(select(AssetBinding).where(AssetBinding.card_id == new, AssetBinding.kind == "scene")).parts = "bg"
    elif what == "pairing":
        cell = db.scalar(select(PairingRow).where(PairingRow.value.is_not(None), PairingRow.item.not_in([ids["s1"], ids["s2"]])))
        cell.value = None
    elif what == "pref":
        db.get(CardPref, (new, "plugin.imagegen")).value = {"look": "blue hair"}
    elif what == "avatar":
        from tests.bundle_seed import data_url, png

        db.get(TavernCard, new).avatar = data_url(png("别的"))
    db.commit()
    assert canon.canonical(db, new) != before
