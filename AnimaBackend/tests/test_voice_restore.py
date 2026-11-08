"""第 4 步:声音包恢复(app/bundle/restore.py)。导出 → 解开 → 恢复 → 规范形一样;本机 / 另一台电脑两种挂法。"""

import json
import zipfile
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import bindings
from app.bundle import canon, collect, read, restore, write
from app.db import Base
from app.models import Pairing, PairingRow, TtsConnection, VoiceEmotion, VoiceProfile
from app.storage.blobs import CKPT_MIME, sha_of, store
from tests.bundle_seed import VOICE_FILES, seed, wav


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


def _voice_pack(db, tmp_path, voice_id, name="voice"):
    folder = _unzip(collect.collect_pack(db, "voice", voice_id), tmp_path, name)
    return folder, read.read_pack(folder)


def test_single_voice_pack_round_trip_keeps_fingerprints_and_no_paths(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    local = TtsConnection(name="本机", base_url="http://127.0.0.1:9880")
    db.add(local)
    db.commit()
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    created = restore.restore_pack(db, folder, pack, connection_id=local.id)
    db.commit()
    (vid,) = created.voices
    assert canon.pack_canonical(db, "voice", vid) == canon.pack_canonical(db, "voice", ids["voice"])
    v = db.get(VoiceProfile, vid)
    # 地址是本机也不写路径:SSH 隧道的 127.0.0.1 其实在别的电脑上,念的时候才决定
    assert (v.name, v.connection_id, v.files_at, v.gpt_weights, v.sovits_weights) == ("刻晴声音 2", local.id, "pending", "", "")
    blobs = store()
    assert v.gpt_sha == sha_of(VOICE_FILES["gpt"]) and blobs.path(v.gpt_sha, CKPT_MIME).is_file()
    calm, happy = db.scalars(select(VoiceEmotion).where(VoiceEmotion.profile_id == vid).order_by(VoiceEmotion.sort)).all()
    # 参考音频原样进仓库(不转码)
    assert calm.ref_path == "" and blobs.path(calm.ref_sha, "audio/wav").read_bytes() == VOICE_FILES["calm"]
    assert happy.aux_refs == [] and happy.aux_shas == [sha_of(VOICE_FILES["aux"])]
    assert (calm.label, calm.aliases, calm.prompt_text) == ("平静", ["calm"], "你好")
    assert any("新建声音「刻晴声音 2」(3 段参考 + 2 个模型)→ 语音服务「本机」" in line for line in created.lines)


def test_remote_service_leaves_paths_empty_until_the_files_are_placed(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    created = restore.restore_pack(db, folder, pack)  # 默认第一个 GSV 连接:台式机(10.0.0.2)
    db.commit()
    v = db.get(VoiceProfile, created.voices[0])
    assert (v.connection_id, v.files_at, v.gpt_weights, v.sovits_weights) == (ids["tts"], "pending", "", "")
    assert v.gpt_sha == sha_of(VOICE_FILES["gpt"]) and v.gpt_name == "keqing-e10.ckpt"
    happy = db.scalars(select(VoiceEmotion).where(VoiceEmotion.profile_id == v.id, VoiceEmotion.label == "开心")).one()
    assert happy.ref_path == "" and happy.aux_refs == [] and happy.aux_shas == [sha_of(VOICE_FILES["aux"])]
    assert canon.pack_canonical(db, "voice", v.id) == canon.pack_canonical(db, "voice", ids["voice"])


def test_without_any_service_a_local_one_is_made(db, tmp_path):
    ids = seed(db)
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    db.query(VoiceProfile).delete()
    db.query(TtsConnection).delete()
    db.commit()
    created = restore.restore_pack(db, folder, pack)
    db.commit()
    (cid,) = created.tts_connections
    conn = db.get(TtsConnection, cid)
    assert (conn.name, conn.api_type, conn.base_url) == ("本机 GPT-SoVITS", "gpt_sovits", "http://127.0.0.1:9880")
    assert db.get(VoiceProfile, created.voices[0]).files_at == "pending"
    assert created.as_dict()["tts_connections"] == [cid] and created.as_dict()["voices"] == created.voices


def test_a_chosen_service_that_is_gone_is_refused(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    with pytest.raises(read.BundleError, match="语音服务"):
        restore.restore_pack(db, folder, pack, connection_id="nope")


def test_files_the_pack_did_not_carry_mark_the_voice(db, tmp_path):
    ids = seed(db)
    db.get(VoiceProfile, ids["voice"]).gpt_sha = None
    db.get(VoiceEmotion, ids["calm"]).ref_sha = None
    db.commit()
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    assert restore.voice_counts(pack) == (3, 2, 2)
    created = restore.restore_pack(db, folder, pack)
    db.commit()
    v = db.get(VoiceProfile, created.voices[0])
    assert v.gpt_sha is None and v.gpt_name == "keqing-e10.ckpt" and v.gpt_size == len(VOICE_FILES["gpt"])
    from app.api.voices import files_missing

    assert files_missing(v, db) == 2
    assert any("2 个文件包里没带" in line for line in created.lines)


def test_builtin_voice_pairing_goes_with_a_card_without_sprites(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    bindings.replace(db, ids["lonely"], bindings.VOICE, [ids["voice"]], ids["voice"])
    vp = Pairing(follower="voice", list_ref="builtin", target=ids["voice"], card_id="")
    db.add(vp)
    db.flush()
    db.add(PairingRow(pairing_id=vp.id, item="开心", value=ids["happy"], source="name"))
    db.commit()
    before = canon.canonical(db, ids["lonely"])
    assert any(p[:2] == ["voice", "builtin"] for p in before["pairings"])
    folder = _unzip(collect.collect_card(db, ids["lonely"]), tmp_path)
    m = json.loads((folder / "animavn.json").read_text("utf-8"))
    assert [p["list"] for p in m["pairings"]] == ["builtin"]
    created = restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=True)
    db.commit()
    assert canon.canonical(db, created.main_card) == before


# ── 导入去重:文件完全一样的声音用已有那条 ──


def _import_twice(db, tmp_path, ids):
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    return folder, pack, restore.restore_pack(db, folder, pack)


def test_importing_the_same_voice_reuses_the_existing_one(db, tmp_path):
    ids = seed(db)
    folder, pack, created = _import_twice(db, tmp_path, ids)
    db.commit()
    assert created.voices == []
    assert db.query(VoiceProfile).count() == 1
    assert any("已经有了" in line for line in created.lines)


def test_a_card_bundle_with_a_known_voice_binds_and_pairs_to_the_existing_ids(db, tmp_path):
    ids = seed(db)
    folder = _unzip(collect.collect_card(db, ids["main"]), tmp_path)
    created = restore.restore_bundle(db, folder, read.read_manifest(folder), with_preset=True)
    db.commit()
    assert created.voices == [] and db.query(VoiceProfile).count() == 1
    new_card = created.main_card
    assert bindings.targets(db, new_card, bindings.VOICE) == [ids["voice"]]
    new_sprites = bindings.targets(db, new_card, bindings.SPRITE)
    pairs = db.scalars(select(Pairing).where(Pairing.follower == "voice", Pairing.target == ids["voice"])).all()
    assert any(p.list_ref == f"pack:{new_sprites[0]}" for p in pairs)
    emotion_ids = {e.id for e in db.scalars(select(VoiceEmotion))}
    for p in pairs:
        for r in db.scalars(select(PairingRow).where(PairingRow.pairing_id == p.id)):
            assert r.value is None or r.value in emotion_ids


def test_a_changed_reference_makes_a_new_voice(db, tmp_path):
    ids = seed(db)
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    calm = next(i for i in pack["items"] if i.get("label") == "平静")
    (folder / calm["file"]).write_bytes(wav("换了"))
    created = restore.restore_pack(db, folder, pack)
    db.commit()
    assert len(created.voices) == 1
    assert db.get(VoiceProfile, created.voices[0]).name == "刻晴声音 2"


def test_a_pack_without_files_is_never_a_duplicate(db, tmp_path):
    ids = seed(db)
    db.get(VoiceProfile, ids["voice"]).gpt_sha = None
    db.get(VoiceProfile, ids["voice"]).sovits_sha = None
    for e in db.scalars(select(VoiceEmotion)):
        e.ref_sha = None
        e.aux_shas = []
    db.commit()
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    created = restore.restore_pack(db, folder, pack)
    db.commit()
    assert len(created.voices) == 1 and db.query(VoiceProfile).count() == 2


def _add_conn(db, name, api_type, url):
    conn = TtsConnection(name=name, api_type=api_type, base_url=url)
    db.add(conn)
    db.commit()
    return conn


def test_a_gsv_pack_chosen_onto_fish_goes_there_and_keeps_its_models(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    fish = _add_conn(db, "鱼", "fish", "https://api.fish.audio")
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    created = restore.restore_pack(db, folder, pack, connection_id=fish.id)
    db.commit()
    v = db.get(VoiceProfile, created.voices[0])
    assert v.connection_id == fish.id and v.gpt_sha == sha_of(VOICE_FILES["gpt"])  # 模型留着,以后能改挂
    assert any("语音服务「鱼」" in line for line in created.lines)
    assert created.tts_connections == []


def test_a_gsv_pack_onto_indextts_uses_the_first_reference_as_the_speaker(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    idx = _add_conn(db, "索引", "indextts", "http://127.0.0.1:9890")
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    v = db.get(VoiceProfile, restore.restore_pack(db, folder, pack, connection_id=idx.id).voices[0])
    assert v.connection_id == idx.id and v.speaker_sha == sha_of(VOICE_FILES["calm"])


def test_a_relay_connection_cannot_take_a_gsv_pack(db, tmp_path, no_voice_dedupe):
    ids = seed(db)
    relay = _add_conn(db, "中转", "openai", "http://x/v1")
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    assert restore.voice_fits(pack, "openai") == (False, "用不上:只认音色名")
    v = db.get(VoiceProfile, restore.restore_pack(db, folder, pack, connection_id=relay.id).voices[0])
    assert v.connection_id == ids["tts"]  # 选的挂不上:回到同引擎的默认那条


def test_fits_rules():
    head = {"engine": "gpt_sovits", "models": {"gpt": {"file": "a"}, "sovits": {"file": "b"}}}
    pack = {"pack": head, "items": [{"file": "r", "prompt_text": "你好"}]}
    assert restore.voice_fits(pack, "gpt_sovits") == (True, "")
    assert restore.voice_fits(pack, "fish") == (True, "只用参考音频克隆,没那么像")
    assert restore.voice_fits(pack, "indextts") == (True, "只用参考音频")
    refs_only = {"pack": {"engine": "indextts"}, "items": [{"file": "r", "prompt_text": "你好"}]}
    assert restore.voice_fits(refs_only, "gpt_sovits") == (False, "没有模型")
    assert restore.voice_fits(refs_only, "fish") == (True, "用参考音频克隆")
    no_text = {"pack": {"engine": "indextts", "speaker_ref": "s"}, "items": [{"file": "r"}]}
    assert restore.voice_fits(no_text, "fish") == (False, "没有参考音频")
    relay = {"pack": {"engine": "openai"}, "items": []}
    assert restore.voice_fits(relay, "fish")[0] is False and restore.voice_fits(relay, "openai") == (True, "")


def test_reimporting_onto_the_same_other_engine_is_a_duplicate(db, tmp_path):
    ids = seed(db)
    fish = _add_conn(db, "鱼", "fish", "https://api.fish.audio")
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    first = restore.restore_pack(db, folder, pack, connection_id=fish.id)
    db.commit()
    assert len(first.voices) == 1
    again = restore.restore_pack(db, folder, pack, connection_id=fish.id)
    assert again.voices == [] and any("已经有了" in line for line in again.lines)


def test_relay_and_fish_voices_get_an_empty_connection_when_none_exists(db, tmp_path, no_voice_dedupe):
    from app.models import VoiceProfile

    ids = seed(db)
    folder, pack = _voice_pack(db, tmp_path, ids["voice"])
    for engine, name, url in (("openai", "中转站", ""), ("fish", "Fish Audio", "https://api.fish.audio")):
        pack["pack"]["engine"] = engine
        pack["pack"]["params"] = {"voice": "alloy"}
        created = restore.restore_pack(db, folder, pack)
        db.commit()
        (vid,) = created.voices
        v = db.get(VoiceProfile, vid)
        conn = db.get(TtsConnection, v.connection_id)
        assert (conn.api_type, conn.name, conn.base_url) == (engine, name, url)
        assert (conn.options or {}).get("api_key") is None
        assert v.params == {"voice": "alloy"}
        assert created.tts_connections == [conn.id]
