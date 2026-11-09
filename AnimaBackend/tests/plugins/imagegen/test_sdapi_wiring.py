"""本地 SD 连接接进出图流程:提示词按 SD 写法、不发参考图、关掉的 LoRA 不发、过程预览(不联网,后端换成假的)"""

import asyncio
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.plugins.imagegen import previews
from app.plugins.imagegen.backends import sdapi
from app.plugins.imagegen.backends.base import BackendError, Result, Timing

URL = "/api/imagegen"


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 120, 160)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def fake_draw(monkeypatch):
    jobs = []

    async def draw(conn, job, on_preview=None):
        jobs.append((conn, job))
        if on_preview is not None:
            on_preview("BASE64", 0.5)
        return Result(data=png_bytes(), mime="image/png", timing=Timing(draw_ms=1200), sent={"steps": job.steps})

    monkeypatch.setattr(sdapi, "draw", draw)
    return jobs


def make_conn(client: TestClient) -> str:
    r = client.post(f"{URL}/connections", json={"kind": "sdapi", "base_url": "http://127.0.0.1:7860"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def payload(conn_id: str, **over) -> dict:
    body = {
        "connection_id": conn_id,
        "picture": {
            "scene": "1.4::riverbank::, {sunset}",
            "people": [{"who": "星绘", "tags": "smile", "clothes": "white dress", "look": "silver hair"}],
        },
        "looks": {"星绘": {"tags": "silver hair", "name_tag": "celestia (strinova)", "ref": {"kind": "sprite"}}},
        "style": {"tags": "anime coloring", "negative": "3d", "artists": "artist:someone"},
        "width": 832,
        "height": 1216,
        "seed": 7,
        "uc_preset": "light",
        "uc": "watermark",
    }
    return {**body, **over}


def test_a_local_sd_connection_draws_with_sd_tags(client: TestClient, fake_draw):
    c = make_conn(client)
    loras = [{"name": "xinghui", "weight": 0.8, "trigger": "celestia"}, {"name": "off_one", "on": False}]
    r = client.post(f"{URL}/generate", json=payload(c, loras=loras, sampler="Euler a", model="wai.safetensors [abc]", steps=20))
    assert r.status_code == 200, r.text
    job = fake_draw[0][1]
    assert job.prompt.startswith("1girl, solo, celestia, ")
    assert r"celestia \(strinova\)" in job.prompt and "(riverbank:1.4)" in job.prompt and "(sunset:1.05)" in job.prompt
    assert "artist:" not in job.prompt and job.prompt.endswith("<lora:xinghui:0.8>") and "off_one" not in job.prompt
    assert "loli" in job.negative and "3d" in job.negative and "watermark" in job.negative
    assert (job.model, job.sampler, job.steps, job.seed) == ("wai.safetensors [abc]", "Euler a", 20, 7)
    assert [x.name for x in job.loras] == ["xinghui"]
    out = r.json()
    assert out["params"]["connection"]["kind"] == "sdapi" and out["params"]["seed"] == 7
    assert out["prompt"] == job.prompt and out["negative"] == job.negative


def test_novelai_names_left_in_the_settings_are_not_sent_to_local_sd(client: TestClient, fake_draw):
    # 这张卡第一次换到本地 SD、还没选模型和采样器时,页面带来的是 NovelAI 的默认值
    r = client.post(f"{URL}/generate", json=payload(make_conn(client), model="nai-diffusion-4-5-full", sampler="k_euler_ancestral"))
    assert r.status_code == 200, r.text
    job = fake_draw[0][1]
    assert (job.model, job.sampler) == ("", "")


def test_local_sd_sends_no_reference_picture(client: TestClient, fake_draw, monkeypatch):
    from app.plugins.imagegen import api

    def boom(*args, **kwargs):
        raise AssertionError("本地 SD 不该去读参考图")

    monkeypatch.setattr(api, "_reference_bytes", boom)
    r = client.post(f"{URL}/generate", json=payload(make_conn(client)))
    assert r.status_code == 200, r.text
    assert fake_draw[0][1].reference is None and r.json()["params"]["reference"] is None


def test_a_test_draw_works_and_the_connection_can_be_checked(client: TestClient, fake_draw, monkeypatch):
    c = make_conn(client)
    r = client.post(f"{URL}/connections/{c}/test", json=payload(c))
    assert r.status_code == 200, r.text
    assert r.json()["negative"]

    async def check(conn):
        return "12 个模型"

    async def options(conn):
        return {"models": ["wai"], "loras": ["xinghui"]}

    monkeypatch.setattr(sdapi, "check", check)
    monkeypatch.setattr(sdapi, "options", options)
    assert client.post(f"{URL}/connections/{c}/check").json()["message"] == "12 个模型"
    assert client.get(f"{URL}/connections/{c}/options").json() == {"models": ["wai"], "loras": ["xinghui"]}


def test_previews_reach_the_event_stream(client: TestClient, fake_draw):
    r = client.post(f"{URL}/generate", json=payload(make_conn(client), job_id="job-1"))
    assert r.status_code == 200, r.text
    with client.stream("GET", f"{URL}/jobs/job-1/events") as s:
        text = "".join(s.iter_text())
    assert '"image": "BASE64"' in text and '"progress": 0.5' in text and "event: done" in text


def test_a_draw_without_a_job_id_leaves_nothing_behind(client: TestClient, fake_draw):
    before = len(previews._jobs)
    assert client.post(f"{URL}/generate", json=payload(make_conn(client))).status_code == 200
    assert len(previews._jobs) == before


def test_only_the_newest_frame_is_kept_and_the_stream_cleans_up():
    async def main():
        previews.publish("job-2", "old", 0.1)
        previews.publish("job-2", "new", 0.9)
        previews.finish("job-2")
        return [x async for x in previews.events("job-2")]

    out = asyncio.run(main())
    assert len(out) == 2 and '"new"' in out[0] and "done" in out[1]
    assert "job-2" not in previews._jobs


def test_old_jobs_nobody_read_are_dropped(monkeypatch):
    previews.publish("job-3", "x", 0.1)
    monkeypatch.setattr(previews.time, "monotonic", lambda: previews._jobs["job-3"].created + previews.KEEP_S + 1)
    previews.publish("job-4", "y", 0.1)
    assert "job-3" not in previews._jobs
    previews._jobs.pop("job-4")


def test_refresh_loras_asks_the_service_only_on_a_local_sd_connection(client: TestClient, monkeypatch):
    asked = []

    async def refresh(conn):
        asked.append(conn.id)

    monkeypatch.setattr(sdapi, "refresh_loras", refresh)
    sd = make_conn(client)
    assert client.post(f"{URL}/connections/{sd}/refresh-loras").status_code == 204
    assert asked == [sd]

    relay = client.post(f"{URL}/connections", json={"kind": "openai", "base_url": "https://relay.example/v1"}).json()["id"]
    r = client.post(f"{URL}/connections/{relay}/refresh-loras")
    assert r.status_code == 400 and asked == [sd]


def test_refresh_loras_gives_the_service_error_text_back(client: TestClient, monkeypatch):
    async def refresh(conn):
        raise BackendError(503, "连不上 http://127.0.0.1:7860(服务没开,或者端口不对)")

    monkeypatch.setattr(sdapi, "refresh_loras", refresh)
    r = client.post(f"{URL}/connections/{make_conn(client)}/refresh-loras")
    assert r.status_code == 503 and "服务没开" in r.json()["detail"]
