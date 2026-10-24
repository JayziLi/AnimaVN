from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TokenIn(BaseModel):
    # 空串 = 删掉
    token: str = Field("", max_length=400)


class StatusOut(BaseModel):
    has_token: bool
    # env:环境变量 NOVELAI_TOKEN;settings:插件页填的
    source: str | None = None


class AccountOut(BaseModel):
    tier: int | None = None
    active: bool = False
    anlas: int = 0
    v5_percent: float | None = None
    v5_next_percent_s: float | None = None


class DefaultsOut(BaseModel):
    skills: dict[str, str]
    models: list[str]
    quality: str
    free_pixels: int
    free_steps: int
    # 每个模型的反向预设、质量词原文(设置页显示「这个预设加了什么」)
    uc_presets: dict[str, dict[str, str]] = Field(default_factory=dict)
    quality_presets: dict[str, dict[str, str]] = Field(default_factory=dict)


class LineIn(BaseModel):
    speaker: str | None = Field(None, max_length=80)
    text: str = Field(..., max_length=4000)


class WhoIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    gender: Literal["female", "male"] = "female"
    look: str = Field("", max_length=2000)
    outfit: str = Field("", max_length=2000)
    player: bool = False


class DrawnIn(BaseModel):
    """前后已经画过的一张:line 是在发过去的那段剧情里的编号(null = 上一条回复的;越界 = 这条回复更前 / 更后面)"""

    line: int | None = None
    title: str = Field("", max_length=40)
    description: str = Field("", max_length=400)
    clothes: str = Field("", max_length=300)


class NotePersonIO(BaseModel):
    who: str = Field(..., min_length=1, max_length=80)
    look: str = Field("", max_length=1000)
    clothes: str = Field("", max_length=1000)
    # 和平时不一样的地方(中文)
    notes: str = Field("", max_length=600)


class NoteIO(BaseModel):
    """状态笔记:一条回复结束时每个人的样子、在哪、到那时为止发生了什么(存在那条回复的 swipe_info[分支].vn.imageNote)"""

    place: str = Field("", max_length=300)
    people: list[NotePersonIO] = Field(default_factory=list, max_length=6)
    story: str = Field("", max_length=1200)


class PlanIn(BaseModel):
    mode: Literal["manual", "auto"] = "manual"
    # 不传 = 当前的聊天连接
    connection_id: str | None = None
    # off = 关思考(默认);conn = 照连接自己的设置
    thinking: Literal["off", "conn"] = "off"
    # 改写过的说明书;不传 = 默认的
    skill: str | None = Field(None, max_length=8000)
    cast: list[WhoIn] = Field(default_factory=list, max_length=6)
    lines: list[LineIn] = Field(default_factory=list, max_length=120)
    focus: int | None = None
    place: str = Field("", max_length=400)
    want: str = Field("", max_length=400)
    user_text: str = Field("", max_length=2000)
    since: int | None = None
    last: str = Field("", max_length=400)
    drawn: list[DrawnIn] = Field(default_factory=list, max_length=8)
    # 上一条回复结束时的状态笔记;没有不传
    note: NoteIO | None = None
    sfw_only: bool = False
    # 镜头:pov 第一人称(默认)/ third 第三人称 / auto 指导模型挑
    camera: Literal["pov", "third", "auto"] = "pov"


class NoteIn(BaseModel):
    """记一条回复的状态笔记"""

    connection_id: str | None = None
    thinking: Literal["off", "conn"] = "off"
    # 改写过的状态笔记说明书;不传 = 默认的
    skill: str | None = Field(None, max_length=8000)
    cast: list[WhoIn] = Field(default_factory=list, max_length=6)
    lines: list[LineIn] = Field(default_factory=list, max_length=120)
    # 上一次的笔记;没有不传
    prev: NoteIO | None = None
    place: str = Field("", max_length=400)
    user_text: str = Field("", max_length=2000)


class NoteOut(NoteIO):
    ms: int
    connection: str


class PersonIO(BaseModel):
    who: str = Field(..., min_length=1, max_length=80)
    tags: str = Field("", max_length=2000)
    # 这一刻穿的
    clothes: str = Field("", max_length=1000)
    # 这一刻的长相(10-22 起指导模型写);null = 老的画面,拼提示词时照老规矩补卡上的长相和平时的衣服
    look: str | None = Field(None, max_length=2000)


class PictureIO(BaseModel):
    """一幅画面:指导模型写的、玩家在「先看提示词」里改过的"""

    scene: str = Field("", max_length=2000)
    people: list[PersonIO] = Field(default_factory=list, max_length=4)
    # 要求画成人向(标签里有裸露的词时拼提示词也会当成 nsfw)
    nsfw: bool = False
    # 第一人称:玩家是镜头,不画玩家这个人
    pov: bool = False
    # 一句英文的整体构图
    composition: str = Field("", max_length=600)


class PlanOut(BaseModel):
    draw: bool
    at: int | None = None
    # 画面到第几句为止(和 at 一样按给它的句子编号);None = 没写
    until: int | None = None
    importance: int = 1
    reason: str = ""
    title: str = ""
    description: str = ""
    picture: PictureIO
    # 指导模型用了几毫秒、哪个连接
    ms: int
    connection: str


class RefIn(BaseModel):
    """参考图(只有 V4.5 用得上):sprite = 立绘(id 不传 = 这张卡当前立绘包的默认立绘);upload = 上传的(imagegen_refs 的编号)"""

    kind: Literal["sprite", "upload"] = "sprite"
    id: str | None = Field(None, max_length=32)
    # 连画风一起参考;默认只参考人,画风照插件里选的
    style: bool = False


class LookIn(BaseModel):
    # 卡上写的长相、平时的衣服:10-22 起只给老画面补(新画面照指导模型写的)
    tags: str = Field("", max_length=2000)
    outfit: str = Field("", max_length=2000)
    negative: str = Field("", max_length=2000)
    gender: Literal["female", "male"] = "female"
    player: bool = False
    # 角色名标签(keqing (genshin impact) 这种;原创角色空着)
    name_tag: str = Field("", max_length=200)
    ref: RefIn | None = None


class StyleIn(BaseModel):
    tags: str = Field("", max_length=2000)
    negative: str = Field("", max_length=2000)
    # 画师串
    artists: str = Field("", max_length=2000)


class GenerateIn(BaseModel):
    card_id: str | None = None
    chat_id: str | None = None
    entry_id: str | None = None
    swipe: int | None = None
    line: int | None = None
    trigger: Literal["manual", "auto", "reroll"] = "manual"
    title: str = Field("", max_length=40)
    description: str = Field("", max_length=400)
    picture: PictureIO
    # 名字 → 这个人平时的样子
    looks: dict[str, LookIn] = Field(default_factory=dict)
    style: StyleIn = Field(default_factory=StyleIn)
    model: str = "nai-diffusion-5-curated"
    width: int = Field(1344, ge=256, le=2048)
    height: int = Field(768, ge=256, le=2048)
    steps: int = Field(23, ge=1, le=50)
    scale: float = Field(7.0, ge=0, le=20)
    sampler: str = Field("k_euler_ancestral", max_length=40)
    # 噪声调度(只 V4.5 能选);不传 = 按采样器的默认
    noise_schedule: Literal["karras", "exponential", "polyexponential"] | None = None
    # 引导重缩放(Prompt Guidance Rescale)
    cfg_rescale: float = Field(0.0, ge=0, le=1)
    # Variety+(只 V4.5)
    variety: bool = False
    # 不传 = 随机
    seed: int | None = Field(None, ge=0, le=4294967295)
    # 质量词(Quality Tags):standard / light / none;旧的前端发 true / false
    quality: bool | Literal["standard", "light", "none"] = "standard"
    # 反向预设(UC Preset),拼在 uc 前面;旧的前端不发,反向预设的原文在 uc 里
    uc_preset: Literal["heavy", "light", "human", "none"] = "none"
    uc: str = Field("", max_length=2000)
    sfw_only: bool = False
    # 超出免费范围(面积 > 1024²、步数 > 28)也画:每张扣 Anlas
    allow_paid: bool = False


class CharOut(BaseModel):
    prompt: str
    negative: str
    x: float
    y: float


class ImageOut(BaseModel):
    id: str
    sha: str | None
    card_id: str | None
    chat_id: str | None
    entry_id: str | None
    swipe: int | None
    line: int | None
    trigger: str
    title: str
    description: str
    picture: dict
    prompt: str
    negative: str
    chars: list[CharOut]
    params: dict
    ms: int
    kept_asset_id: str | None
    created_at: datetime


class KeepOut(BaseModel):
    pack_id: str
    pack_name: str
    asset_id: str
    label: str


class LookAskIn(BaseModel):
    card_id: str
    connection_id: str | None = None
    thinking: Literal["off", "conn"] = "off"
    skill: str | None = Field(None, max_length=8000)


class LookAskOut(BaseModel):
    tags: str
    outfit: str = ""
    gender: Literal["female", "male"]
    # 认得出是哪部作品的角色时写 danbooru 角色标签,原创角色空着
    name_tag: str = ""
    ms: int


class RefImageOut(BaseModel):
    id: str
    sha: str | None
    mime: str
