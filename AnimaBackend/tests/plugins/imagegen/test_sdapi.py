"""本地 SD(A1111 接口)后端:请求体、认证、回图、报错原文、下拉列表、进度预览(不联网,假服务器)"""

import asyncio
import base64
import json

import httpx
import pytest

from app.plugins.imagegen.backends import sdapi
from app.plugins.imagegen.backends.base import BackendError, Conn, Job, LoraUse

PNG = b"\x89PNG\r\n\x1a\nfake"
JPEG = b"\xff\xd8\xff\xe0fake"
WEBP = b"RIFF\x10\x00\x00\x00WEBPfake"
B64 = base64.b64encode(PNG).decode()
JOB = Job(prompt="1girl, solo", negative="lowres", width=832, height=1216, seed=7, model="", steps=28, scale=5.5)
TXT2IMG = "/sdapi/v1/txt2img"
PROGRESS = "/sdapi/v1/progress"


def conn(url="http://192.168.1.5:7860", key="") -> Conn:
    return Conn(id="c1", name="本地 SD", kind="sdapi", base_url=url, api_key=key, options={})


def use(monkeypatch, handler):
    real = httpx.AsyncClient
    timeouts: list = []

    def fake(c, timeout):
        timeouts.append(timeout)
        return real(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(sdapi, "_client", fake)
    return timeouts


def ok(body):
    return httpx.Response(200, json=body)


def drew(req):
    return ok({"images": [B64]})


def run(c=None, job=JOB, on_preview=None):
    return asyncio.run(sdapi.draw(c or conn(), job, on_preview))


def failed(c=None, job=JOB) -> BackendError:
    with pytest.raises(BackendError) as e:
        run(c, job)
    return e.value


def capture(monkeypatch):
    seen: dict = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["auth"] = req.headers.get("authorization")
        seen["body"] = json.loads(req.content)
        return drew(req)

    use(monkeypatch, handler)
    return seen


# ---- 出图请求 ----


def test_request_body_without_optional_fields(monkeypatch):
    seen = capture(monkeypatch)
    run()
    assert seen["url"] == "http://192.168.1.5:7860/sdapi/v1/txt2img"
    assert seen["body"] == {
        "prompt": "1girl, solo",
        "negative_prompt": "lowres",
        "width": 832,
        "height": 1216,
        "seed": 7,
        "steps": 28,
        "cfg_scale": 5.5,
        "batch_size": 1,
        "n_iter": 1,
        "send_images": True,
        "save_images": False,
        "override_settings_restore_afterwards": False,
    }


def test_request_body_with_sampler_scheduler_and_model(monkeypatch):
    seen = capture(monkeypatch)
    job = Job(prompt="p", width=512, height=512, seed=1, model="model-a.safetensors [abc]", sampler="Euler a", scheduler="Karras")
    run(job=job)
    assert seen["body"]["sampler_name"] == "Euler a"
    assert seen["body"]["scheduler"] == "Karras"
    assert seen["body"]["override_settings"] == {"sd_model_checkpoint": "model-a.safetensors [abc]"}


def test_only_sampler_given(monkeypatch):
    seen = capture(monkeypatch)
    run(job=Job(prompt="p", width=512, height=512, seed=1, model="", sampler="Euler a"))
    assert "scheduler" not in seen["body"] and "override_settings" not in seen["body"]


def test_loras_are_not_sent_separately(monkeypatch):
    seen = capture(monkeypatch)
    run(job=Job(prompt="p, <lora:a:1>", width=512, height=512, seed=1, model="", loras=(LoraUse("a"),)))
    assert seen["body"]["prompt"] == "p, <lora:a:1>" and "loras" not in seen["body"]


def test_trailing_slash_in_address(monkeypatch):
    seen = capture(monkeypatch)
    run(conn("http://127.0.0.1:7860/"))
    assert seen["url"] == "http://127.0.0.1:7860/sdapi/v1/txt2img"


def test_no_address_says_so(monkeypatch):
    use(monkeypatch, drew)
    e = failed(conn(url=None))
    assert e.status == 400 and "本地 SD" in e.message


def test_basic_auth_when_key_given(monkeypatch):
    seen = capture(monkeypatch)
    run(conn(key="me:se:cret"))
    assert seen["auth"] == "Basic " + base64.b64encode(b"me:se:cret").decode()


def test_no_auth_header_without_key(monkeypatch):
    seen = capture(monkeypatch)
    run()
    assert seen["auth"] is None


def test_draw_timeout_is_300_seconds(monkeypatch):
    timeouts = use(monkeypatch, drew)
    run()
    assert timeouts[0].read == 300 and timeouts[0].connect == 10


# ---- 回包 ----


def test_result_fields(monkeypatch):
    use(monkeypatch, drew)
    r = run()
    assert r.data == PNG and r.mime == "image/png"
    assert r.timing.draw_ms >= 0 and r.timing.queue_ms == 0 and r.timing.fetch_ms == 0
    assert "prompt" not in r.sent and "negative_prompt" not in r.sent
    assert r.sent["steps"] == 28 and r.sent["cfg_scale"] == 5.5


def test_data_url_prefix_is_removed(monkeypatch):
    use(monkeypatch, lambda req: ok({"images": [f"data:image/png;base64,{B64}"]}))
    assert run().data == PNG


@pytest.mark.parametrize(("raw", "mime"), [(JPEG, "image/jpeg"), (WEBP, "image/webp")])
def test_other_formats_are_accepted(monkeypatch, raw, mime):
    use(monkeypatch, lambda req: ok({"images": [base64.b64encode(raw).decode()]}))
    r = run()
    assert r.data == raw and r.mime == mime


@pytest.mark.parametrize(
    "body",
    [
        {"images": []},
        {"images": None},
        {},
        {"images": [""]},
        {"images": [123]},
        {"images": "abc"},
        ["not", "a", "dict"],
        # 解得开,但不是图片
        {"images": [base64.b64encode(b"<html>hi</html>").decode()]},
    ],
)
def test_bad_images_are_502(monkeypatch, body):
    use(monkeypatch, lambda req: ok(body))
    assert failed().status == 502


def test_reply_that_is_not_json_is_502(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(200, text="<html>"))
    assert failed().status == 502


# ---- 报错 ----


def test_detail_comes_through_as_written(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(404, json={"error": "HTTPException", "detail": "Invalid checkpoint", "body": "", "errors": ""}))
    e = failed()
    assert e.status == 502 and e.message == "Invalid checkpoint"


def test_python_error_shows_type_and_message(monkeypatch):
    # A1111 代码里抛异常时 detail 是空的,原因在 errors
    reply = {"error": "RuntimeError", "detail": "", "body": "", "errors": "CUDA out of memory"}
    use(monkeypatch, lambda req: httpx.Response(500, json=reply))
    e = failed()
    assert e.status == 502 and e.message == "RuntimeError: CUDA out of memory"


def test_error_field_alone(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(400, json={"error": "bad prompt"}))
    assert failed().message == "bad prompt"


def test_validation_detail_list_is_kept(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(422, json={"detail": [{"msg": "field required"}]}))
    assert "field required" in failed().message


def test_no_known_field_uses_status_and_start_of_body(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(500, text="x" * 500))
    e = failed()
    assert e.status == 502 and e.message == "HTTP 500: " + "x" * 200


def test_json_without_known_fields_uses_status_and_body(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(500, json={"oops": 1}))
    assert failed().message.startswith("HTTP 500: ")


def raises(error):
    def handler(req):
        raise error("boom", request=req)

    return handler


@pytest.mark.parametrize("url", ["http://127.0.0.1:7860", "http://localhost:7860"])
def test_refused_on_this_machine(monkeypatch, url):
    use(monkeypatch, raises(httpx.ConnectError))
    e = failed(conn(url))
    assert e.status == 503 and e.message == f"连不上 {url}(服务没开,或者端口不对)"


def test_refused_on_another_machine(monkeypatch):
    use(monkeypatch, raises(httpx.ConnectError))
    e = failed()
    assert e.status == 503 and e.message.startswith("连不上 http://192.168.1.5:7860(")
    assert "boom" not in e.message


def test_connect_timeout(monkeypatch):
    use(monkeypatch, raises(httpx.ConnectTimeout))
    e = failed()
    assert e.status == 503 and e.message == "连不上 http://192.168.1.5:7860(机器没开机,或者不在同一个网络)"


def test_read_timeout(monkeypatch):
    use(monkeypatch, raises(httpx.ReadTimeout))
    e = failed()
    assert e.status == 504 and e.message == "等了 300 秒没画完"


def test_dropped_connection_is_503(monkeypatch):
    use(monkeypatch, raises(httpx.RemoteProtocolError))
    assert failed().status == 503


# ---- 查连接 ----


def test_check_counts_models(monkeypatch):
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        return ok([{"title": "a"}, {"title": "b"}])

    use(monkeypatch, handler)
    assert asyncio.run(sdapi.check(conn())) == "2 个模型"
    assert seen["url"] == "http://192.168.1.5:7860/sdapi/v1/sd-models"


def test_check_query_timeout(monkeypatch):
    timeouts = use(monkeypatch, lambda req: ok([]))
    asyncio.run(sdapi.check(conn()))
    assert timeouts[0].read == 15 and timeouts[0].connect == 10


def test_check_uses_auth(monkeypatch):
    seen = {}

    def handler(req):
        seen["auth"] = req.headers.get("authorization")
        return ok([])

    use(monkeypatch, handler)
    asyncio.run(sdapi.check(conn(key="me:pw")))
    assert seen["auth"] == "Basic " + base64.b64encode(b"me:pw").decode()


def test_check_404_means_reachable_without_a_list(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(404, json={"detail": "Not Found"}))
    assert "没有模型列表" in asyncio.run(sdapi.check(conn()))


def test_check_other_status_is_an_error(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(401, json={"detail": "Incorrect username or password"}))
    with pytest.raises(BackendError) as e:
        asyncio.run(sdapi.check(conn()))
    assert e.value.status == 502 and e.value.message == "Incorrect username or password"


def test_check_cannot_connect(monkeypatch):
    use(monkeypatch, raises(httpx.ConnectError))
    with pytest.raises(BackendError) as e:
        asyncio.run(sdapi.check(conn("http://127.0.0.1:7860")))
    assert e.value.status == 503 and "服务没开" in e.value.message


def test_check_read_timeout_does_not_talk_about_drawing(monkeypatch):
    use(monkeypatch, raises(httpx.ReadTimeout))
    with pytest.raises(BackendError) as e:
        asyncio.run(sdapi.check(conn()))
    assert e.value.status == 504 and "15 秒" in e.value.message and "没画完" not in e.value.message


def test_check_not_a_list(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(200, text="<html>"))
    with pytest.raises(BackendError) as e:
        asyncio.run(sdapi.check(conn()))
    assert e.value.status == 502


# ---- 下拉列表 ----

FULL = {
    "/sdapi/v1/sd-models": [{"title": "a.safetensors [1]", "model_name": "a"}, {"title": "b.ckpt [2]"}],
    "/sdapi/v1/samplers": [{"name": "Euler a"}, {"name": "DPM++ 2M"}],
    "/sdapi/v1/schedulers": [{"name": "karras", "label": "Karras"}],
    "/sdapi/v1/loras": [{"name": "style_x", "alias": "x"}],
}
WANT = {
    "models": ["a.safetensors [1]", "b.ckpt [2]"],
    "samplers": ["Euler a", "DPM++ 2M"],
    "schedulers": ["karras"],
    "loras": ["style_x"],
}


def serving(table):
    def handler(req):
        return ok(table[req.url.path]) if req.url.path in table else httpx.Response(404, json={"detail": "Not Found"})

    return handler


def test_options_full(monkeypatch):
    timeouts = use(monkeypatch, serving(FULL))
    assert asyncio.run(sdapi.options(conn())) == WANT
    assert timeouts[0].read == 15


@pytest.mark.parametrize(("path", "key"), [("/sdapi/v1/schedulers", "schedulers"), ("/sdapi/v1/loras", "loras"), ("/sdapi/v1/sd-models", "models"), ("/sdapi/v1/samplers", "samplers")])
def test_options_missing_endpoint_has_no_key(monkeypatch, path, key):
    use(monkeypatch, serving({k: v for k, v in FULL.items() if k != path}))
    got = asyncio.run(sdapi.options(conn()))
    assert key not in got and got == {k: v for k, v in WANT.items() if k != key}


def test_options_all_missing_is_empty(monkeypatch):
    use(monkeypatch, serving({}))
    assert asyncio.run(sdapi.options(conn())) == {}


def test_options_connection_failure_is_empty(monkeypatch):
    use(monkeypatch, raises(httpx.ConnectError))
    assert asyncio.run(sdapi.options(conn())) == {}


def test_options_without_address_is_empty(monkeypatch):
    use(monkeypatch, serving(FULL))
    assert asyncio.run(sdapi.options(conn(url=None))) == {}


def test_options_one_endpoint_broken_keeps_the_rest(monkeypatch):
    def handler(req):
        if req.url.path == "/sdapi/v1/samplers":
            raise httpx.ReadTimeout("slow", request=req)
        if req.url.path == "/sdapi/v1/loras":
            return httpx.Response(200, text="<html>")
        if req.url.path == "/sdapi/v1/schedulers":
            return httpx.Response(500, text="err")
        return ok(FULL[req.url.path])

    use(monkeypatch, handler)
    assert asyncio.run(sdapi.options(conn())) == {"models": WANT["models"]}


def test_options_empty_list_keeps_the_key(monkeypatch):
    # 接口是有的,只是一个 LoRA 也没放
    use(monkeypatch, serving({**FULL, "/sdapi/v1/loras": []}))
    assert asyncio.run(sdapi.options(conn()))["loras"] == []


def test_options_skips_items_without_the_field(monkeypatch):
    use(monkeypatch, serving({"/sdapi/v1/samplers": [{"name": "Euler"}, {"other": 1}, "bad"]}))
    assert asyncio.run(sdapi.options(conn())) == {"samplers": ["Euler"]}


# ---- 刷新 LoRA ----


def test_refresh_loras_posts(monkeypatch):
    seen = {}

    def handler(req):
        seen["line"] = (req.method, str(req.url))
        seen["auth"] = req.headers.get("authorization")
        return ok(None)

    use(monkeypatch, handler)
    assert asyncio.run(sdapi.refresh_loras(conn(key="a:b"))) is None
    assert seen["line"] == ("POST", "http://192.168.1.5:7860/sdapi/v1/refresh-loras")
    assert seen["auth"] is not None


def test_refresh_loras_404_is_ignored(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(404))
    assert asyncio.run(sdapi.refresh_loras(conn())) is None


def test_refresh_loras_other_error_is_raised(monkeypatch):
    use(monkeypatch, lambda req: httpx.Response(500, json={"detail": "nope"}))
    with pytest.raises(BackendError) as e:
        asyncio.run(sdapi.refresh_loras(conn()))
    assert e.value.message == "nope"


# ---- 过程预览 ----


def test_no_polling_without_callback(monkeypatch):
    paths = []

    async def handler(req):
        paths.append(req.url.path)
        await asyncio.sleep(0.02)
        return drew(req)

    use(monkeypatch, handler)
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)
    run()
    assert paths == [TXT2IMG]


def test_preview_is_called_for_each_new_image_and_polling_stops(monkeypatch):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)
    frames = [None, "a", "a", "", "b"]
    polls: list = []
    previews: list = []

    async def main():
        enough = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                polls.append(req.url.params.get("skip_current_image"))
                i = min(len(polls), len(frames)) - 1
                if len(polls) >= len(frames):
                    enough.set()
                return ok({"progress": (i + 1) / 10, "current_image": frames[i]})
            await enough.wait()
            return drew(req)

        use(monkeypatch, handler)
        result = await sdapi.draw(conn(), JOB, lambda image, progress: previews.append((image, progress)))
        assert asyncio.all_tasks() == {asyncio.current_task()}, "出图结束后轮询任务还在"
        count = len(polls)
        await asyncio.sleep(0.03)
        return result, count

    result, count = asyncio.run(main())
    assert result.data == PNG
    assert previews == [("a", 0.2), ("b", 0.5)]
    assert set(polls) == {"false"}
    assert len(polls) == count, "出图结束后还在查进度"


def test_polling_stops_at_once_even_if_a_poll_is_hanging(monkeypatch):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)

    async def main():
        polled = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                polled.set()
                await asyncio.sleep(30)
                return ok({})
            await polled.wait()
            return drew(req)

        use(monkeypatch, handler)
        result = await asyncio.wait_for(sdapi.draw(conn(), JOB, lambda *_: None), 2)
        assert asyncio.all_tasks() == {asyncio.current_task()}, "出图结束后轮询任务还在"
        return result

    assert asyncio.run(main()).data == PNG


@pytest.mark.parametrize(
    "bad",
    [
        lambda req: httpx.Response(500, text="err"),
        lambda req: httpx.Response(200, text="<html>"),
        lambda req: ok(["list"]),
        lambda req: ok({"progress": "not a number", "current_image": "a"}),
    ],
)
def test_bad_poll_replies_do_not_touch_the_result(monkeypatch, bad):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)

    async def main():
        polled = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                polled.set()
                return bad(req)
            await polled.wait()
            await asyncio.sleep(0.01)
            return drew(req)

        use(monkeypatch, handler)
        return await sdapi.draw(conn(), JOB, lambda *_: None)

    assert asyncio.run(main()).data == PNG


def test_poll_connection_error_does_not_touch_the_result(monkeypatch):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)

    async def main():
        polled = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                polled.set()
                raise httpx.ReadError("gone", request=req)
            await polled.wait()
            await asyncio.sleep(0.01)
            return drew(req)

        use(monkeypatch, handler)
        return await sdapi.draw(conn(), JOB, lambda *_: None)

    assert asyncio.run(main()).data == PNG


def test_callback_that_raises_does_not_touch_the_result(monkeypatch):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)

    def explode(image, progress):
        raise RuntimeError("frontend went away")

    async def main():
        called = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                called.set()
                return ok({"progress": 0.5, "current_image": "a"})
            await called.wait()
            await asyncio.sleep(0.01)
            return drew(req)

        use(monkeypatch, handler)
        return await sdapi.draw(conn(), JOB, explode)

    assert asyncio.run(main()).data == PNG


def test_polling_stops_when_drawing_fails(monkeypatch):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)
    polls: list = []

    async def main():
        polled = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                polls.append(1)
                polled.set()
                return ok({})
            await polled.wait()
            raise httpx.ConnectError("refused", request=req)

        use(monkeypatch, handler)
        with pytest.raises(BackendError):
            await sdapi.draw(conn(), JOB, lambda *_: None)
        assert asyncio.all_tasks() == {asyncio.current_task()}, "出图失败后轮询任务还在"
        count = len(polls)
        await asyncio.sleep(0.03)
        return count

    count = asyncio.run(main())
    assert len(polls) == count


def test_polls_use_auth(monkeypatch):
    monkeypatch.setattr(sdapi, "POLL_EVERY", 0.001)
    seen: list = []

    async def main():
        polled = asyncio.Event()

        async def handler(req):
            if req.url.path == PROGRESS:
                seen.append(req.headers.get("authorization"))
                polled.set()
                return ok({})
            await polled.wait()
            return drew(req)

        use(monkeypatch, handler)
        await sdapi.draw(conn(key="me:pw"), JOB, lambda *_: None)

    asyncio.run(main())
    assert seen and seen[0] == "Basic " + base64.b64encode(b"me:pw").decode()
