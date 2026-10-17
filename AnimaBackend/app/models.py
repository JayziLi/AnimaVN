import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ApiConnection(Base):
    """A user-defined LLM API connection profile (SillyTavern-style)."""

    __tablename__ = "api_connections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    api_type: Mapped[str] = mapped_column(String(32))  # "openai_compatible" | "anthropic" | "mock"
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model: Mapped[str] = mapped_column(String(200), default="")
    cached_models: Mapped[list] = mapped_column(JSON, default=list)
    cached_models_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=False)
    # per-connection because support is a property of the endpoint, not of us:
    # plenty of relays advertise the OpenAI dialect but choke on stream=True
    stream: Mapped[bool] = mapped_column(default=True)
    # 思考深浅:None = 不传,跟服务默认;off / low / high / max(见 app/llm/thinking.py)
    thinking: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TavernCard(Base):
    """A SillyTavern character card (V2/V3), stored field-for-field.

    The card is prompt material only; presentation (sprites, scene packs, voices)
    hangs off it in separate tables keyed by card_id.
    """

    __tablename__ = "tavern_cards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    personality: Mapped[str] = mapped_column(Text, default="")
    scenario: Mapped[str] = mapped_column(Text, default="")
    first_mes: Mapped[str] = mapped_column(Text, default="")
    mes_example: Mapped[str] = mapped_column(Text, default="")
    # these two override the preset's main / jailbreak blocks at assembly time
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    post_history_instructions: Mapped[str] = mapped_column(Text, default="")
    creator_notes: Mapped[str] = mapped_column(Text, default="")
    alternate_greetings: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    creator: Mapped[str] = mapped_column(String(200), default="")
    character_version: Mapped[str] = mapped_column(String(60), default="")
    character_book: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    extensions: Mapped[dict] = mapped_column(JSON, default=dict)
    spec: Mapped[str] = mapped_column(String(40), default="chara_card_v2")
    # data: URL of the card's PNG; served separately so list responses stay light
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 这张卡上次打开的对话 —— 对齐 ST 存在角色身上的 `character.chat`。
    # 没有它就只能按 updated_at 挑「最近改过的」,那不是「上次打开的」:
    # 光是读一条旧对话不会动 updated_at,切走再切回来就会跳到别的对话上。
    # 故意不加 FK:对话可以先于卡被删,悬空的指针在读取侧回退到最近一条。
    last_chat_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class SpritePack(Base):
    """立绘包:一整套表情立绘(比如香奈美的舞台装、私服各一套)。

    和场景包一样不属于某张卡:通过 CardSpritePack 挂到卡上,一张卡可以挂几个包、
    游戏里随时换;同一个包也能挂在好几张卡上。名字全局唯一(撞名由接口拦)。
    """

    __tablename__ = "sprite_packs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class PackSprite(Base):
    """立绘包里的一条「表情名 → 立绘图」映射。

    AI 在正文里写的是 label(或 aliases 里的任何一个),前端按它找到这一行的图。
    表情名只在一个包里唯一 —— 几个包最好用同一套名字,换包时才对得上;
    标签格式是全局的,在 AppSetting 里。

    图直接存成 BLOB,而不是落盘文件:部署脚本的备份只拷数据库,单独的素材目录
    会被漏掉;删包时连行一起删就行,不用另外管文件的生命周期。
    image 列是 deferred 的 —— 列映射表时不会把图一起拖出来,只有取图的端点才读它。
    """

    __tablename__ = "pack_sprites"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    pack_id: Mapped[str] = mapped_column(ForeignKey("sprite_packs.id"), index=True)
    label: Mapped[str] = mapped_column(String(80))
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    # 给 AI 看的一句用法说明,{{sprites}} 宏展开时跟在表情名后面
    description: Mapped[str] = mapped_column(Text, default="")
    image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    mime: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # 图在文件仓库里的指纹(app/storage,第 3 期):有它、文件也在时从文件出图;null = 还没复制进去
    image_sha: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # 排第一的是默认表情:一条回复里还没出现标签时用它
    sort: Mapped[int] = mapped_column(Integer, default=0)
    # 关掉 = 游戏里当它不存在(不进 {{sprites}}、不认它的名字),但行和图都留着,
    # 随时能再打开。名字照样占着,免得打开时和别的行撞名
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # 图里的脸在哪(app/sprite_faces.py 的结果),视觉小说按它对齐。null = 还没找过
    face_scan: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    # 视觉小说换到这张图时放的特效 {"motion", "bubble", "sound"}(碧蓝档案那种跳一下、头顶冒气泡、
    # 响一声),见 schemas.SpriteEffect。null = 没设,和以前一样只淡入
    effect: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class SpritePackLayout(Base):
    """一个立绘包在视觉小说里怎么摆:在按脸自动对齐的基础上再挪一挪、放大缩小。
    跟着包走而不是跟着卡:它补的是这套图本身的构图,包挂到别的卡上也该带着。
    所有角色共用的「人物大小」「头的高度」在立绘插件的全局配置里。
    dx / dy 以舞台高度为单位,正数往右 / 往下。"""

    __tablename__ = "sprite_pack_layouts"

    pack_id: Mapped[str] = mapped_column(ForeignKey("sprite_packs.id"), primary_key=True)
    # 关掉 = 不按脸对齐,回到撑满舞台高度、居中
    auto: Mapped[bool] = mapped_column(Boolean, default=True)
    zoom: Mapped[float] = mapped_column(Float, default=1.0)
    dx: Mapped[float] = mapped_column(Float, default=0.0)
    dy: Mapped[float] = mapped_column(Float, default=0.0)


class CardSpritePack(Base):
    """角色卡 → 立绘包,多对多。一张卡挂着的包按 sort 排,其中正好一个 is_current:
    游戏里用的就是它,换了以后这张卡所有对话、存档都用新的(存在这里而不是前端设置里,
    标题画面要给每张卡取当前包的脸)。

    老表 card_sprites / card_sprite_layouts 由 scripts/migrate_sprite_packs.py 搬过来,
    之后不再使用,等确认没问题再删。"""

    __tablename__ = "card_sprite_packs"

    card_id: Mapped[str] = mapped_column(ForeignKey("tavern_cards.id"), primary_key=True)
    pack_id: Mapped[str] = mapped_column(
        ForeignKey("sprite_packs.id"), primary_key=True, index=True
    )
    sort: Mapped[int] = mapped_column(Integer, default=0)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)


class AppSetting(Base):
    """全局设置的键值表,目前只存插件配置(比如 plugin.sprite)。

    存在库里而不是 localStorage:标签格式决定前端怎么解析 AI 的输出,
    手机和电脑必须读到同一份,否则会出现一边能解析、另一边解析不了的情况。
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class JevUsage(Base):
    """Jev 用了多少(app/annotate/usage.py):一天一行,问一次加一次。只数 token 不算钱 ——
    走中转的价格各不一样。新表,启动时 create_all 建,不用迁移步骤"""

    __tablename__ = "jev_usage"

    # 本机日期 YYYY-MM-DD
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)


class CardPref(Base):
    """按卡设置(素材架构设计 2.9、第 2 期):一张卡在全局设置(app_settings)之上另外改的几项。

    key 和全局设置同一个键(比如 plugin.cg);value 只存这张卡改了的那几个字段
    (比如 {"jev": {"threshold": 0.75}}),没改的照用全局,合并在前端做。
    没有这一行 = 这张卡完全照全局。删卡时一起删,复制卡时一起复制。"""

    __tablename__ = "card_prefs"

    card_id: Mapped[str] = mapped_column(ForeignKey("tavern_cards.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ScenePack(Base):
    """场景包:一组背景 + BGM,给视觉小说的背景插件和 BGM 插件用。

    场景素材不属于某张卡:同一个世界观的角色(比如罗德岛上的干员)
    共用一套场景和音乐,一首曲子几 MB,没必要每张卡存一份。卡通过
    CardScenePack 绑定一个包,多张卡可以绑同一个。
    """

    __tablename__ = "scene_packs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    # 标题画面(封面)放哪首:包里的一条 bgm;NULL = 放排第一的那首
    title_bgm_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class SceneAsset(Base):
    """场景包里的一条素材:背景图(kind=bg)、背景音乐(kind=bgm)或 CG(kind=cg)。

    和立绘一样,AI 在正文里写 label(或 aliases 里的任何一个),前端按它找到这一行。
    文件存 BLOB(理由同 PackSprite),data 列 deferred。

    CG 分两层:构图(parent_id 为空,AI / Jev 点的是它)和它下面的差分(parent_id 指向构图,
    label 是立绘的表情名)。视觉小说按当前表情挑差分,没有对应的就用构图本身那张。
    """

    __tablename__ = "scene_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    pack_id: Mapped[str] = mapped_column(ForeignKey("scene_packs.id"), index=True)
    kind: Mapped[str] = mapped_column(String(8))  # "bg" | "bgm" | "cg"
    label: Mapped[str] = mapped_column(String(80))
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    mime: Mapped[str | None] = mapped_column(String(40), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    # 文件在文件仓库里的指纹(同 PackSprite.image_sha)
    data_sha: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # 同类素材里排第一的是默认:对话里还没出现背景标签时用它
    sort: Mapped[int] = mapped_column(Integer, default=0)
    # 仅背景:竖屏只看得到横图中间一窄条,这个百分比决定对准哪儿(0 最左,100 最右)
    focus_x: Mapped[int] = mapped_column(Integer, default=50)
    # 仅背景:换到这个场景时自动换上的曲子(同一个包里的一条 bgm)。CG 不带曲子
    bgm_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 仅 CG 差分:它属于哪张 CG(同一个包里一条没有 parent 的 cg)
    parent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # 仅 CG 构图:在哪些状态里出(存状态的名字,由形态卡带定;没装时不读);空 = 不限。
    # 状态靠名字和立绘那边对上,差分跟着构图
    forms: Mapped[list] = mapped_column(JSON, default=list)
    # 同 PackSprite.enabled。包是几张卡共用的,关了对这些卡都生效
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CgPack(Base):
    """CG 包(素材架构设计 3.4,第 4 期):一个角色在一个场景里的一组 CG,和场景包一样外置、单独绑到卡上
    (卡级绑定,app/bindings.py 的 cg)。谁绑了它,谁才会出这些 CG。
    source_scene_pack_id:从哪个场景包拆出来的(迁移时拆的才有)。旧的场景素材接口往这个场景包里写 CG 时,
    同时写进这个 CG 包(转接层,清理期以前两边都写)"""

    __tablename__ = "cg_packs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    source_scene_pack_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # 生图卡带里点「收藏」建出来的包(「AI 生图 · 卡名」)。素材页把它放进「AI 生成」那一栏,不和导入的现成 CG 混在一起;
    # 游戏里照样能被 AI / Jev 选到
    generated: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CgAsset(Base):
    """CG 包里的一条:构图(parent_id 为空,AI / Jev 点的是它)或者它下面的差分(label 是立绘的表情名),
    规则和以前场景包里的 CG 一样(SceneAsset 的说明)。迁过来的沿用 scene_assets 那一行的编号,
    所以配对表、Jev 标注里记的编号不用换;原件按指纹指向同一份文件,库里不再存第二份(data 是空的,
    读的时候按指纹到场景素材那一行找)。forms 是旧形态卡带用的,第 6 期随它删"""

    __tablename__ = "cg_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    pack_id: Mapped[str] = mapped_column(ForeignKey("cg_packs.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(80))
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    mime: Mapped[str | None] = mapped_column(String(40), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    data_sha: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    focus_x: Mapped[int] = mapped_column(Integer, default=50)
    forms: Mapped[list] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CardScenePack(Base):
    """角色卡 → 场景包。单独一张表而不是给 tavern_cards 加列:建表靠 create_all,
    它不会给已有的表补列。"""

    __tablename__ = "card_scene_packs"

    card_id: Mapped[str] = mapped_column(ForeignKey("tavern_cards.id"), primary_key=True)
    pack_id: Mapped[str] = mapped_column(ForeignKey("scene_packs.id"), index=True)


class TtsConnection(Base):
    """语音插件:一个语音合成服务(目前只有 GPT-SoVITS api_v2)。

    和 LLM 的 ApiConnection 分开放:字段几乎不重合(没有 key / model,多了采样步数)。
    """

    __tablename__ = "tts_connections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    api_type: Mapped[str] = mapped_column(String(32), default="gpt_sovits")
    base_url: Mapped[str] = mapped_column(String(500))
    # GPT-SoVITS v3/v4 的采样步数。用户试听选了 64:比 32 慢一半,听感更好
    sample_steps: Mapped[int] = mapped_column(Integer, default=64)
    # 留给以后别的引擎放自己的参数
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class VoiceProfile(Base):
    """一个声音:用哪个语音服务、哪套模型权重。

    权重和参考音频都在语音服务那台机器上,这里只存路径 —— api_v2 只认服务端本地路径,
    没有上传接口。和场景包一样不属于某张卡,通过 CardVoice 绑定。
    """

    __tablename__ = "voice_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    # 台词前写「名字：」时,按名字 / 别名找声音
    name: Mapped[str] = mapped_column(String(80))
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    connection_id: Mapped[str] = mapped_column(ForeignKey("tts_connections.id"), index=True)
    gpt_weights: Mapped[str] = mapped_column(String(500), default="")
    sovits_weights: Mapped[str] = mapped_column(String(500), default="")
    # IndexTTS 的音色参考(语音服务那台机器上的路径)。GSV 不用:音色在权重里
    ref_path: Mapped[str] = mapped_column(String(500), default="")
    text_lang: Mapped[str] = mapped_column(String(12), default="zh")
    speed: Mapped[float] = mapped_column(Float, default=1.0)
    # 调过的合成参数(schemas.VoiceParams,只存调过的项);空 = 全用默认
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class VoiceEmotion(Base):
    """声音的一种情绪 = 一段参考音频 + 它的原文。GPT-SoVITS 的语气跟着参考音频走,
    所以换情绪就是换参考。

    IndexTTS 的声音:ref_path 是可选的情绪参考(可以是别的角色的声音),不需要原文;
    没填情绪参考时用 emo_vector,两个都没有就沿用音色参考的语气。

    label / aliases 和立绘的表情名对应:这句生效的立绘表情是「开心」,就用叫「开心」的
    这一行;对不上就用排第一的(默认)。
    """

    __tablename__ = "voice_emotions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(ForeignKey("voice_profiles.id"), index=True)
    label: Mapped[str] = mapped_column(String(80))
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    ref_path: Mapped[str] = mapped_column(String(500), default="")
    # 参考音频里说的话,要一字不差
    prompt_text: Mapped[str] = mapped_column(Text, default="")
    # GSV 的辅助参考(语音服务那台机器上的路径):音色取这几段和主参考的平均,语气、节奏
    # 还是跟主参考走,所以不用原文。只有 v2 / v2Pro 系列的模型认,v3 / v4 只用主参考
    aux_refs: Mapped[list] = mapped_column(JSON, default=list)
    # IndexTTS 的 8 维情绪向量 [高兴, 愤怒, 悲伤, 害怕, 厌恶, 忧郁, 惊讶, 平静];空 = 不用向量
    emo_vector: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CardVoice(Base):
    """角色卡 → 声音。每张卡最多一个主声音(念这张卡角色自己的台词);其他声音
    在台词前的「名字：」对上时才念(一张卡里有好几个角色时)。"""

    __tablename__ = "card_voices"

    card_id: Mapped[str] = mapped_column(ForeignKey("tavern_cards.id"), primary_key=True)
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("voice_profiles.id"), primary_key=True, index=True
    )
    is_main: Mapped[bool] = mapped_column(default=False)


class CardRole(Base):
    """角色位(素材架构设计 3.2、3.3,第 4 期):卡和素材之间的一层。每张卡至少一个主角色位(就是卡本身);
    一卡多人的卡(Risu 那种双人卡)第 6 期起才有配角位。立绘包、声音绑在角色位上,场景包、CG 包绑在卡上。
    名字默认 = 建它时的卡名;别名给「名字:」前缀认人用(第 6 期)"""

    __tablename__ = "card_roles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    card_id: Mapped[str] = mapped_column(ForeignKey("tavern_cards.id"), index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    aliases: Mapped[list] = mapped_column(JSON, default=list)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CardStateGroup(Base):
    """状态组(素材架构设计 3.5,第 4 期):几张卡是同一个角色的几个状态(比如普通 / 换了衣服),游戏顶栏点一下就切。
    main_card_id 是主卡:选角页、封面用它;对话一般从它开局。没加过状态的卡没有组,行为和以前一样"""

    __tablename__ = "card_state_groups"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    main_card_id: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CardState(Base):
    """组里的一张状态卡:状态名、顺序、要不要在选角页单独显示。主卡也有一行(状态名默认「普通」)。
    一张卡只能在一个组里。卡和预设本身不加字段;对话里在哪一句切到哪张卡记在 swipe_info 的 vn.state"""

    __tablename__ = "card_states"

    card_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("card_state_groups.id"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    show_in_pick: Mapped[bool] = mapped_column(Boolean, default=False)


class AssetBinding(Base):
    """卡 → 素材的一条绑定(素材架构设计 3.2)。读写都走 app/bindings.py。

    kind:sprite 立绘包 / voice 声音(这两种绑在角色位上,role_id 是角色位)/ scene 场景包 / cg CG 包
    (这两种绑在卡上,role_id 是空串;不用 NULL,SQLite 的唯一约束不管 NULL)。
    同一种按 sort 排;is_primary:立绘包里「当前」那个、声音里的主声音(其余是备用声音)。
    parts:场景包分成背景、BGM 两栏绑(第 1 步),包本身不拆。
    旧表 card_sprite_packs / card_voices / card_scene_packs 在清理期以前照旧写一份(退回旧代码用)"""

    __tablename__ = "asset_bindings"
    __table_args__ = (UniqueConstraint("card_id", "role_id", "kind", "target_id", name="uq_asset_bindings_target"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    card_id: Mapped[str] = mapped_column(ForeignKey("tavern_cards.id"), index=True)
    role_id: Mapped[str] = mapped_column(String(32), default="")
    kind: Mapped[str] = mapped_column(String(8))
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    # 只对场景包有意义:这个包给这张卡出什么。'' = 背景和 BGM 都出、'bg' = 只出背景、'bgm' = 只出曲子
    parts: Mapped[str] = mapped_column(String(8), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TtsCache(Base):
    """合成过的语音。GPT-SoVITS 每次请求的随机种子不同,同一句重算语气会变;回看、重播
    要听到同一段,所以按「权重 + 请求体」的哈希存下来。data 列 deferred,统计时不拖出来。"""

    __tablename__ = "tts_cache"
    # 算总大小、按最久没用排队淘汰,只读这个索引。size / last_used_at 在表里排在音频后面,
    # SQLite 扫表取它们得把每段音频的数据页翻一遍:缓存到 500 MB 时每存一句多花 0.7–1.3 秒。
    # 老库用 scripts/migrate_tts_cache_evict_index.py 补上
    __table_args__ = (Index("ix_tts_cache_evict", "last_used_at", "size", "key"),)

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    mime: Mapped[str] = mapped_column(String(40))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Blob(Base):
    """文件仓库(app/storage)里的一个文件:按内容的 sha256 存在 data/blobs/<前两位>/<sha>.<扩展名>,
    放进去就不再改。这张表记它的类型和大小,出文件、清理、体检都按它来"""

    __tablename__ = "blobs"

    sha: Mapped[str] = mapped_column(String(64), primary_key=True)
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class MaintenanceJob(Base):
    """后台慢活(复制进文件仓库一类)的进度,设置页显示。一种活一行,能续传"""

    __tablename__ = "maintenance_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # pending / running / done / failed
    state: Mapped[str] = mapped_column(String(16), default="pending")
    done: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ImportJob(Base):
    """一次导入(素材架构第 1 步 B5;设计稿 6.2、6.6):建了哪些卡和包、往原有的卡上加了哪些绑定、改了哪些卡,
    还有报告和还没认领的暂存文件。编号就是导入计划的编号(暂存目录 import-staging/<id>/),一个计划只执行一次。
    撤销照这里记的删、拿掉、改回去(app/importer/jobs.py)。新表,启动时 create_all 建,不用迁移步骤"""

    __tablename__ = "import_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # 一行摘要:「刻晴.png + 3 个文件夹」
    title: Mapped[str] = mapped_column(String(200), default="")
    # 拖到的那张卡;导完要打开的那张卡(新建的第一张,或者拖到的卡;都没有是 null)
    target_card_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    card_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # done / undone
    status: Mapped[str] = mapped_column(String(16), default="done")
    # 这次新建的:{cards: [], sprite_packs: [], scene_packs: [], cg_packs: []}
    created: Mapped[dict] = mapped_column(JSON, default=dict)
    # 加到原有卡上的绑定:[{card_id, kind, target_id, parts?, added?, previous_primary?}]
    bound: Mapped[list] = mapped_column(JSON, default=list)
    # 选了「更新这张卡」的:{card_id: 改之前的字段}
    replaced_cards: Mapped[dict] = mapped_column(JSON, default=dict)
    report: Mapped[list] = mapped_column(JSON, default=list)
    # 还没认领的暂存文件(相对路径)
    unknown: Mapped[list] = mapped_column(JSON, default=list)
    # 提示条第一句用的:{main: 主文件名, kinds: [绑上的类型], has_packs: bool}
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PromptPreset(Base):
    """A SillyTavern Chat Completion preset, stored as-is.

    prompts = the block library; prompt_order = which blocks are used and in what
    order, grouped by character_id. Both kept raw so a preset round-trips through
    us unchanged.
    """

    __tablename__ = "prompt_presets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    prompts: Mapped[list] = mapped_column(JSON, default=list)
    prompt_order: Mapped[list] = mapped_column(JSON, default=list)
    formats: Mapped[dict] = mapped_column(JSON, default=dict)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    squash_system_messages: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class DebugChat(Base):
    """A prompt-console chat. Columns shadow the SillyTavern chat jsonl header
    (user_name / character_name / tainted), plus a parent pointer reserved for
    branch-from-here.

    card_id / preset_id are SET NULL by the delete endpoints (not by the FK
    itself — SQLite only enforces that with a per-connection pragma we don't
    set): the chat outlives its card because every swipe carries a full prompt
    snapshot. The frozen *_name columns keep the list readable afterwards.
    """

    __tablename__ = "debug_chats"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), default="")
    card_id: Mapped[str | None] = mapped_column(
        ForeignKey("tavern_cards.id"), nullable=True, index=True
    )
    preset_id: Mapped[str | None] = mapped_column(ForeignKey("prompt_presets.id"), nullable=True)
    card_name: Mapped[str] = mapped_column(String(200), default="")
    preset_name: Mapped[str] = mapped_column(String(200), default="")
    user_name: Mapped[str] = mapped_column(String(120), default="User")
    # pristine greeting vs edited chat — decides right-swipe behavior, like ST
    tainted: Mapped[bool] = mapped_column(default=False)
    # batch 4 (branch-from-here): the chat this one was forked from, and the
    # message it forked at. No FK on purpose — deleting a parent promotes the
    # children back to roots in the tree instead of cascading.
    parent_chat_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    parent_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # macro variables set by {{setvar}} & co. — ST keeps these in the chat file's
    # chat_metadata.variables; name → string or number
    variables: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class DebugChatMessage(Base):
    """One message row of a debug chat. The id is the frontend entry's UUID —
    stable across saves, so the console can upsert single rows per operation
    instead of rewriting the whole chat.

    swipes / swipe_id / swipe_info mirror the ST jsonl fields one-to-one.
    swipe_info entries arrive with an embedded prompt snapshot; the API strips
    it into debug_snapshots and leaves only the hash behind.
    """

    __tablename__ = "debug_chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chat_id: Mapped[str] = mapped_column(ForeignKey("debug_chats.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(20))  # "user" | "assistant"
    swipes: Mapped[list] = mapped_column(JSON, default=list)
    swipe_id: Mapped[int] = mapped_column(Integer, default=0)
    swipe_info: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DebugSnapshot(Base):
    """A prompt snapshot, content-addressed by its hash.

    Regenerations usually resend the identical prompt, so the same hash recurs
    across swipes and messages — storing it once keeps long chats small.
    """

    __tablename__ = "debug_snapshots"

    hash: Mapped[str] = mapped_column(String(16), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Persona(Base):
    """玩家人设(SillyTavern Persona Management 的对应物):名字 + 描述,
    激活的那一个决定 {{user}} 宏替换成谁、以及系统提示词里的玩家段落。
    """

    __tablename__ = "personas"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    # data URL,和角色卡头像一个存法(酒馆那边是 512×768 的 png 文件)
    avatar: Mapped[str | None] = mapped_column(Text, default=None)
    is_active: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WordRecord(Base):
    """认词记录(素材架构设计 1.4):一份表情名单里「这个原词以前认成了哪一项」。

    AI 写的表情词对不上名单里的名字和别名时先查这里;没记过才让本地认词模型(固定算法:每个词单独算)
    挑一项,挑完记下来,以后同一个词直接用,不再随后端重启、随一起算的词变。
    list_ref 是名单:pack:<立绘包 id>(有立绘的卡)/ builtin(内置的 16 个);item 是名单里的一项:立绘的 id / 内置表情的名字。
    source:migrated 迁移时按旧结果 / model 游戏里模型认的 / rename 改名留下的 / player 你改的。
    guessed:这一项是模型猜的;unstable:今天的结果本来就随批次变(单独算和一起算挑的不一样)。
    """

    __tablename__ = "word_records"
    __table_args__ = (UniqueConstraint("list_ref", "word", name="uq_word_records_list_word"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_ref: Mapped[str] = mapped_column(String(80))
    word: Mapped[str] = mapped_column(String(40))
    item: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(16))
    guessed: Mapped[bool] = mapped_column(Boolean, default=False)
    unstable: Mapped[bool] = mapped_column(Boolean, default=False)
    # 模型给的相似度;不是模型认的是 null
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Pairing(Base):
    """配对表(素材架构设计 1.6.4):一份表情名单的每一项,配一个跟着表情换的素材 —— 声音里哪段语气(follower=voice)、
    CG 构图的哪张差分(follower=cg)。按「名单 × 声音」「名单 × CG 构图」存:几张卡用同一个立绘包和同一个声音就共用一张。
    card_id 不是空的那张是只给这张卡另存的(配对页做),游戏里先查它再查共用的。
    第 1b 期只建表、按今天的结果填好;第 1c 期语音和 CG 才改成查它。"""

    __tablename__ = "pairings"
    __table_args__ = (UniqueConstraint("follower", "list_ref", "target", "card_id", name="uq_pairings_scope"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    follower: Mapped[str] = mapped_column(String(8))
    list_ref: Mapped[str] = mapped_column(String(80))
    # 跟的那一边:声音的 id / CG 构图(场景素材)的 id
    target: Mapped[str] = mapped_column(String(32))
    # 空 = 共用。用空字符串不用 NULL:SQLite 的唯一约束不管 NULL,同一张共用表会存出两份
    card_id: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class PairingRow(Base):
    """配对表的一格:名单里的一项 → 声音的一行语气 / CG 的一张差分(value 空 = 用构图本身那张)。
    source:migrated 迁移时按旧结果 / name 名字对上 / chat 聊天模型配的 / jev / local 本地模型 / player 你改的。
    guessed:今天是认词模型猜的;pending:待重配;unstable:今天的结果本来就随批次变"""

    __tablename__ = "pairing_rows"

    pairing_id: Mapped[str] = mapped_column(ForeignKey("pairings.id"), primary_key=True)
    item: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str] = mapped_column(String(16))
    guessed: Mapped[bool] = mapped_column(Boolean, default=False)
    pending: Mapped[bool] = mapped_column(Boolean, default=False)
    unstable: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
