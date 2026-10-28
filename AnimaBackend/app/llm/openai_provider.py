from collections.abc import AsyncIterator
from typing import Any

import openai
from openai import AsyncOpenAI

from app.llm.base import ChatMessage, LLMProvider, StreamChunk
from app.llm.errors import LLMError, status_message
from app.llm.http_client import make_http_client
from app.llm.thinking import openai_params

# no standard exists for streamed chain-of-thought: DeepSeek uses
# reasoning_content, OpenRouter uses reasoning, and relays copy whichever they
# fronted first — so read both rather than betting on one
REASONING_FIELDS = ("reasoning_content", "reasoning")

DEFAULT_ENDPOINT = "https://api.openai.com/v1"


def _reasoning_of(delta: Any) -> str:
    """Best-effort chain-of-thought from a delta, whatever the vendor named it."""
    for field in REASONING_FIELDS:
        value = getattr(delta, field, None)
        if value is None and getattr(delta, "model_extra", None):
            value = delta.model_extra.get(field)
        if isinstance(value, str) and value:
            return value
    return ""


def _wire(m: ChatMessage) -> dict[str, str]:
    # name 只在有的时候带上 —— 有些中转站见到 "name": null 会报错
    out = {"role": m.role, "content": m.content}
    if m.name:
        out["name"] = m.name
    return out


def _is_web_page(e: openai.APIStatusError) -> bool:
    """A redirect or an HTML body means the request landed on a website (the
    relay's homepage, an nginx default page), not on an API route — almost
    always a base URL missing its /v1."""
    if 300 <= e.status_code < 400:
        return True
    content_type = e.response.headers.get("content-type", "")
    return "text/html" in content_type or e.response.text.lstrip()[:1] == "<"


class OpenAICompatibleProvider(LLMProvider):
    """OpenAI official API plus anything speaking its chat-completions dialect:
    relay/proxy services, OpenRouter, DeepSeek, Ollama, LM Studio, vLLM, ...
    """

    def __init__(self, api_key: str | None, base_url: str | None = None, thinking: str | None = None):
        self._base_url = base_url
        # 连接上的思考深浅,每次请求都带上(见 app/llm/thinking.py)
        self._extra = openai_params(thinking)
        # local services (Ollama, LM Studio) need no key, but the SDK requires one
        self._client = AsyncOpenAI(
            api_key=api_key or "sk-no-key", base_url=base_url, http_client=make_http_client()
        )

    def _web_page_message(self, status: int) -> str:
        base = (self._base_url or "").rstrip("/")
        return f"Got a web page instead of an API response from {base or DEFAULT_ENDPOINT} (HTTP {status})"

    def _map_error(self, e: Exception) -> LLMError:
        endpoint = self._base_url or DEFAULT_ENDPOINT
        # 报错只写上游原话和事实,不写建议(界面上直接给用户看)
        # order matters: specific status errors subclass APIStatusError,
        # and APITimeoutError subclasses APIConnectionError
        if isinstance(e, openai.APIStatusError) and _is_web_page(e):
            return LLMError(self._web_page_message(e.status_code), explained=True)
        if isinstance(e, openai.APIStatusError):
            return LLMError(status_message(e.status_code, e.body if e.body is not None else e.message))
        if isinstance(e, openai.APITimeoutError):
            return LLMError(f"Request to {endpoint} timed out")
        if isinstance(e, openai.APIConnectionError):
            cause = f": {e.__cause__}" if e.__cause__ else ""
            return LLMError(f"Cannot connect to {endpoint}{cause}")
        return LLMError(f"Request failed: {e}")

    async def complete(self, messages: list[ChatMessage], model: str) -> str:
        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=[_wire(m) for m in messages],
                **self._extra,
            )
        except Exception as e:
            raise self._map_error(e) from e
        if not response.choices:
            raise LLMError("Empty response: no choices")
        return response.choices[0].message.content or ""

    async def stream(
        self, messages: list[ChatMessage], model: str
    ) -> AsyncIterator[StreamChunk]:
        # split so auth/model errors surface from create() before any chunk is
        # yielded — the endpoint relies on that to still answer with a real 502
        try:
            events = await self._client.chat.completions.create(
                model=model,
                messages=[_wire(m) for m in messages],
                stream=True,
                **self._extra,
            )
        except Exception as e:
            raise self._map_error(e) from e

        try:
            async for event in events:
                if not event.choices:
                    continue  # usage-only frames, sent by some relays at the end
                delta = event.choices[0].delta
                if delta is None:
                    continue
                text = delta.content or ""
                reasoning = _reasoning_of(delta)
                if text or reasoning:
                    yield StreamChunk(text=text, reasoning=reasoning)
        except Exception as e:
            raise self._map_error(e) from e

    async def list_models(self) -> list[str]:
        try:
            page = await self._client.models.list()
        except Exception as e:
            raise self._map_error(e) from e
        return [m.id for m in page.data]
