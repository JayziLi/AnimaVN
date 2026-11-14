"""出图后端共用的数据结构。不 import 任何后端(nai.py 也从这里拿 CharPrompt)"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CharPrompt:
    """分角色提示词:一个人一条,x / y 是这个人大概在画面哪里(0–1)。NovelAI 直接用;别的后端拼成一段"""

    prompt: str
    negative: str = ""
    x: float = 0.5
    y: float = 0.5


@dataclass(frozen=True)
class Conn:
    """发请求要的那几项(不带数据库对象,异步里用着安全)。api_key 已经按规则挑好(连接的 / 环境变量的)"""

    id: str | None
    name: str
    kind: str
    base_url: str | None
    api_key: str
    options: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Timing:
    """一张图各段花了几毫秒:排队、画、传回(拿不开的算在 draw 里)"""

    queue_ms: int = 0
    draw_ms: int = 0
    fetch_ms: int = 0

    def as_dict(self) -> dict:
        return {"queue": self.queue_ms, "draw": self.draw_ms, "fetch": self.fetch_ms}


@dataclass(frozen=True)
class Result:
    data: bytes
    mime: str
    timing: Timing
    # 实际发出去的参数(各家自己的格式),相册记录从这里挑
    sent: dict = field(default_factory=dict)


@dataclass(frozen=True)
class LoraUse:
    """这张图要用的一个 LoRA(本地 SD 才有)"""

    name: str
    weight: float = 1.0
    trigger: str = ""


@dataclass(frozen=True)
class Job:
    """NovelAI 以外的后端画一张要的东西。提示词已经按这条连接的写法拼好;某后端不支持的项它自己忽略"""

    prompt: str
    width: int
    height: int
    seed: int
    model: str
    negative: str = ""
    steps: int = 23
    scale: float = 7.0
    sampler: str = ""
    scheduler: str = ""
    loras: tuple[LoraUse, ...] = ()
    # 参考图原件(立绘或上传的),没有是 None
    reference: bytes | None = None
    reference_mime: str = ""


class BackendError(Exception):
    """出图失败:status 给 HTTP 用,message 是给玩家看的原文"""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message
