import asyncio
import json

import httpx
import pytest

from app.llm.base import ChatMessage
from app.llm.errors import LLMError
from app.llm.openai_provider import OpenAICompatibleProvider


def run(coro):
    return asyncio.run(coro)


def install_transport(monkeypatch, handler) -> httpx.AsyncClient:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr("app.llm.openai_provider.make_http_client", lambda: client)
    return client


def test_complete_preserves_openai_message_roles_and_model(monkeypatch):
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["authorization"] = request.headers.get("authorization")
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 0,
                "model": "model-a",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "模型回复"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider("secret", "https://llm.test/v1")
            return await provider.complete(
                [
                    ChatMessage(role="system", content="系统提示"),
                    ChatMessage(role="system", content="示例里的一句", name="example_assistant"),
                    ChatMessage(role="user", content="你好"),
                ],
                "model-a",
            )
        finally:
            await client.aclose()

    reply = run(scenario())

    assert reply == "模型回复"
    assert captured == {
        "path": "/v1/chat/completions",
        "authorization": "Bearer secret",
        "payload": {
            "messages": [
                {"role": "system", "content": "系统提示"},
                {"role": "system", "content": "示例里的一句", "name": "example_assistant"},
                {"role": "user", "content": "你好"},
            ],
            "model": "model-a",
        },
    }


COMPLETION = {
    "id": "chatcmpl-test",
    "object": "chat.completion",
    "created": 0,
    "model": "model-a",
    "choices": [
        {"index": 0, "message": {"role": "assistant", "content": "好"}, "finish_reason": "stop"}
    ],
}


@pytest.mark.parametrize(
    ("thinking", "extra"),
    [
        (None, {}),
        ("off", {"thinking": {"type": "disabled"}}),
        ("low", {"reasoning_effort": "low"}),
        ("max", {"reasoning_effort": "max"}),
    ],
)
def test_thinking_level_rides_along_on_complete_and_stream(monkeypatch, thinking, extra):
    payloads: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        payloads.append(payload)
        if payload.get("stream"):
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, content=b"data: [DONE]\n\n"
            )
        return httpx.Response(200, json=COMPLETION)

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider("secret", "https://llm.test/v1", thinking)
            messages = [ChatMessage(role="user", content="你好")]
            await provider.complete(messages, "model-a")
            _ = [chunk async for chunk in provider.stream(messages, "model-a")]
        finally:
            await client.aclose()

    run(scenario())

    assert len(payloads) == 2
    for payload in payloads:
        assert {k: v for k, v in payload.items() if k not in ("model", "messages", "stream")} == extra


def test_local_openai_compatible_endpoint_works_without_user_api_key(monkeypatch):
    captured_authorization = None

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_authorization
        captured_authorization = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-local",
                "object": "chat.completion",
                "created": 0,
                "model": "local",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "本地回复"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider(None, "http://127.0.0.1:11434/v1")
            return await provider.complete([ChatMessage(role="user", content="你好")], "local")
        finally:
            await client.aclose()

    assert run(scenario()) == "本地回复"
    assert captured_authorization == "Bearer sk-no-key"


def test_complete_rejects_success_response_without_choices(monkeypatch):
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-empty",
                "object": "chat.completion",
                "created": 0,
                "model": "model-a",
                "choices": [],
            },
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider("secret", "https://llm.test/v1")
            return await provider.complete([ChatMessage(role="user", content="你好")], "model-a")
        finally:
            await client.aclose()

    with pytest.raises(LLMError, match="^Empty response: no choices$"):
        run(scenario())


def test_list_models_returns_remote_ids_in_remote_order(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        return httpx.Response(
            200,
            json={
                "object": "list",
                "data": [
                    {"id": "model-z", "object": "model", "created": 0, "owned_by": "test"},
                    {"id": "model-a", "object": "model", "created": 0, "owned_by": "test"},
                ],
            },
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider("secret", "https://llm.test/v1")
            return await provider.list_models()
        finally:
            await client.aclose()

    assert run(scenario()) == ["model-z", "model-a"]


def test_stream_separates_reasoning_and_text_and_ignores_usage_only_frames(monkeypatch):
    frames = [
        {
            "id": "chunk-1",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "model-a",
            "choices": [
                {
                    "index": 0,
                    "delta": {"reasoning_content": "先思考"},
                    "finish_reason": None,
                }
            ],
        },
        {
            "id": "chunk-2",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "model-a",
            "choices": [
                {"index": 0, "delta": {"reasoning": "，继续想"}, "finish_reason": None}
            ],
        },
        {
            "id": "chunk-3",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "model-a",
            "choices": [
                {"index": 0, "delta": {"content": "再回答"}, "finish_reason": None}
            ],
        },
        {
            "id": "chunk-4",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "model-a",
            "choices": [],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        },
    ]
    body = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames) + "data: [DONE]\n\n"

    async def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=body.encode(),
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider("secret", "https://llm.test/v1")
            return [
                chunk
                async for chunk in provider.stream(
                    [ChatMessage(role="user", content="你好")], "model-a"
                )
            ]
        finally:
            await client.aclose()

    chunks = run(scenario())

    assert [(chunk.reasoning, chunk.text) for chunk in chunks] == [
        ("先思考", ""),
        ("，继续想", ""),
        ("", "再回答"),
    ]


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, "^401 Unauthorized: upstream detail$"),
        (403, "^403 Forbidden: upstream detail$"),
        (404, "^404 Not Found: upstream detail$"),
        (429, "^429 Too Many Requests: upstream detail$"),
        (500, "^500 Internal Server Error: upstream detail$"),
    ],
)
def test_http_errors_carry_status_and_upstream_message(monkeypatch, status: int, expected: str):
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            headers={"x-should-retry": "false"},
            json={"error": {"message": "upstream detail", "type": "test_error"}},
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            provider = OpenAICompatibleProvider("secret", "https://llm.test/v1")
            return await provider.complete([ChatMessage(role="user", content="你好")], "model-a")
        finally:
            await client.aclose()

    with pytest.raises(LLMError, match=expected):
        run(scenario())


NGINX_301 = (
    "<html>\n<head><title>301 Moved Permanently</title></head>\n<body>\n"
    "<center><h1>301 Moved Permanently</h1></center>\n</body>\n</html>"
)


@pytest.mark.parametrize(
    ("base_url", "status", "expected"),
    [
        ("https://llm.test", 301, "from https://llm.test (HTTP 301)"),
        ("https://llm.test/", 404, "from https://llm.test (HTTP 404)"),
        ("https://llm.test/v1", 301, "from https://llm.test/v1 (HTTP 301)"),
    ],
)
def test_web_page_response_is_explained_as_wrong_base_url(monkeypatch, base_url, status, expected):
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            headers={"content-type": "text/html", "location": "https://elsewhere.test/models"},
            content=NGINX_301.encode(),
        )

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            return await OpenAICompatibleProvider("secret", base_url).list_models()
        finally:
            await client.aclose()

    with pytest.raises(LLMError) as err:
        run(scenario())

    assert err.value.explained
    assert "Got a web page instead of an API response" in err.value.message
    assert expected in err.value.message
    assert "<html>" not in err.value.message


def _status_error(monkeypatch, response: httpx.Response, base_url="https://llm.test/v1"):
    async def handler(_request: httpx.Request) -> httpx.Response:
        return response

    client = install_transport(monkeypatch, handler)

    async def scenario():
        try:
            return await OpenAICompatibleProvider("secret", base_url).complete(
                [ChatMessage(role="user", content="hi")], "model-a"
            )
        finally:
            await client.aclose()

    with pytest.raises(LLMError) as err:
        run(scenario())
    return err.value.message


def test_status_error_with_plain_text_body_uses_that_text(monkeypatch):
    msg = _status_error(
        monkeypatch,
        httpx.Response(502, headers={"x-should-retry": "false"}, content=b"upstream connect error"),
    )
    assert msg == "502 Bad Gateway: upstream connect error"


def test_status_error_without_body_keeps_only_status(monkeypatch):
    msg = _status_error(monkeypatch, httpx.Response(429, headers={"x-should-retry": "false"}))
    assert msg == "429 Too Many Requests"


def test_status_error_accepts_string_error_field(monkeypatch):
    msg = _status_error(
        monkeypatch,
        httpx.Response(402, headers={"x-should-retry": "false"}, json={"error": "Insufficient Balance"}),
    )
    assert msg == "402 Payment Required: Insufficient Balance"


def test_timeout_and_connect_errors_are_plain_facts(monkeypatch):
    def failing(exc):
        async def handler(request: httpx.Request) -> httpx.Response:
            raise exc(("boom"), request=request)

        return handler

    for exc, expected in [
        (httpx.ReadTimeout, "Request to https://llm.test/v1 timed out"),
        (httpx.ConnectError, "Cannot connect to https://llm.test/v1: boom"),
    ]:
        client = install_transport(monkeypatch, failing(exc))

        async def scenario():
            try:
                provider = OpenAICompatibleProvider("secret", "https://llm.test/v1")
                provider._client = provider._client.with_options(max_retries=0)
                return await provider.complete([ChatMessage(role="user", content="hi")], "model-a")
            finally:
                await client.aclose()

        with pytest.raises(LLMError) as err:
            run(scenario())
        assert err.value.message == expected
