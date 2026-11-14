"""中转后端:三种接口、三种回图写法、自动换接口、尺寸吸附、额外参数、报错原文(不联网,假服务器)"""

import asyncio
import base64
import json

import httpx
import pytest

from app.plugins.imagegen.assemble import Look, Person, Plan, Style, natural, plain_words
from app.plugins.imagegen.backends import openai as relay
from app.plugins.imagegen.backends.base import BackendError, Conn, Job

PNG = b"\x89PNG\r\n\x1a\nfake"
B64 = base64.b64encode(PNG).decode()
JOB = Job(prompt="a girl", width=1344, height=768, seed=1, model="gpt-image-2")


def conn(**options) -> Conn:
    return Conn(id="c1", name="中转", kind="openai", base_url="https://relay.test", api_key="sk-x", options=options)


def use(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(relay, "_client", lambda c, timeout: real(transport=httpx.MockTransport(handler)))


def run(c, job=JOB):
    return asyncio.run(relay.draw(c, job))


def ok(body):
    return httpx.Response(200, json=body)


def test_images_api_sends_snapped_size_and_reads_b64(monkeypatch):
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["auth"] = req.headers["authorization"]
        seen["body"] = json.loads(req.content)
        return ok({"data": [{"b64_json": B64}]})

    use(monkeypatch, handler)
    r = run(conn())
    assert seen["url"] == "https://relay.test/v1/images/generations"
    assert seen["auth"] == "Bearer sk-x"
    assert seen["body"] == {"model": "gpt-image-2", "prompt": "a girl", "size": "1536x1024", "n": 1}
    assert "response_format" not in seen["body"]
    assert r.data == PNG and r.sent["api"] == "images" and r.sent["size"] == "1536x1024"


def test_address_with_v1_is_not_doubled(monkeypatch):
    urls = []

    def handler(req):
        urls.append(str(req.url))
        return ok({"data": [{"b64_json": B64}]})

    use(monkeypatch, handler)
    run(Conn(id="c", name="x", kind="openai", base_url="https://relay.test/v1/", api_key="", options={}))
    assert urls == ["https://relay.test/v1/images/generations"]


def test_images_api_downloads_url(monkeypatch):
    def handler(req):
        if req.url.path == "/v1/images/generations":
            return ok({"data": [{"url": "https://cdn.test/a.png"}]})
        assert str(req.url) == "https://cdn.test/a.png"
        return httpx.Response(200, content=PNG)

    use(monkeypatch, handler)
    assert run(conn()).data == PNG


def test_empty_sizes_sends_requested_size(monkeypatch):
    seen = {}

    def handler(req):
        seen.update(json.loads(req.content))
        return ok({"data": [{"b64_json": B64}]})

    use(monkeypatch, handler)
    run(conn(sizes=""))
    assert seen["size"] == "1344x768"


def test_extra_params_merge_into_body_and_bad_json_is_reported(monkeypatch):
    seen = {}

    def handler(req):
        seen.update(json.loads(req.content))
        return ok({"data": [{"b64_json": B64}]})

    use(monkeypatch, handler)
    run(conn(extra='{"quality": "low"}'))
    assert seen["quality"] == "low"
    with pytest.raises(BackendError, match="JSON"):
        run(conn(extra="{oops"))


@pytest.mark.parametrize(
    "message",
    [
        {"images": [{"image_url": {"url": f"data:image/png;base64,{B64}"}}], "content": ""},
        {"content": [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{B64}"}}]},
        {"content": f"here you go ![x](data:image/png;base64,{B64})"},
    ],
)
def test_chat_api_reads_every_image_shape(monkeypatch, message):
    seen = {}

    def handler(req):
        seen["url"] = req.url.path
        seen["body"] = json.loads(req.content)
        return ok({"choices": [{"message": message}]})

    use(monkeypatch, handler)
    r = run(conn(api="chat"))
    assert r.data == PNG and seen["url"] == "/v1/chat/completions"
    assert seen["body"]["modalities"] == ["image", "text"]
    assert "Aspect ratio: 3:2" in seen["body"]["messages"][0]["content"][0]["text"]


def test_chat_api_follows_markdown_link(monkeypatch):
    def handler(req):
        if req.url.path == "/v1/chat/completions":
            return ok({"choices": [{"message": {"content": "![x](https://cdn.test/b.png)"}}]})
        return httpx.Response(200, content=PNG)

    use(monkeypatch, handler)
    assert run(conn(api="chat")).data == PNG


def test_gemini_native_uses_root_and_reads_inline_data(monkeypatch):
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["key"] = req.headers["x-goog-api-key"]
        seen["body"] = json.loads(req.content)
        return ok({"candidates": [{"content": {"parts": [{"text": "x"}, {"inlineData": {"mimeType": "image/png", "data": B64}}]}}]})

    use(monkeypatch, handler)
    job = Job(prompt="p", width=1344, height=768, seed=1, model="models/gemini-3-pro-image")
    c = Conn(id="c", name="x", kind="openai", base_url="https://relay.test/v1", api_key="k", options={})
    r = asyncio.run(relay.draw(c, job))
    assert seen["url"] == "https://relay.test/v1beta/models/gemini-3-pro-image:generateContent"
    assert seen["key"] == "k"
    assert seen["body"]["generationConfig"]["responseModalities"] == ["IMAGE", "TEXT"]
    assert r.data == PNG and r.sent["api"] == "gemini"


def test_auto_falls_through_when_interface_is_missing(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.path == "/v1/images/generations":
            return httpx.Response(404, json={"error": {"message": "Invalid URL"}})
        return ok({"choices": [{"message": {"content": f"data:image/png;base64,{B64}"}}]})

    use(monkeypatch, handler)
    r = run(conn())
    assert calls == ["/v1/images/generations", "/v1/chat/completions"]
    assert r.sent["api"] == "chat"


def test_remembered_interface_goes_first(monkeypatch):
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return ok({"choices": [{"message": {"content": f"data:image/png;base64,{B64}"}}]})

    use(monkeypatch, handler)
    run(conn(resolved={"gpt-image-2": "chat"}))
    assert calls == ["/v1/chat/completions"]


@pytest.mark.parametrize("status,text", [(401, "bad key"), (402, "no balance"), (429, "slow down"), (400, "content policy violation")])
def test_real_errors_do_not_try_other_interfaces(monkeypatch, status, text):
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return httpx.Response(status, json={"error": {"message": text}})

    use(monkeypatch, handler)
    with pytest.raises(BackendError) as e:
        run(conn())
    assert len(calls) == 1
    assert text in e.value.message and str(status) in e.value.message


def test_all_interfaces_missing_reports_first_error(monkeypatch):
    def handler(req):
        return httpx.Response(404, json={"error": {"message": f"no {req.url.path}"}})

    use(monkeypatch, handler)
    with pytest.raises(BackendError, match="/v1/images/generations"):
        run(conn())


def test_text_only_reply_says_so(monkeypatch):
    use(monkeypatch, lambda req: ok({"choices": [{"message": {"content": "I cannot draw"}}]}))
    with pytest.raises(BackendError, match="没有回图片"):
        run(conn(api="chat"))


def test_reference_goes_to_edits_as_a_file(monkeypatch):
    seen = {}

    def handler(req):
        seen["path"] = req.url.path
        seen["type"] = req.headers["content-type"]
        seen["body"] = req.content
        return ok({"data": [{"b64_json": B64}]})

    use(monkeypatch, handler)
    job = Job(prompt="p", width=1024, height=1024, seed=1, model="gpt-image-2", reference=PNG, reference_mime="image/png")
    run(conn(), job)
    assert seen["path"] == "/v1/images/edits"
    assert seen["type"].startswith("multipart/form-data")
    assert PNG in seen["body"]


def test_transport_error_is_readable(monkeypatch):
    def handler(req):
        raise httpx.ConnectError("refused")

    use(monkeypatch, handler)
    with pytest.raises(BackendError, match="连不上"):
        run(conn())


def test_check_and_options_list_image_models_first(monkeypatch):
    use(monkeypatch, lambda req: ok({"data": [{"id": "gpt-5"}, {"id": "gpt-image-2"}, {"id": "claude"}]}))
    assert asyncio.run(relay.check(conn())) == "3 个模型"
    assert asyncio.run(relay.options(conn()))["models"][0] == "gpt-image-2"


def test_order_prefers_gemini_native_for_gemini_models():
    assert relay.order(conn(), "gemini-3-pro-image")[0] == "gemini"
    assert relay.order(conn(), "gpt-image-2")[0] == "images"
    assert relay.order(conn(api="chat"), "gemini-3") == ["chat"]


def test_snap_size_picks_closest_ratio():
    assert relay.snap_size(1344, 768, relay.DEFAULT_SIZES) == (1536, 1024)
    assert relay.snap_size(768, 1344, relay.DEFAULT_SIZES) == (1024, 1536)
    assert relay.snap_size(1000, 1000, relay.DEFAULT_SIZES) == (1024, 1024)
    assert relay.snap_size(1344, 768, "") == (1344, 768)


def test_plain_words_drops_novelai_weights():
    assert plain_words("1.4::blue hair::, {smile}, [hat], -1::bad::, artist:foo") == "blue hair, smile, hat, foo"


def test_natural_prompt_reads_like_a_description():
    plan = Plan(scene="beach, sunset", people=(Person("星绘", "smiling", "white dress", "silver hair"),), composition="She looks back at the camera.")
    out = natural(plan, {"星绘": Look()}, Style(tags="anime coloring"))
    assert out == "She looks back at the camera. 星绘: silver hair, white dress, smiling. beach, sunset. anime coloring"


def test_natural_prompt_skips_the_player_in_first_person():
    plan = Plan(scene="room", people=(Person("我", "hand", "", ""), Person("她", "smile", "", "")), pov=True)
    out = natural(plan, {"我": Look(player=True), "她": Look()}, Style())
    assert out.startswith("First-person view. 她: smile.")
    assert "我:" not in out
