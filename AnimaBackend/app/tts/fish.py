"""Fish Audio 适配器(官方 API 或自己搭的兼容服务)。云端服务,没有权重要切、没有锁:一次一句各走各的。

- POST {base}/v1/tts,msgpack 请求体,头里带 model(默认 drama-3);参考音频的字节由这里读本机文件
  (delivery.localize 已把 blob:<指纹> 换成文件仓库里的路径)
- 官方 API 流式出的 WAV,头里 RIFF / data 长度是占位值,按实际字节数改回去(docs/voice-server.md「Fish Audio 官方 API」)
- 报错显示服务回的原文
"""

import asyncio
import struct
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.tts.base import TTSError, VoiceSpec
from app.tts.http import make_tts_client, transport_error
from app.tts.msgpack_lite import packb

SERVICE = "Fish Audio"
OFFICIAL_HOST = "api.fish.audio"
DEFAULT_MODEL = "drama-3"
DEFAULT_TEMPERATURE = 1.0
DEFAULT_TOP_P = 0.9
TTS_TIMEOUT = 90.0
PING_TIMEOUT = 10.0
_PLACEHOLDER = 0xFFFFFF00
NO_FILE = "这个声音的文件不在文件仓库里,先在导出框点「拉回来」"


def fix_wav(data: bytes) -> bytes:
    """RIFF / data 的长度是占位值(≥ 0xFFFFFF00)时按实际字节数改回去;正常的头不动"""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data
    out = bytearray(data)
    if struct.unpack_from("<I", data, 4)[0] >= _PLACEHOLDER:
        struct.pack_into("<I", out, 4, len(data) - 8)
    pos = 12
    while pos + 8 <= len(data):
        chunk, size = data[pos : pos + 4], struct.unpack_from("<I", data, pos + 4)[0]
        if chunk == b"data":
            if size >= _PLACEHOLDER:
                struct.pack_into("<I", out, pos + 4, len(data) - (pos + 8))
            break
        pos += 8 + size + (size & 1)
    return bytes(out)


def error_text(res: httpx.Response) -> str:
    """服务回的原文:JSON 里的 message / detail / error,取不到就是正文前 500 字"""
    try:
        body = res.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        for key in ("message", "detail", "error"):
            v = body.get(key)
            if isinstance(v, dict):
                v = v.get("message")
            if v:
                return str(v)
    text = res.text.strip()
    return text[:500] if text else f"HTTP {res.status_code}"


class FishEngine:
    def __init__(self, base_url: str, model: str = "", api_key: str = ""):
        self.base_url = base_url.rstrip("/")
        self.model = model or DEFAULT_MODEL
        self.api_key = api_key

    def _official(self) -> bool:
        return (urlsplit(self.base_url).hostname or "").lower() == OFFICIAL_HOST

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    @staticmethod
    def _sampling(voice: VoiceSpec) -> tuple[float, float]:
        p = voice.params
        return p.get("temperature", DEFAULT_TEMPERATURE), p.get("top_p", DEFAULT_TOP_P)

    def request_body(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        temperature, top_p = self._sampling(voice)
        return {
            "model": self.model,
            "text": text,
            "reference_text": voice.prompt_text,
            "temperature": temperature,
            "top_p": top_p,
        }

    def cache_material(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        temperature, top_p = self._sampling(voice)
        return {
            "engine": "fish",
            "model": self.model,
            "ref": voice.ref_path,
            "prompt": voice.prompt_text,
            "text": text,
            "temperature": temperature,
            "top_p": top_p,
        }

    async def synthesize(self, text: str, voice: VoiceSpec) -> tuple[bytes, str]:
        try:
            audio = await asyncio.to_thread(Path(voice.ref_path).read_bytes)
        except OSError as e:
            raise TTSError(400, NO_FILE) from e
        temperature, top_p = self._sampling(voice)
        body = packb(
            {
                "text": text,
                "references": [{"audio": audio, "text": voice.prompt_text}],
                "format": "wav",
                "temperature": temperature,
                "top_p": top_p,
                "latency": "normal",
            }
        )
        headers = {"Content-Type": "application/msgpack", "model": self.model, **self._auth()}
        try:
            async with make_tts_client(self.base_url, TTS_TIMEOUT) as client:
                res = await client.post(f"{self.base_url}/v1/tts", content=body, headers=headers)
        except httpx.HTTPError as e:
            raise TTSError(*transport_error(self.base_url, SERVICE, e)) from e
        if res.status_code != 200:
            raise TTSError(502, error_text(res))
        mime = res.headers.get("content-type", "").split(";")[0].strip() or "audio/wav"
        data = res.content
        return (fix_wav(data) if mime in ("audio/wav", "audio/x-wav", "audio/wave") else data), mime

    async def warmup(self, voice: VoiceSpec, force: bool) -> None:
        return None

    async def ping(self) -> None:
        official = self._official()
        url = f"{self.base_url}/wallet/self/api-credit" if official else f"{self.base_url}/v1/health"
        try:
            async with make_tts_client(self.base_url, PING_TIMEOUT) as client:
                res = await client.get(url, headers=self._auth())
        except httpx.HTTPError as e:
            raise TTSError(*transport_error(self.base_url, SERVICE, e)) from e
        if official and res.status_code == 401:
            raise TTSError(400, "key 不对(Fish Audio 回 401)")
        if official and res.status_code != 200:
            raise TTSError(502, error_text(res))

    async def reference_audio(self, path: str) -> tuple[bytes, str]:
        raise TTSError(501, f"{SERVICE} 是云端服务,这里听不了它那边的原声")

    async def download(self, path: str, dest: Path) -> int:
        raise TTSError(501, f"{SERVICE} 是云端服务,没有文件可拉")
