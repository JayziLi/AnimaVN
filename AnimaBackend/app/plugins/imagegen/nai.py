"""NovelAI 出图(2026-10-09 实测过的写法,原型在会话 e613e94d 的 scratchpad cg/nai_test.py)。

- 地址 https://image.novelai.net/ai/generate-image,回的是 zip,里面一张 PNG。
- Cloudflare 会拦没有浏览器 User-Agent 的请求(403 / error code 1010),所以要带浏览器的 UA 和 Origin / Referer。
- 同一个账号同时只能画一张(多发回 429 Concurrent generation is locked),这里用一把锁排队;偶发 5xx 重试。
- 账户:/user/subscription 的 tier(3 = Opus)、Anlas、usage.percent(Opus 画 V5 的免费额度还剩百分之几)。
- 免费范围(Opus):面积不超过 1024×1024、步数不超过 28、一次一张。超出的每张都扣 Anlas。
- 角色参考(director_reference_*)只有 V4.5 能用(10-09 实测 V5 发了回 500);图要补成 1024×1536 / 1536×1024 / 1472×1472。
  10-09 星绘:V4.5 + 立绘原图、提示词不写长相,一致性最好。
"""

from __future__ import annotations

import asyncio
import base64
import io
import math
import zipfile
from dataclasses import dataclass, field

import httpx

from app.llm.http_client import make_http_client

HOST = "https://image.novelai.net"
V5_FULL = "nai-diffusion-5-full"
V5_CURATED = "nai-diffusion-5-curated"
V45_FULL = "nai-diffusion-4-5-full"
V45_CURATED = "nai-diffusion-4-5-curated"
MODELS = (V5_CURATED, V5_FULL, V45_FULL, V45_CURATED)
# 只画全年龄时换成的那个
SFW_OF = {V5_FULL: V5_CURATED, V45_FULL: V45_CURATED}

FREE_PIXELS = 1024 * 1024
FREE_STEPS = 28
RETRY_CODES = (429, 502, 503, 504)

# ── 网页上的选项(10-12 从 novelai.net/image 的前端代码里抄的) ──
# 采样器:网页给 V4 / V5 列的那几个(推荐 Euler Ancestral)
SAMPLERS = (
    "k_euler_ancestral",
    "k_euler",
    "k_dpmpp_2s_ancestral",
    "k_dpmpp_2m_sde",
    "k_dpmpp_2m",
    "k_dpmpp_sde",
)
# 噪声调度:只有 V4.5 能选(V5 网页固定 karras);没选时按采样器的默认
NOISE_SCHEDULES = ("karras", "exponential", "polyexponential")
_NOISE_DEFAULT = {"k_dpmpp_2m": "exponential"}
# Variety+:网页发 skip_cfg_above_sigma = 58 × √(面积 / 832×1216),只有 V4.5 有
VARIETY_SIGMA = 58
_BASE_PIXELS = 832 * 1216

_UC_V5 = {
    "heavy": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, "
    "chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    "light": "lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, "
    "0::ai-generated::",
    "human": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, "
    "chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, "
    "@_@, mismatched pupils, glowing eyes, bad anatomy",
}
_UC_V45_FULL = {
    "heavy": _UC_V5["heavy"],
    "light": "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, "
    "too many watermarks, negative space, blank page",
    "human": _UC_V5["human"],
}
_UC_V45_CURATED = {
    "heavy": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, "
    "very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
    "light": "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, "
    "blank page",
    "human": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, "
    "jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, "
    "mismatched pupils, glowing eyes, negative space, blank page",
}
# 反向预设(UC Preset):网页在前端把它拼在反向最前面。Furry Focus 没抄(画不到)
UC_PRESETS: dict[str, dict[str, str]] = {
    V5_CURATED: _UC_V5,
    V5_FULL: _UC_V5,
    V45_FULL: _UC_V45_FULL,
    V45_CURATED: _UC_V45_CURATED,
}
_QUALITY = "very aesthetic, masterpiece, no text"
# 质量词(Quality Tags):网页拼在提示词最后。V4.5 只有 Standard
QUALITY_PRESETS: dict[str, dict[str, str]] = {
    V5_CURATED: {"standard": _QUALITY, "light": "very aesthetic, amazing quality, no text"},
    V5_FULL: {"standard": _QUALITY, "light": "very aesthetic, amazing quality, no text"},
    V45_FULL: {"standard": _QUALITY},
    V45_CURATED: {"standard": f"{_QUALITY}, -0.8::feet::, rating:general"},
}


def uc_preset(model: str, preset: str) -> str:
    """这个模型的反向预设原文;none / 不认识的是空串"""
    return UC_PRESETS.get(model, {}).get(preset, "")


def quality_tags(model: str, preset: str) -> str:
    """这个模型的质量词原文;none 是空串,这个模型没有的(V4.5 没有 Light)用 Standard"""
    if preset == "none":
        return ""
    table = QUALITY_PRESETS.get(model, {"standard": _QUALITY})
    return table.get(preset) or table["standard"]

_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Origin": "https://novelai.net",
    "Referer": "https://novelai.net/",
}

# 同一个账号一次只能画一张:进程里排队
_lock = asyncio.Lock()


class NaiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class CharPrompt:
    """分角色提示词:一个人一条,x / y 是这个人大概在画面哪里(0–1)"""

    prompt: str
    negative: str = ""
    x: float = 0.5
    y: float = 0.5


@dataclass(frozen=True)
class Reference:
    """角色参考:image 是已经补成规定尺寸的 PNG(reference_canvas);style = 连画风一起参考(网页上的 Style Aware)"""

    image: bytes
    style: bool = False


@dataclass(frozen=True)
class Request:
    prompt: str
    negative: str
    width: int
    height: int
    seed: int
    model: str = V5_CURATED
    steps: int = 23
    scale: float = 7.0
    sampler: str = "k_euler_ancestral"
    chars: tuple[CharPrompt, ...] = field(default_factory=tuple)
    reference: Reference | None = None
    # 噪声调度(只 V4.5 能选);None = 按采样器的默认
    noise_schedule: str | None = None
    # 引导重缩放(Prompt Guidance Rescale,0–1)
    cfg_rescale: float = 0.0
    # Variety+(只 V4.5)
    variety: bool = False


def is_free(width: int, height: int, steps: int) -> bool:
    """Opus 不扣 Anlas 的范围(V5 走免费额度条,V4.5 等旧模型不限)"""
    return width * height <= FREE_PIXELS and steps <= FREE_STEPS


def supports_reference(model: str) -> bool:
    """角色参考只有 V4.5 能用"""
    return model.startswith("nai-diffusion-4-5")


REF_CANVASES = ((1024, 1536), (1536, 1024), (1472, 1472))


def reference_canvas(data: bytes) -> bytes:
    """参考图补成 NovelAI 收的尺寸:按长宽比挑最接近的一种,等比缩进去、四周补黑;透明的地方垫白
    (10-09 的做法,立绘多是透明底)。没装 OpenCV、图读不出来时抛 NaiError"""
    try:
        import cv2
        import numpy as np
    except ImportError as e:
        raise NaiError(500, "没装 OpenCV,用不了参考图") from e
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise NaiError(400, "参考图读不出来")
    if img.dtype != np.uint8:
        img = (img / 257).astype(np.uint8)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255
        img = (img[:, :, :3].astype(np.float32) * alpha + 255 * (1 - alpha)).astype(np.uint8)
    h, w = img.shape[:2]
    cw, ch = min(REF_CANVASES, key=lambda s: abs(math.log(s[0] / s[1] * h / w)))
    scale = min(cw / w, ch / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    small = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    canvas = np.zeros((ch, cw, 3), np.uint8)
    y, x = (ch - nh) // 2, (cw - nw) // 2
    canvas[y : y + nh, x : x + nw] = small
    ok, buf = cv2.imencode(".png", canvas)
    if not ok:
        raise NaiError(500, "参考图编码失败")
    return buf.tobytes()


def noise_schedule(model: str, sampler: str, chosen: str | None) -> str:
    """V5 固定 karras(网页也是);V4.5 用选的,没选按采样器的默认"""
    if model.startswith("nai-diffusion-5"):
        return "karras"
    return chosen if chosen in NOISE_SCHEDULES else _NOISE_DEFAULT.get(sampler, "karras")


def build_body(r: Request) -> dict:
    """请求体。字段照网页发的(10-09 从用户贴的图里读出来的参数,10-12 对过网页前端代码),V5 / V4.5 共用"""
    v5 = r.model.startswith("nai-diffusion-5")
    coords = len(r.chars) > 1
    captions = [{"char_caption": c.prompt, "centers": [{"x": c.x, "y": c.y}]} for c in r.chars]
    neg_captions = [{"char_caption": c.negative, "centers": [{"x": c.x, "y": c.y}]} for c in r.chars]
    params = {
        "params_version": 4 if v5 else 3,
        "width": r.width,
        "height": r.height,
        "scale": r.scale,
        "sampler": r.sampler,
        "steps": r.steps,
        "seed": r.seed,
        "n_samples": 1,
        "ucPreset": 3,
        "qualityToggle": False,
        "dynamic_thresholding": False,
        "controlnet_strength": 1,
        "legacy": False,
        "add_original_image": False,
        "cfg_rescale": r.cfg_rescale,
        "noise_schedule": noise_schedule(r.model, r.sampler, r.noise_schedule),
        "legacy_v3_extend": False,
        "uncond_scale": 1,
        "negative_prompt": r.negative,
        "prompt": r.prompt,
        "reference_image_multiple": [],
        "reference_information_extracted_multiple": [],
        "reference_strength_multiple": [],
        "extra_noise_seed": r.seed,
        "use_coords": coords,
        "legacy_uc": False,
        "normalize_reference_strength_multiple": True,
        "prefer_brownian": True,
        "deliberate_euler_ancestral_bug": False,
        "v4_prompt": {"use_coords": coords, "use_order": True, "caption": {"base_caption": r.prompt, "char_captions": captions}},
        "v4_negative_prompt": {"legacy_uc": False, "caption": {"base_caption": r.negative, "char_captions": neg_captions}},
        "characterPrompts": [
            {"prompt": c.prompt, "uc": c.negative, "center": {"x": c.x, "y": c.y}, "enabled": True} for c in r.chars
        ],
    }
    if r.variety and not v5:
        params["skip_cfg_above_sigma"] = round(VARIETY_SIGMA * math.sqrt(r.width * r.height / _BASE_PIXELS), 4)
    if r.reference is not None and supports_reference(r.model):
        # 字段和数值照 10-09 实测的(强度 1、信息量 1);只参考人时 base_caption 写 character
        params.update(
            director_reference_images=[base64.b64encode(r.reference.image).decode()],
            director_reference_descriptions=[
                {
                    "caption": {"base_caption": "character&style" if r.reference.style else "character", "char_captions": []},
                    "legacy_uc": False,
                }
            ],
            director_reference_information_extracted=[1.0],
            director_reference_strength_values=[1.0],
            director_reference_secondary_strength_values=[0.0],
        )
    return {"input": r.prompt, "model": r.model, "action": "generate", "parameters": params}


def _explain(status: int, text: str) -> str:
    low = text.lower()
    if status == 401:
        return "NovelAI token 无效或过期了,到插件页重新填"
    if status == 402:
        return "NovelAI 的 Anlas 不够了(V5 免费额度用完、或者尺寸 / 步数超出免费范围时要扣 Anlas)"
    if status == 403 and "1010" in low:
        return "被 NovelAI 的 Cloudflare 拦了(403 / 1010)"
    if status == 429:
        return "NovelAI 同一个账号一次只能画一张,前一张还没画完"
    return f"NovelAI 回了 {status}:{text[:200]}"


def unzip_png(raw: bytes) -> bytes:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".png") and not n.startswith("__MACOSX"))
            return z.read(name)
    except (zipfile.BadZipFile, StopIteration) as e:
        raise NaiError(502, "NovelAI 回的不是图片压缩包") from e


async def _send(method: str, path: str, token: str, body: dict | None = None, timeout: float = 120.0) -> httpx.Response:
    async with make_http_client() as client:
        try:
            return await client.request(
                method, HOST + path, json=body, headers={**_HEADERS, "Authorization": f"Bearer {token}"}, timeout=timeout
            )
        except httpx.TimeoutException as e:
            raise NaiError(504, "NovelAI 超时没回") from e
        except httpx.HTTPError as e:
            raise NaiError(503, f"连不上 NovelAI:{e}") from e


async def generate(token: str, body: dict, tries: int = 3, wait: float = 2.0) -> bytes:
    """画一张,返回 PNG。排队:同一时间只发一个"""
    async with _lock:
        for i in range(tries):
            r = await _send("POST", "/ai/generate-image", token, body)
            if r.status_code == 200:
                return unzip_png(r.content)
            if r.status_code in RETRY_CODES and i < tries - 1:
                await asyncio.sleep(wait)
                continue
            raise NaiError(r.status_code, _explain(r.status_code, r.text))
    raise NaiError(502, "NovelAI 没画出来")  # 走不到这里


async def account(token: str) -> dict:
    """账户:等级(3 = Opus)、Anlas、V5 免费额度还剩百分之几、下一个百分点还要几秒"""
    r = await _send("GET", "/user/subscription", token, timeout=20.0)
    if r.status_code != 200:
        raise NaiError(r.status_code, _explain(r.status_code, r.text))
    s = r.json()
    steps = s.get("trainingStepsLeft") or {}
    usage = s.get("usage") or {}
    return {
        "tier": s.get("tier"),
        "active": bool(s.get("active")),
        "anlas": int(steps.get("fixedTrainingStepsLeft") or 0) + int(steps.get("purchasedTrainingSteps") or 0),
        "v5_percent": usage.get("percent"),
        "v5_next_percent_s": usage.get("timeUntilNextPercent"),
    }
