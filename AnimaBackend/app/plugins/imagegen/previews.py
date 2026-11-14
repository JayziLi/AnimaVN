"""本地 SD 画的时候的过程预览(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 8 节):
/generate 带 job_id,画的途中把进度图放进这里;前端先开 GET /jobs/{id}/events(SSE)收。
只留最新一帧:前端来不及看的旧帧没有用。真实时间不会变短,只是玩家不用干等。
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

# 画完没人来收、或者前端开了就没再来的,放这么久就扔
KEEP_S = 600.0
WAIT_S = 600.0
MAX_JOBS = 64


@dataclass
class _Job:
    created: float
    # (base64 的图, 进度 0–1);被取走就是 None
    frame: tuple[str, float] | None = None
    done: bool = False
    wake: asyncio.Event = field(default_factory=asyncio.Event)


_jobs: dict[str, _Job] = {}


def _prune(now: float) -> None:
    for job_id in [k for k, j in _jobs.items() if now - j.created > KEEP_S]:
        del _jobs[job_id]
    while len(_jobs) >= MAX_JOBS:
        del _jobs[min(_jobs, key=lambda k: _jobs[k].created)]


def _job(job_id: str) -> _Job:
    job = _jobs.get(job_id)
    if job is None:
        now = time.monotonic()
        _prune(now)
        job = _jobs[job_id] = _Job(created=now)
    return job


def publish(job_id: str, image: str, progress: float) -> None:
    job = _job(job_id)
    job.frame = (image, progress)
    job.wake.set()


def finish(job_id: str) -> None:
    job = _job(job_id)
    job.done = True
    job.wake.set()


async def events(job_id: str) -> AsyncIterator[str]:
    """SSE:每帧一条 {image, progress},画完发一条 done 就结束。前端断开、等太久没动静也结束"""
    job = _job(job_id)
    try:
        while True:
            try:
                await asyncio.wait_for(job.wake.wait(), WAIT_S)
            except TimeoutError:
                return
            job.wake.clear()
            frame, job.frame = job.frame, None
            if frame is not None:
                yield f"data: {json.dumps({'image': frame[0], 'progress': frame[1]})}\n\n"
            if job.done:
                yield "event: done\ndata: {}\n\n"
                return
    finally:
        _jobs.pop(job_id, None)
