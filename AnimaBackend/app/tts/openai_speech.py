"""中转站(OpenAI 兼容的 /audio/speech)适配器。音色就是请求里的 voice 名,没有参考音频、没有权重。

- 中转站可能 302 到真正的音频地址(MiniMax 这类),所以跟随重定向
- 200 但内容是 JSON(限额、音色不对…)也算错;报错显示服务回的原文
- 返回的格式按文件头的魔数认,认不出再看响应头
"""

from pathlib import Path
from typing import Any

import httpx

from app.tts.base import TTSError, VoiceSpec
from app.tts.http import make_tts_client, transport_error

SERVICE = "中转站"
SPEECH_TIMEOUT = 60.0
NO_URL = "这条中转站连接还没填地址"


def error_text(res: httpx.Response) -> str:
    """服务回的原文:JSON 里的 error.message / error / message / detail,取不到就是正文前 500 字"""
    body = None
    try:
        body = res.json()
    except ValueError:
        pass
    if isinstance(body, dict):
        err = body.get("error")
        for v in (err.get("message") if isinstance(err, dict) else err, body.get("message"), body.get("detail")):
            if v and isinstance(v, (str, int, float)):
                return str(v)
    raw = res.text.strip()
    return raw[:500] if raw else f"HTTP {res.status_code}"


def sniff_mime(data: bytes, header: str) -> str:
    if data[:4] == b"RIFF":
        return "audio/wav"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] in (0xFB, 0xF3, 0xF2)):
        return "audio/mpeg"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"fLaC":
        return "audio/flac"
    return header.split(";")[0].strip() or "audio/mpeg"


class OpenAiSpeechEngine:
    def __init__(self, base_url: str, model: str = "", api_key: str = ""):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.last_model_count: int | None = None

    def _need_url(self) -> None:
        if not self.base_url:
            raise TTSError(400, NO_URL)

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def request_body(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        return {
            "model": self.model,
            "input": text,
            "voice": voice.params.get("voice", ""),
            "speed": voice.speed,
            "response_format": "wav",
        }

    def cache_material(self, text: str, voice: VoiceSpec) -> dict[str, Any]:
        return {
            "engine": "openai",
            "base": self.base_url,
            "model": self.model,
            "voice": voice.params.get("voice", ""),
            "speed": voice.speed,
            "text": text,
        }

    async def synthesize(self, text: str, voice: VoiceSpec) -> tuple[bytes, str]:
        self._need_url()
        try:
            async with make_tts_client(self.base_url, SPEECH_TIMEOUT, follow_redirects=True) as client:
                res = await client.post(
                    f"{self.base_url}/audio/speech", json=self.request_body(text, voice), headers=self._auth()
                )
        except httpx.HTTPError as e:
            raise TTSError(*transport_error(self.base_url, SERVICE, e)) from e
        if res.status_code != 200:
            raise TTSError(502, error_text(res))
        header = res.headers.get("content-type", "")
        data = res.content
        if "json" in header.lower() or data[:1] == b"{":
            raise TTSError(502, error_text(res))
        return data, sniff_mime(data, header)

    async def warmup(self, voice: VoiceSpec, force: bool) -> None:
        return None

    async def _get_models(self) -> list[str]:
        self._need_url()
        try:
            async with make_tts_client(self.base_url, SPEECH_TIMEOUT, follow_redirects=True) as client:
                res = await client.get(f"{self.base_url}/models", headers=self._auth())
        except httpx.HTTPError as e:
            raise TTSError(*transport_error(self.base_url, SERVICE, e)) from e
        if res.status_code != 200:
            raise TTSError(502, error_text(res))
        try:
            body = res.json()
        except ValueError:
            body = None
        items = body.get("data", body.get("models")) if isinstance(body, dict) else body
        names = []
        for it in items if isinstance(items, list) else []:
            name = it.get("id") or it.get("name") if isinstance(it, dict) else it
            if isinstance(name, str) and name:
                names.append(name)
        self.last_model_count = len(names)
        return names

    async def ping(self) -> None:
        await self._get_models()

    async def list_models(self) -> list[str]:
        return await self._get_models()

    async def reference_audio(self, path: str) -> tuple[bytes, str]:
        raise TTSError(501, f"{SERVICE}没有参考音频,音色是请求里的音色名")

    async def download(self, path: str, dest: Path) -> int:
        raise TTSError(501, f"{SERVICE}没有文件可拉")
