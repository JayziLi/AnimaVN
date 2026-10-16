"""导入的曲子:OGG / FLAC / WAV 转成 AAC(m4a),iPhone 的 Safari 才放得了(设计稿 6.3);MP3 / M4A / AAC 原样存。

    path, mime = stored_file(tree, "刻晴/BGM候选/晚安.wav")   # 存进库时用的文件和类型

- compress_bgm 是从 feat/public-v2 的 app/audio.py 搬来的(公网给背景音乐做轻量版的那个),去掉了「转出来必须比原曲小,
  不然照发原曲」:这里转码是为了能放,不是为了省地方。导入用 128 kbps(公网那边 80 kbps 是为了省流量)。
- 没装 PyAV(av)时不转,一律原样存;解不开的(坏文件、只有文件头的)也原样存。
- 查重(classify.py 规则 10)按「存进库的样子」比:要转的曲子出计划时就转好,放在这次导入的暂存目录
  converted/<原件指纹>.m4a,按转好的文件算指纹;执行导入时直接用它,不转第二遍。AAC 编码每次结果一样,
  同一首再导入一次指纹对得上。解不开的记一个 converted/<原件指纹>.keep,不反复试。
"""

from __future__ import annotations

import hashlib
import io
import os
import tempfile
from pathlib import Path

from app.api.scenes import sniff_audio_mime
from app.importer.staging import StagedTree

try:
    import av
except ImportError:  # 没装 PyAV:不转,一律原样存
    av = None

BGM_BITRATE = 80_000  # 公网轻量版的码率(public-v2 原样)
IMPORT_BITRATE = 128_000  # 导入转码的码率
BGM_MIME = "audio/mp4"
# 这几种转成 m4a;别的(MP3 / M4A / AAC)浏览器都能放,原样存
CONVERT = {"audio/ogg", "audio/flac", "audio/wav"}
CONVERTED = "converted"


def available() -> bool:
    return av is not None


def compress_bgm(data: bytes, bitrate: int = BGM_BITRATE) -> bytes | None:
    """转成 AAC 的 m4a(索引在文件头,浏览器下一点就能开始放);解不开、没装 PyAV 时返回 None(照存原曲)"""
    if av is None:
        return None
    # faststart(把索引挪到文件头)要回头改写文件,写不进内存缓冲区:先写临时文件
    fd, path = tempfile.mkstemp(suffix=".m4a")
    os.close(fd)
    try:
        src = av.open(io.BytesIO(data))
        if not src.streams.audio:
            src.close()
            return None
        out = av.open(path, "w", format="mp4", options={"movflags": "faststart"})
        stream = out.add_stream("aac", rate=44100, layout="stereo")
        stream.bit_rate = bitrate
        resampler = av.AudioResampler(format="fltp", layout="stereo", rate=44100)

        def mux(frames) -> None:
            for f in frames:
                for pkt in stream.encode(f):
                    out.mux(pkt)

        for frame in src.decode(audio=0):
            mux(resampler.resample(frame))
        mux(resampler.resample(None))
        for pkt in stream.encode(None):
            out.mux(pkt)
        out.close()
        src.close()
        with open(path, "rb") as f:
            result = f.read()
    except (av.error.FFmpegError, ValueError, OSError):
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:  # Windows 上中途出错时文件可能还被占着;临时目录里留一个也无妨
            pass
    return result or None


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def stored_file(tree: StagedTree, rel: str) -> tuple[Path, str]:
    """暂存的一首曲子存进库时用哪个文件、什么类型:要转的转好(放 converted/,转过一次就直接用),
    不用转、转不了的是原件。不是音频时类型是 application/octet-stream(调用方先按 kind 挑过,不该走到)"""
    source = tree.path(rel)
    with open(source, "rb") as f:
        mime = sniff_audio_mime(f.read(64)) or "application/octet-stream"
    if mime not in CONVERT:
        return source, mime
    folder = tree.dir / CONVERTED
    digest = _sha(source)
    done, keep = folder / f"{digest}.m4a", folder / f"{digest}.keep"
    if done.is_file():
        return done, BGM_MIME
    if keep.is_file() or not available():
        return source, mime
    folder.mkdir(parents=True, exist_ok=True)
    out = compress_bgm(source.read_bytes(), IMPORT_BITRATE)
    if out is None:
        keep.touch()
        return source, mime
    tmp = folder / f"{digest}.m4a.tmp"
    tmp.write_bytes(out)
    os.replace(tmp, done)
    return done, BGM_MIME
