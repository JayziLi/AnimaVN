"""第 4 步 B2:导出前把声音的文件拉进文件仓库(app/tts/files.py)。语音机一律是假的(httpx MockTransport)。

- 仓库里按指纹已经有的不再拉;没有的经语音机的只读口 /anima/ref 拉,流式写进仓库(模型几百 MB),存成带扩展名的文件
- 同一个路径只拉一次;同时最多 4 个;单个超时 60 秒(连接 5 秒)
- 拉不到的(语音机关着、旧脚本没有这个口、路径不让读)算缺的,不报错
"""

import asyncio
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Blob, TtsConnection, VoiceEmotion, VoiceProfile
from app.storage import blobs
from app.tts import files as voice_files
from app.tts.base import TTSError
from app.tts.http import download_reference


class FakeVoiceMachine:
    """台式机上的 GSV + 只读口:files 里有的路径回内容;forbidden 里的回 403(旧脚本不让读 G 盘、模型);
    no_route = 旧版脚本(没有 /anima/ref);down = 关机"""

    def __init__(self, files: dict[str, bytes]):
        self.files = files
        self.forbidden: set[str] = set()
        self.no_route = False
        self.down = False
        self.requests: list[str] = []
        self.ref_hits = 0
        self.timeouts: list = []
        self.active = 0
        self.peak = 0

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectTimeout("down")
        if request.url.path == "/docs":
            return httpx.Response(200, text="docs")
        if request.url.path == "/anima/ref":
            self.ref_hits += 1
        if request.url.path == "/anima/ref" and not self.no_route:
            path = request.url.params["path"]
            self.requests.append(path)
            self.active += 1
            self.peak = max(self.peak, self.active)
            try:
                await asyncio.sleep(0.01)
            finally:
                self.active -= 1
            if path in self.forbidden:
                return httpx.Response(403, json={"detail": "路径不在允许的目录里"})
            if path not in self.files:
                return httpx.Response(404, json={"detail": "文件不存在"})
            return httpx.Response(200, headers={"content-type": "application/octet-stream"}, content=self.files[path])
        return httpx.Response(404, json={"detail": "Not Found"})


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


def _machine(monkeypatch, files: dict[str, bytes]) -> FakeVoiceMachine:
    from app.tts.registry import reset_engines

    fake = FakeVoiceMachine(files)

    def make(base_url, timeout):
        fake.timeouts.append(timeout)
        return httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))

    monkeypatch.setattr("app.tts.gpt_sovits.make_tts_client", make)
    reset_engines()
    return fake


GPT, SOVITS = "G:/AnimaVoice/models/刻晴_ja/刻晴_JA-e10.ckpt", "G:/AnimaVoice/models/刻晴_ja/刻晴_JA_e10_s460_l32.pth"
CALM, HAPPY, AUX = (
    "D:/AnimaVoice/refs/刻晴_ja/【平静】今日も.wav",
    "D:/AnimaVoice/refs/刻晴_ja/【开心】やった.wav",
    "D:/AnimaVoice/refs/刻晴_ja/aux.wav",
)


def _voice(db: Session) -> VoiceProfile:
    db.add(TtsConnection(id="c1", name="5090", base_url="http://gpu-box.test:9880"))
    p = VoiceProfile(id="v1", name="刻晴(日语)", connection_id="c1", gpt_weights=GPT, sovits_weights=SOVITS, text_lang="ja")
    db.add(p)
    db.add_all(
        [
            VoiceEmotion(id="e1", profile_id="v1", label="平静", ref_path=CALM, prompt_text="今日も", sort=0),
            # 辅助参考和别的情绪的主参考是同一个文件:只拉一次
            VoiceEmotion(id="e2", profile_id="v1", label="开心", ref_path=HAPPY, prompt_text="やった", aux_refs=[AUX, CALM], sort=1),
        ]
    )
    db.commit()
    return p


FILES = {GPT: b"gpt" * 1000, SOVITS: b"sovits" * 1000, CALM: b"RIFFcalm", HAPPY: b"RIFFhappy", AUX: b"RIFFaux"}


def test_download_reference_streams_into_a_file(tmp_path: Path):
    async def handler(request):
        return httpx.Response(200, content=b"x" * 300_000)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await download_reference(client, "http://gsv", "GPT-SoVITS", "D:/a.ckpt", tmp_path / "a.part")

    size = asyncio.run(run())
    assert size == 300_000 and (tmp_path / "a.part").read_bytes() == b"x" * 300_000

    async def refused(request):
        return httpx.Response(403, json={"detail": "路径不在允许的目录里"})

    async def run_refused():
        async with httpx.AsyncClient(transport=httpx.MockTransport(refused)) as client:
            return await download_reference(client, "http://gsv", "GPT-SoVITS", "G:/a.ckpt", tmp_path / "b.part")

    with pytest.raises(TTSError) as e:
        asyncio.run(run_refused())
    assert e.value.status == 403 and "允许" in e.value.message
    assert not (tmp_path / "b.part").exists()


def test_prefetch_pulls_each_file_once_into_the_store_with_extensions(db: Session, monkeypatch):
    fake = _machine(monkeypatch, FILES)
    _voice(db)
    missing = asyncio.run(voice_files.prefetch_voice_files(db, ["v1"]))
    assert missing == {"v1": 0}
    assert sorted(fake.requests) == sorted(FILES)  # CALM 只拉一次
    store = blobs.store()
    p = db.get(VoiceProfile, "v1")
    assert p.gpt_sha == blobs.sha_of(FILES[GPT]) and p.gpt_size == len(FILES[GPT]) and p.gpt_name == "刻晴_JA-e10.ckpt"
    assert p.sovits_name == "刻晴_JA_e10_s460_l32.pth" and p.sovits_size == len(FILES[SOVITS])
    assert store.path(p.gpt_sha, blobs.CKPT_MIME).read_bytes() == FILES[GPT]
    assert store.path(p.sovits_sha, blobs.PTH_MIME).suffix == ".pth"
    e2 = db.get(VoiceEmotion, "e2")
    assert e2.ref_sha == blobs.sha_of(FILES[HAPPY])
    assert e2.aux_shas == [blobs.sha_of(FILES[AUX]), blobs.sha_of(FILES[CALM])]
    assert store.path(e2.ref_sha, "audio/wav").read_bytes() == FILES[HAPPY]
    assert db.get(Blob, p.gpt_sha).mime == blobs.CKPT_MIME
    # 路径、老声音的设置不动
    assert (p.gpt_weights, p.files_at, e2.ref_path) == (GPT, "manual", HAPPY)
    # 单个 60 秒、连接 5 秒;同时最多 4 个
    t = fake.timeouts[-1]
    assert isinstance(t, httpx.Timeout) and t.read == 60.0 and t.connect == 5.0
    assert fake.peak <= 4

    fake.requests.clear()
    assert asyncio.run(voice_files.prefetch_voice_files(db, ["v1"])) == {"v1": 0}
    assert fake.requests == []  # 仓库里按指纹有就用


def test_prefetch_counts_what_the_machine_will_not_give(db: Session, monkeypatch):
    fake = _machine(monkeypatch, FILES)
    fake.forbidden = {GPT, SOVITS}  # 旧脚本:只给 D 盘、只给音频
    _voice(db)
    assert asyncio.run(voice_files.prefetch_voice_files(db, ["v1"])) == {"v1": 2}
    p = db.get(VoiceProfile, "v1")
    assert p.gpt_sha is None and p.sovits_sha is None
    assert db.get(VoiceEmotion, "e1").ref_sha == blobs.sha_of(FILES[CALM])


def test_prefetch_gives_up_quietly_when_the_machine_is_off_or_old(db: Session, monkeypatch):
    fake = _machine(monkeypatch, FILES)
    fake.down = True
    _voice(db)
    # 5 个文件(平静的参考也是开心的辅助参考,算一个)
    assert asyncio.run(voice_files.prefetch_voice_files(db, ["v1"])) == {"v1": 5}
    assert fake.ref_hits == 0

    fake.down, fake.no_route = False, True
    assert asyncio.run(voice_files.prefetch_voice_files(db, ["v1"])) == {"v1": 5}
    # 旧脚本没有只读口:头一批碰了壁就不再试
    assert 1 <= fake.ref_hits <= 4


def test_rows_without_a_path_are_not_files_and_unknown_voices_are_skipped(db: Session, monkeypatch):
    _machine(monkeypatch, FILES)
    db.add(TtsConnection(id="c1", name="5090", base_url="http://gpu-box.test:9880"))
    db.add(VoiceProfile(id="v2", name="空的", connection_id="c1"))
    db.add(VoiceEmotion(id="e9", profile_id="v2", label="平静", ref_path="", prompt_text=""))
    db.commit()
    assert asyncio.run(voice_files.prefetch_voice_files(db, ["v2", "nope"])) == {"v2": 0}
