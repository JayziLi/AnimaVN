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
from tests.bundle_seed import VOICE_FILES, seed


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


def test_single_voice_pack_round_trip_on_a_local_service_points_at_the_store(db, tmp_path):
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
    assert (v.name, v.connection_id, v.files_at) == ("刻晴声音 2", local.id, "local")
    blobs = store()
    assert v.gpt_weights == str(blobs.path(sha_of(VOICE_FILES["gpt"]), CKPT_MIME).resolve())
    assert v.gpt_weights.endswith(".ckpt") and v.sovits_weights.endswith(".pth")
    calm, happy = db.scalars(select(VoiceEmotion).where(VoiceEmotion.profile_id == vid).order_by(VoiceEmotion.sort)).all()
    # 参考音频原样进仓库(不转码),路径就是仓库里那个文件
    assert calm.ref_path.endswith(".wav") and open(calm.ref_path, "rb").read() == VOICE_FILES["calm"]
    assert happy.aux_refs == [str(blobs.path(sha_of(VOICE_FILES["aux"]), "audio/wav").resolve())]
    assert (calm.label, calm.aliases, calm.prompt_text) == ("平静", ["calm"], "你好")
    assert any("新建声音「刻晴声音 2」(3 段参考 + 2 个模型)→ 语音服务「本机」" in line for line in created.lines)


def test_remote_service_leaves_paths_empty_until_the_files_are_placed(db, tmp_path):
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
    assert any("另一台电脑" in line for line in created.lines)


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
    assert db.get(VoiceProfile, created.voices[0]).files_at == "local"
    assert created.as_dict()["tts_connections"] == [cid] and created.as_dict()["voices"] == created.voices


def test_a_chosen_service_that_is_gone_is_refused(db, tmp_path):
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


def test_builtin_voice_pairing_goes_with_a_card_without_sprites(db, tmp_path):
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
