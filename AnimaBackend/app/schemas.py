from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.llm.thinking import ThinkingLevel

ApiType = Literal["openai_compatible", "anthropic", "mock"]


class PersonaCreate(BaseModel):
    name: str
    description: str = ""
    avatar: str | None = None


class PersonaUpdate(BaseModel):
    """Partial update: omitted fields keep their current value."""

    name: str | None = None
    description: str | None = None
    # 显式传 null = 清掉头像,所以这个字段靠 exclude_unset 区分"没传"和"清空"
    avatar: str | None = None


class PersonaOut(BaseModel):
    id: str
    name: str
    description: str
    avatar: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ConnectionCreate(BaseModel):
    name: str
    api_type: ApiType
    base_url: str | None = None
    api_key: str | None = None
    model: str = ""
    stream: bool = True
    thinking: ThinkingLevel | None = None


class ConnectionUpdate(BaseModel):
    """Partial update: omitted fields keep their current value.

    api_key: omit to keep the stored key, send "" or null to clear it.
    thinking: omit to keep, null = back to the service default.
    """

    name: str | None = None
    api_type: ApiType | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    stream: bool | None = None
    thinking: ThinkingLevel | None = None


class ConnectionOut(BaseModel):
    id: str
    name: str
    api_type: str
    base_url: str | None
    model: str
    has_api_key: bool
    is_active: bool
    stream: bool
    thinking: str | None
    cached_models: list[str]
    cached_models_at: datetime | None


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str


class ModelsPreviewRequest(BaseModel):
    """Fetch remote model list for a possibly-unsaved connection config.

    api_key omitted/empty + connection_id set = use that connection's stored key.
    """

    api_type: ApiType
    base_url: str | None = None
    api_key: str | None = None
    connection_id: str | None = None


class TestMessageRequest(BaseModel):
    content: str


class TestMessageResult(BaseModel):
    reply: str


# ── 酒馆角色卡 ──────────────────────────────────────────────
# 字段照搬 chara_card_v2/v3 spec，命名保持一致，方便原样进出。


class TavernCardBase(BaseModel):
    name: str = ""
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    system_prompt: str = ""
    post_history_instructions: str = ""
    creator_notes: str = ""
    alternate_greetings: list[str] = []
    tags: list[str] = []
    creator: str = ""
    character_version: str = ""
    character_book: dict | None = None
    extensions: dict = {}
    spec: str = "chara_card_v2"


class TavernCardCreate(TavernCardBase):
    avatar: str | None = None


class TavernCardUpdate(BaseModel):
    """All optional — the console PATCHes single fields as the user types."""

    name: str | None = None
    description: str | None = None
    personality: str | None = None
    scenario: str | None = None
    first_mes: str | None = None
    mes_example: str | None = None
    system_prompt: str | None = None
    post_history_instructions: str | None = None
    creator_notes: str | None = None
    alternate_greetings: list[str] | None = None
    tags: list[str] | None = None
    creator: str | None = None
    character_version: str | None = None
    character_book: dict | None = None
    extensions: dict | None = None
    spec: str | None = None
    avatar: str | None = None
    # 上次打开的对话。显式传 null 就是清空 —— exclude_unset 认的是「键在不在
    # 请求体里」,不是值是不是 None,所以和 avatar/character_book 一样能置空
    last_chat_id: str | None = None


class TavernCardOut(TavernCardBase):
    id: str
    # avatar itself is fetched from /avatar so listing many cards stays cheap
    has_avatar: bool
    last_chat_id: str | None = None
    # 是哪张主卡的状态卡(素材架构 3.5);主卡和普通的卡是 null。选角页、卡列表先不单独列状态卡
    state_of: str | None = None
    created_at: datetime
    updated_at: datetime


# ── 提示词预设 ──────────────────────────────────────────────


class PromptPresetBase(BaseModel):
    name: str
    prompts: list[dict] = []
    prompt_order: list[dict] = []
    formats: dict = {}
    params: dict = {}
    squash_system_messages: bool = False


class PromptPresetCreate(PromptPresetBase):
    pass


class PromptPresetUpdate(BaseModel):
    name: str | None = None
    prompts: list[dict] | None = None
    prompt_order: list[dict] | None = None
    formats: dict | None = None
    params: dict | None = None
    squash_system_messages: bool | None = None


class PromptPresetOut(PromptPresetBase):
    id: str
    created_at: datetime
    updated_at: datetime


class DuplicateRequest(BaseModel):
    """Optional new name for the copy; falls back to '<原名> - 副本'."""

    name: str | None = None


# ── 调试台对话 ──────────────────────────────────────────────
# 消息字段刻意贴着酒馆 chat jsonl(swipes / swipe_id / extra)。
# swipe_info 是不透明 JSON:前端往里放什么就存什么,快照除外 —— 写入时
# 被抽进 debug_snapshots,库里只留 snapshotHash。


class DebugChatCreate(BaseModel):
    name: str = ""
    card_id: str | None = None
    preset_id: str | None = None
    user_name: str = "User"


class DebugChatUpdate(BaseModel):
    """Partial update. card_id / preset_id: send null to clear, omit to keep."""

    name: str | None = None
    card_id: str | None = None
    preset_id: str | None = None
    user_name: str | None = None
    tainted: bool | None = None
    # 整份替换。宏变量:名字 → 字符串或数字
    variables: dict | None = None


class DebugChatMessageIn(BaseModel):
    id: str
    idx: int
    role: str  # "user" | "assistant"
    swipes: list[str]
    swipe_id: int = 0
    swipe_info: list[dict] = []


class DebugChatMessageOut(BaseModel):
    id: str
    idx: int
    role: str
    swipes: list[str]
    swipe_id: int
    swipe_info: list[dict]


class DebugChatOut(BaseModel):
    id: str
    name: str
    card_id: str | None
    preset_id: str | None
    card_name: str
    preset_name: str
    user_name: str
    tainted: bool
    parent_chat_id: str | None = None
    parent_message_id: str | None = None
    variables: dict = {}
    created_at: datetime
    updated_at: datetime
    # 列表视图给个数,详情视图给全量消息 —— 二者互斥
    message_count: int | None = None
    messages: list[DebugChatMessageOut] | None = None
    # 列表卡片的预览行:最后一条消息的正文(已压平空白并截断)
    last_message: str = ""


class DebugBranchRequest(BaseModel):
    """从这里开始:复制 [0, message_id] 到新对话。"""

    message_id: str


# ── 立绘插件 ──────────────────────────────────────────────


class SpritePackIn(BaseModel):
    name: str
    description: str = ""


class SpritePackUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class SpritePackOut(BaseModel):
    id: str
    name: str
    description: str
    sprite_count: int
    # 挂着这个包的卡有几张 —— 改它、删它之前让人心里有数
    card_count: int


class PackDuplicateIn(BaseModel):
    """复制立绘包 / 场景包 / CG 包(素材管理页「创建副本」):不给名字就叫「X 副本」(撞了加「 2」);给了名字照建包的规矩查"""

    name: str | None = None


class SpriteCreate(BaseModel):
    label: str
    aliases: list[str] = []
    description: str = ""


class SpriteEffect(BaseModel):
    """换到这张立绘时放的特效。三样都是前端内置清单里的 id(frontend/src/debug/plugins/spriteFx.ts),
    后端不认识它们,只管存;前端遇到不认识的 id 当作没设。null = 这一样不要"""

    motion: str | None = Field(default=None, max_length=40)
    bubble: str | None = Field(default=None, max_length=40)
    sound: str | None = Field(default=None, max_length=40)


class SpriteUpdate(BaseModel):
    """全部可选 —— 映射表是逐格编辑的,一次只改一个字段。"""

    label: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    enabled: bool | None = None
    # 显式传 null = 去掉特效;不传 = 不改
    effect: SpriteEffect | None = None


class SpriteOut(BaseModel):
    id: str
    pack_id: str
    label: str
    aliases: list[str]
    description: str
    has_image: bool
    # 图的版本号(毫秒时间戳),前端拼进图片 URL 当缓存键 —— 换图后 URL 变了,
    # 浏览器就不会继续用缓存里的旧图
    image_version: int
    # 图在文件仓库里的指纹(第 3 期);有它时前端用 /api/blobs/<指纹> 取图,还没复制进去是 null
    image_sha: str | None = None
    sort: int
    # 禁用的立绘游戏里不用,但留在表里
    enabled: bool
    # {"width", "height", "face": {"x","y","w","h"} | null},位置是占整张图的比例;null = 还没找过脸
    face_scan: dict[str, Any] | None
    # 换到这张立绘时的特效;null = 没设
    effect: SpriteEffect | None = None


class SpriteReorderRequest(BaseModel):
    """这个包全部立绘的 id,按新顺序排。必须一个不多一个不少。"""

    ids: list[str]


class CardSpritePacksIn(BaseModel):
    """这张卡挂哪些包(整组替换,按顺序)。current 不传 = 原来的当前包还在就留着它,
    不在了换成它后面的下一个"""

    pack_ids: list[str]
    current: str | None = None


class CardSpritePackCurrentIn(BaseModel):
    pack_id: str


class CardSpritePacksOut(BaseModel):
    card_id: str
    pack_ids: list[str]
    # 游戏里正在用的包;一个包都没挂时是 null
    current: str | None


class SpriteLayoutOut(BaseModel):
    auto: bool
    zoom: float
    dx: float
    dy: float


class SpriteLayoutUpdate(BaseModel):
    """全部可选,只改传了的。dx / dy 以舞台高度为单位"""

    auto: bool | None = None
    zoom: float | None = Field(default=None, ge=0.3, le=3)
    dx: float | None = Field(default=None, ge=-2, le=2)
    dy: float | None = Field(default=None, ge=-2, le=2)


# ── 场景包(背景 + BGM 插件) ────────────────────────────────


class ScenePackIn(BaseModel):
    name: str
    description: str = ""


class ScenePackUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    # 显式传 null = 回到默认(排第一的那首);不传 = 不改
    title_bgm_id: str | None = None


class ScenePackOut(BaseModel):
    id: str
    name: str
    description: str
    bg_count: int
    bgm_count: int
    # CG 构图的张数(不算差分)
    cg_count: int = 0
    # 绑了这个包的卡有几张 —— 删包前让人心里有数
    card_count: int
    # 标题画面放的那首;null = 放排第一的
    title_bgm_id: str | None = None
    # 这个包里的 CG 拆成了哪个 CG 包(第 4 期);null = 没拆过,包里的 CG 照旧跟着场景包走
    cg_pack_id: str | None = None


# cg:CG 插件的事件插图。一张 CG(构图)下面可以挂几张差分(parent_id 指向它),
# 差分的名字是立绘的表情名,视觉小说里按当前表情换
SceneKind = Literal["bg", "bgm", "cg"]


class SceneAssetCreate(BaseModel):
    kind: SceneKind
    label: str
    aliases: list[str] = []
    description: str = ""
    # 只有 CG 差分带:它属于哪张 CG
    parent_id: str | None = None


class SceneAssetUpdate(BaseModel):
    """全部可选,逐格编辑。bgm_id 显式传 null 表示「不要默认曲」。"""

    label: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    focus_x: int | None = Field(default=None, ge=0, le=100)
    bgm_id: str | None = None
    enabled: bool | None = None
    # 仅 CG 构图:在哪些状态里出;[] = 不限
    forms: list[str] | None = None


class SceneAssetOut(BaseModel):
    id: str
    pack_id: str
    kind: SceneKind
    label: str
    aliases: list[str]
    description: str
    has_file: bool
    mime: str | None
    size: int
    # 文件版本号(毫秒时间戳),拼进 URL 当缓存键,和立绘的 image_version 一样
    file_version: int
    # 同 SpriteOut.image_sha
    data_sha: str | None = None
    focus_x: int
    bgm_id: str | None
    sort: int
    # 禁用的素材游戏里不用,但留在包里;禁用的曲子仍可以是某个背景的默认曲(游戏里不放)
    enabled: bool
    # CG 差分:它属于哪张 CG;其余素材是 null
    parent_id: str | None = None
    # CG 构图:在哪些状态里出(状态名);[] = 不限。其余素材都是 []
    forms: list[str] = []
    # 从哪来:scene 场景包 / cg CG 包(第 4 期;前端按它拼文件地址)
    source: Literal["scene", "cg"] = "scene"


class SceneAssetReorder(BaseModel):
    """某一类素材(背景、BGM 或 CG)的全部 id,按新顺序排。CG 只排构图,差分不在里面。"""

    kind: SceneKind
    ids: list[str]


class CardScenePackIn(BaseModel):
    pack_id: str | None


class CardScenePartsIn(BaseModel):
    """这张卡的场景包分两栏绑:bg 出背景、bgm 出曲子,各按顺序;一个包可以两边都在。两样都要传"""

    bg: list[str]
    bgm: list[str]


class CardScenePartsOut(BaseModel):
    card_id: str
    bg: list[str]
    bgm: list[str]


# ── CG 包(素材架构设计 3.4,第 4 期)。包里的 CG 用和场景素材同一个形状(SceneAssetOut,kind = cg,source = cg) ──


class CgPackIn(BaseModel):
    name: str
    description: str = ""


class CgPackUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class CgPackOut(BaseModel):
    id: str
    name: str
    description: str
    # 构图的张数(不算差分)
    cg_count: int
    card_count: int
    # 从哪个场景包拆出来的(迁移时拆的才有)
    source_scene_pack_id: str | None = None
    # 生图里点「收藏」建出来的包(AI 生成的 CG);false = 导入的现成 CG
    generated: bool = False


class CgAssetCreate(BaseModel):
    label: str
    aliases: list[str] = []
    description: str = ""
    # 差分带:它属于哪张构图
    parent_id: str | None = None


class CgAssetUpdate(BaseModel):
    label: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    focus_x: int | None = Field(default=None, ge=0, le=100)
    enabled: bool | None = None
    # 仅构图:旧形态卡带用的「在哪些形态出」
    forms: list[str] | None = None


class CgAssetReorder(BaseModel):
    """一个 CG 包里全部构图的 id,按新顺序排(差分不在里面)"""

    ids: list[str]


class CardCgPacksIn(BaseModel):
    pack_ids: list[str]


class CardCgPacksOut(BaseModel):
    card_id: str
    pack_ids: list[str]


class CardScenePackOut(BaseModel):
    card_id: str
    pack_id: str | None


class AppSettingOut(BaseModel):
    key: str
    value: Any


class AppSettingIn(BaseModel):
    value: Any


class CardPrefIn(BaseModel):
    """按卡设置:只放这张卡改了的那几个字段,所以一定是个对象(不是整份插件配置)"""

    value: dict[str, Any]


class CardPrefOut(BaseModel):
    key: str
    value: dict[str, Any]


# ── 语音插件 ──────────────────────────────────────────────

TtsApiType = Literal["gpt_sovits", "indextts"]


class TtsConnectionIn(BaseModel):
    name: str
    api_type: TtsApiType = "gpt_sovits"
    base_url: str
    sample_steps: int = Field(default=64, ge=4, le=128)
    # IndexTTS 的情绪强度;GSV 不用。用户试听:强度高的好,默认 1.0
    emo_alpha: float = Field(default=1.0, ge=0, le=1)


class TtsConnectionUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    sample_steps: int | None = Field(default=None, ge=4, le=128)
    emo_alpha: float | None = Field(default=None, ge=0, le=1)


class TtsConnectionOut(BaseModel):
    id: str
    name: str
    api_type: TtsApiType
    base_url: str
    sample_steps: int
    emo_alpha: float
    # 用这个服务的声音有几个 —— 删之前心里有数
    profile_count: int


class TtsTimingOut(BaseModel):
    """测试连接 / 预热花了多少毫秒"""

    ms: int


class VoiceEmotionIn(BaseModel):
    label: str
    aliases: list[str] = []
    ref_path: str = ""
    # 空着且文件名是「【情绪】原文.wav」时,从文件名取
    prompt_text: str = ""
    # GSV 的辅助参考路径(音色取平均,不用原文);最多 MAX_AUX_REFS 条
    aux_refs: list[str] = []
    # IndexTTS 的 8 维情绪向量;顺序和范围见 app/tts/emotion_presets.py
    emo_vector: list[float] | None = None


class VoiceEmotionUpdate(BaseModel):
    label: str | None = None
    aliases: list[str] | None = None
    ref_path: str | None = None
    prompt_text: str | None = None
    aux_refs: list[str] | None = None
    # 传 null 是清空向量;不传是不动(靠 exclude_unset 区分)
    emo_vector: list[float] | None = None


class VoiceEmotionOut(BaseModel):
    id: str
    profile_id: str
    label: str
    aliases: list[str]
    ref_path: str
    prompt_text: str
    aux_refs: list[str]
    emo_vector: list[float] | None
    sort: int


TextSplitMethod = Literal["cut0", "cut1", "cut2", "cut3", "cut4", "cut5"]


class VoiceParams(BaseModel):
    """一个声音的合成参数。不给 = 用默认:采样步数、情绪强度跟语音服务,其余用引擎自己的默认。
    各引擎只取自己认的(IndexTTS 只认 emo_alpha)。界面上的说明见前端 plugins/voice.ts。"""

    # 拼错的参数名直接报错,不能悄悄当没调
    model_config = ConfigDict(extra="forbid")

    # GPT-SoVITS api_v2
    sample_steps: int | None = Field(default=None, ge=4, le=128)
    temperature: float | None = Field(default=None, gt=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    top_k: int | None = Field(default=None, ge=1, le=100)
    repetition_penalty: float | None = Field(default=None, ge=0, le=2)
    text_split_method: TextSplitMethod | None = None
    fragment_interval: float | None = Field(default=None, ge=0, le=2)
    parallel_infer: bool | None = None
    # IndexTTS
    emo_alpha: float | None = Field(default=None, ge=0, le=1)


class VoiceProfileIn(BaseModel):
    name: str
    aliases: list[str] = []
    connection_id: str
    gpt_weights: str = ""
    sovits_weights: str = ""
    # IndexTTS 的音色参考;GSV 不用
    ref_path: str = ""
    text_lang: str = Field(default="zh", max_length=12)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    params: VoiceParams = VoiceParams()


class VoiceProfileUpdate(BaseModel):
    name: str | None = None
    aliases: list[str] | None = None
    connection_id: str | None = None
    gpt_weights: str | None = None
    sovits_weights: str | None = None
    ref_path: str | None = None
    text_lang: str | None = Field(default=None, max_length=12)
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    # 整组替换:没带的项回到默认
    params: VoiceParams | None = None


class VoiceProfileOut(BaseModel):
    id: str
    name: str
    aliases: list[str]
    connection_id: str
    gpt_weights: str
    sovits_weights: str
    ref_path: str
    text_lang: str
    speed: float
    params: dict[str, Any]
    emotions: list[VoiceEmotionOut]
    card_count: int


class VoiceReorder(BaseModel):
    """这个声音全部情绪的 id,按新顺序排(排第一的是默认)。"""

    ids: list[str]


class VoiceImportIn(BaseModel):
    """语音服务那台机器上每个角色目录里的 refs.json,整份贴进来。格式见 docs/plugins/voice.md。"""

    connection_id: str
    refs: dict[str, Any]
    # 清单没带这里的声音编号、又已经有同名的声音时怎么办:不填 = 回 409 让前端问;
    # update = 更新那个;new = 另建一个(名字后面加数字)
    on_conflict: Literal["update", "new"] | None = None


class VoiceFromSpritesIn(BaseModel):
    """按这张卡当前立绘包的表情补齐情绪行(只对 IndexTTS 的声音)。"""

    card_id: str


class CardVoicesIn(BaseModel):
    main: str | None = None
    extras: list[str] = []


class CardVoicesOut(BaseModel):
    card_id: str
    main: str | None
    extras: list[str]


class VoiceTuning(BaseModel):
    """试音台:这一句不用声音存着的语速、语言、参数,换成这一组(整组替换,不保存)。"""

    speed: float = Field(ge=0.5, le=2.0)
    text_lang: str = Field(min_length=1, max_length=12)
    params: VoiceParams = VoiceParams()
    # 固定随机种子:对比参数时两次用同一个数,差别就只来自参数。只有 GSV 认,也只在这里用
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)


class TtsSpeakIn(BaseModel):
    profile_id: str
    # 这句生效的立绘表情名;情绪表里对不上就用默认情绪
    emotion: str | None = None
    text: str = Field(min_length=1, max_length=500)
    # 重新生成:不看缓存,再合成一遍,新的这版替换缓存里的旧版
    fresh: bool = False
    tuning: VoiceTuning | None = None
    # 拆句拼接开着:登记了拼接的卡带(register_splicer)、这个声音也用得上时拼着念;没有卡带时忽略
    sfx: bool = False
    # 表情认法 = 认词记录时,前端按配对表挑好的那一行;不是这个声音的行就当没传
    emotion_id: str | None = None


class TtsExplainIn(BaseModel):
    """这句会怎么念(不合成),字段和 TtsSpeakIn 一样"""

    profile_id: str
    emotion: str | None = None
    text: str = Field(min_length=1, max_length=500)
    sfx: bool = False
    # 表情认法 = 认词记录时,前端按配对表挑好的那一行;不是这个声音的行就当没传
    emotion_id: str | None = None


class SpliceSegmentOut(BaseModel):
    """拼接时一句拆成的一段(登记了拼接的卡带给的,见 app/api/tts.py 的 register_splicer):
    speech 交给模型念 / sfx 换成素材里的片段"""

    kind: Literal["speech", "sfx"]
    text: str
    category: str | None = None
    clip_id: str | None = None
    clip_text: str | None = None


class TtsExplainOut(BaseModel):
    """一句语音的来龙去脉:挑中哪一行情绪、怎么挑中的、发给语音服务的原样请求、缓存里有没有"""

    profile_name: str
    connection_name: str
    api_type: str
    # 要的情绪(立绘表情名);没传是 None
    wanted: str | None
    # 实际用的情绪行;IndexTTS 没有情绪行时是空串
    emotion: str
    # exact 名字对上 / alias 别名对上 / nearest 模型挑的最像的 / default 没传或对不上,用排第一的 /
    # pairing 配对表挑好的那一行
    how: Literal["exact", "alias", "nearest", "default", "pairing"]
    # alias:对上的别名;nearest:模型认为最像的那个名字(可能是别名)
    via: str | None = None
    # nearest:相似度
    score: float | None = None
    # 情绪从哪来:ref 参考音频 / vector 向量 / none 不控制
    mode: str
    # GSV 的模型权重(IndexTTS 为空串)
    gpt_weights: str
    sovits_weights: str
    # 发给语音服务的请求体,原样
    request: dict[str, Any]
    # 缓存里已经有这句(合成过,重播直接出)
    cached: bool
    # 拼接时的拆分(片段是这次 explain 现挑的,真正合成时会再挑一次);不拼时是 None
    sfx: list[SpliceSegmentOut] | None = None
    # 拼接用的素材的名字
    sfx_pack: str | None = None


class TtsWarmupIn(BaseModel):
    profile_id: str
    # 不信任记住的「当前权重」,强制重新切(手动或用别的脚本切过权重之后)
    force: bool = False


class TtsCacheOut(BaseModel):
    count: int
    bytes: int
    limit_bytes: int


# ── 素材管理页(素材架构第 1 步 B6,app/api/library.py) ──────────────────


class LibraryItemOut(BaseModel):
    """素材管理页列表里的一行:一个包(背景页 / BGM 页是场景包的那一边)或一个声音"""

    id: str
    name: str
    # 立绘张数 / 背景张数 / 曲子首数 / CG 构图数(差分不算)/ 声音的情绪数
    count: int
    # 这一类文件占的地方:同一个文件只算一次(blobs 表的大小,没登记的用行里记的大小);声音是 0(参考在语音机上)
    bytes: int
    # 绑了它的卡:背景页只算出背景的绑定、BGM 页只算出曲子的;声音主的备用的都算。按卡的编号排
    card_ids: list[str]
    # 列表缩略图:排第一的、启用的、有文件的立绘 / 背景 / 构图的指纹(/api/blobs/<sha>?w=);没有、曲子、声音是 null
    cover_sha: str | None
    # 找重复用:这一类文件的指纹排好序的哈希,一样就是重复的包(声音按服务、权重、参考音频的路径算);没文件是 null
    content_key: str | None
    # 来自哪次导入(还没撤销的导入记录里最新的那条);手建的、声音是 null
    import_job_id: str | None
    created_at: datetime
    # 包本身和这一类素材里最后改的那次
    updated_at: datetime
    # 只有 CG 有:生图里收藏建出来的(AI 生成的 CG)
    generated: bool | None = None


class LibraryCardUseOut(BaseModel):
    id: str
    name: str
    # 删了这个包这张卡会怎样,一句话
    effect: str
    # 只有背景 / BGM 页有:这张卡用这个场景包的哪几边(bg / bgm)
    parts: list[str] | None = None


class LibraryFilesOut(BaseModel):
    files: int
    bytes: int


class LibraryUsageOut(BaseModel):
    """删之前问一句用的(设计稿 12.1 10-15:列出还有哪些卡在用、删了它们会怎样,然后直接删)"""

    cards: list[LibraryCardUseOut]
    # 删掉会一起删的文件(场景包是整个包:背景、曲子,还有没拆出去的 CG;声音是情绪的行数,参考音频在语音机上不删)
    files: int
    bytes: int
    # 上面两个数按类分:{bg: {files, bytes}, bgm: {...}} 一类
    by_kind: dict[str, LibraryFilesOut]
    # 场景包另一边也有东西(在背景页删,曲子也一起删):bg / bgm / cg
    other_kinds: list[str]
