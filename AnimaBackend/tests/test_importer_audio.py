"""导入的曲子(app/importer/audio.py):OGG / FLAC / WAV 装了 PyAV 时转成 AAC(m4a),MP3 / M4A / AAC 原样存;
转好的放在暂存目录里,出计划(查重)和执行导入用同一份。"""

import io
import math
import struct
import wave

import pytest

from app.api.scenes import sniff_audio_mime
from app.importer import audio
from app.importer.staging import stage


def real_wav(seconds: float = 0.3, freq: float = 440.0, rate: int = 22050) -> bytes:
    """一段真的能解开的 WAV(单声道 16 位)"""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(rate * seconds)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n)))
    return buf.getvalue()


MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(64)
BROKEN_WAV = b"RIFF\x00\x00\x00\x00WAVEfmt " + bytes(16)


@pytest.fixture
def tree(tmp_path):
    return stage(
        [("bgm/晚安.wav", real_wav()), ("bgm/日常.mp3", MP3), ("bgm/坏的.wav", BROKEN_WAV)],
        tmp_path / "staging",
    )


def test_compress_bgm_makes_an_aac_m4a_even_when_it_is_bigger():
    av = pytest.importorskip("av")
    original = real_wav(seconds=0.05)
    out = audio.compress_bgm(original)
    assert out is not None and sniff_audio_mime(out) == "audio/mp4"
    with av.open(io.BytesIO(out)) as c:
        assert c.streams.audio[0].codec_context.name == "aac"
    assert out.find(b"moov") < out.find(b"mdat")  # 索引在前:浏览器下一点就能开始放
    assert audio.compress_bgm(b"not audio") is None
    assert audio.compress_bgm(BROKEN_WAV) is None


def test_wav_is_converted_and_the_result_is_cached_in_the_staging_folder(tree):
    pytest.importorskip("av")
    path, mime = audio.stored_file(tree, "bgm/晚安.wav")
    assert mime == "audio/mp4" and path.parent == tree.dir / "converted"
    first = path.read_bytes()
    assert sniff_audio_mime(first) == "audio/mp4"
    # 再要一次不重转:同一个文件
    again, _ = audio.stored_file(tree, "bgm/晚安.wav")
    assert again == path and again.read_bytes() == first


def test_conversion_is_deterministic_so_repeat_imports_hash_the_same(tmp_path):
    pytest.importorskip("av")
    data = real_wav()
    a = audio.compress_bgm(data, audio.IMPORT_BITRATE)
    b = audio.compress_bgm(data, audio.IMPORT_BITRATE)
    assert a == b


def test_mp3_and_undecodable_files_are_stored_as_they_are(tree):
    path, mime = audio.stored_file(tree, "bgm/日常.mp3")
    assert (path, mime) == (tree.path("bgm/日常.mp3"), "audio/mpeg")
    path, mime = audio.stored_file(tree, "bgm/坏的.wav")
    assert (path, mime) == (tree.path("bgm/坏的.wav"), "audio/wav")


def test_without_pyav_nothing_is_converted(tree, monkeypatch):
    monkeypatch.setattr(audio, "av", None)
    assert not audio.available()
    path, mime = audio.stored_file(tree, "bgm/晚安.wav")
    assert (path, mime) == (tree.path("bgm/晚安.wav"), "audio/wav")
