"""语音插件:语音服务(连接)的增删改查和测试;合成、预热、缓存。

合成请求由视觉小说界面按句发过来:这里找声音和情绪、查缓存、转给引擎、存缓存。
"""

import dataclasses
import re
import time
from collections.abc import Callable, Sequence
from typing import Protocol
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.voices import list_emotions
from app.contracts import LABEL_MAX
from app.db import get_db
from app.emotion.matcher import Candidate, Match
from app.emotion.service import EmotionUnavailable, get_matcher
from app.models import ApiConnection, TtsConnection, VoiceEmotion, VoiceProfile
from app.schemas import (
    SpliceSegmentOut,
    TtsCacheOut,
    TtsConnectionIn,
    TtsConnectionOut,
    TtsConnectionUpdate,
    TtsExplainIn,
    TtsExplainOut,
    TtsModelsOut,
    TtsModelsPreviewIn,
    TtsSpeakIn,
    TtsTestOut,
    TtsTimingOut,
    TtsWarmupIn,
    VoiceTuning,
)
from app.tts import cache as tts_cache
from app.tts import delivery
from app.tts import files as voice_files
from app.tts.base import TTSEngine, TTSError, VoiceSpec
from app.tts.indextts import emo_mode
from app.tts.openai_speech import OpenAiSpeechEngine
from app.tts.registry import api_key_of, emo_alpha_of, engine_for, forget_engine, model_of

router = APIRouter(prefix="/api/tts", tags=["tts"])

_URL = re.compile(r"^https?://[^\s/]+")
# 至少要有一个字或数字;只有标点时 api_v2 会报「请输入有效文本」
_SPEAKABLE = re.compile(r"\w")


def _ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _load_conn(conn_id: str, db: Session) -> TtsConnection:
    conn = db.get(TtsConnection, conn_id)
    if conn is None:
        raise HTTPException(404, "语音服务不存在")
    return conn


def _engine(conn: TtsConnection) -> TTSEngine:
    try:
        return engine_for(conn)
    except TTSError as e:
        raise HTTPException(e.status, e.message) from e


FISH_OFFICIAL = "https://api.fish.audio"
_OPENAI_TAILS = ("/chat/completions", "/audio/speech", "/models")


def _clean_url(raw: str, api_type: str = "gpt_sovits") -> str:
    """整理地址。Fish 留空 = 官方;中转站去掉结尾的接口名,只有主机时补 /v1"""
    url = raw.strip().rstrip("/")
    if api_type == "fish" and not url:
        return FISH_OFFICIAL
    if not _URL.match(url):
        raise HTTPException(400, "地址要以 http:// 或 https:// 开头,比如 http://127.0.0.1:9880")
    if api_type == "openai":
        for tail in _OPENAI_TAILS:
            if url.endswith(tail):
                url = url[: -len(tail)].rstrip("/")
                break
        if not urlsplit(url).path.strip("/"):
            url += "/v1"
    return url


def _clean_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise HTTPException(400, "名字不能为空")
    return name[:120]


def _profile_count(conn_id: str, db: Session) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(VoiceProfile)
            .where(VoiceProfile.connection_id == conn_id)
        )
        or 0
    )


def _conn_out(conn: TtsConnection, db: Session) -> TtsConnectionOut:
    return TtsConnectionOut(
        id=conn.id,
        name=conn.name,
        api_type=conn.api_type,
        base_url=conn.base_url,
        sample_steps=conn.sample_steps,
        emo_alpha=emo_alpha_of(conn),
        profile_count=_profile_count(conn.id, db),
        has_pair_code=bool(delivery.pair_code_of(conn)),
        has_api_key=bool(api_key_of(conn)),
        model=model_of(conn),
    )


def _llm_source(llm_id: str | None, db: Session) -> ApiConnection | None:
    """模型页的连接(copy_from_llm):给了 id 却找不到就报错"""
    if not llm_id:
        return None
    llm = db.get(ApiConnection, llm_id)
    if llm is None:
        raise HTTPException(400, "模型页里没有这条连接")
    return llm


def _with_option(conn: TtsConnection, key: str, value: str | None) -> None:
    """options 是 JSON 列,要整个换掉;value 为空 = 去掉这一项"""
    opts = {k: v for k, v in (conn.options or {}).items() if k != key}
    conn.options = {**opts, key: value} if value else opts


@router.get("/connections", response_model=list[TtsConnectionOut])
def list_connections(db: Session = Depends(get_db)):
    rows = db.scalars(select(TtsConnection).order_by(TtsConnection.created_at)).all()
    return [_conn_out(c, db) for c in rows]


@router.post("/connections", response_model=TtsConnectionOut)
def create_connection(req: TtsConnectionIn, db: Session = Depends(get_db)):
    llm = _llm_source(req.copy_from_llm, db)
    raw_url = req.base_url if req.base_url.strip() or llm is None else (llm.base_url or "")
    options: dict = {"emo_alpha": req.emo_alpha}
    if req.pair_code.strip():
        options["pair_code"] = req.pair_code.strip()
    key = req.api_key.strip() or ((llm.api_key or "") if llm is not None else "")
    if key:
        options["api_key"] = key
    if req.model.strip():
        options["model"] = req.model.strip()
    conn = TtsConnection(
        name=_clean_name(req.name),
        api_type=req.api_type,
        base_url=_clean_url(raw_url, req.api_type),
        sample_steps=req.sample_steps,
        options=options,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    return _conn_out(conn, db)


@router.put("/connections/{conn_id}", response_model=TtsConnectionOut)
def update_connection(conn_id: str, req: TtsConnectionUpdate, db: Session = Depends(get_db)):
    conn = _load_conn(conn_id, db)
    type_changed = req.api_type is not None and req.api_type != conn.api_type
    if type_changed:
        count = _profile_count(conn_id, db)
        if count:
            raise HTTPException(400, f"还有 {count} 个声音在用这条连接,先给它们换一条")
        conn.api_type = req.api_type
    if req.name is not None:
        conn.name = _clean_name(req.name)
    llm = _llm_source(req.copy_from_llm, db)
    if req.base_url is not None:
        conn.base_url = _clean_url(req.base_url, conn.api_type)
    elif llm is not None and not conn.base_url:
        conn.base_url = _clean_url(llm.base_url or "", conn.api_type)
    elif type_changed:
        conn.base_url = _clean_url(conn.base_url, conn.api_type)
    if req.sample_steps is not None:
        conn.sample_steps = req.sample_steps
    if req.emo_alpha is not None:
        # JSON 列要整个换掉,原地改 SQLAlchemy 看不出变化
        conn.options = {**(conn.options or {}), "emo_alpha": req.emo_alpha}
    if req.pair_code is not None:
        code = req.pair_code.strip()
        opts = {k: v for k, v in (conn.options or {}).items() if k != "pair_code"}
        conn.options = {**opts, "pair_code": code} if code else opts
    if req.api_key and req.api_key.strip():
        _with_option(conn, "api_key", req.api_key.strip())
    elif llm is not None and llm.api_key:
        _with_option(conn, "api_key", llm.api_key)
    elif req.clear_api_key:
        _with_option(conn, "api_key", None)
    if req.model is not None:
        _with_option(conn, "model", req.model.strip())
    db.commit()
    db.refresh(conn)
    if type_changed:
        forget_engine(conn_id)
    delivery.forget(conn_id)
    return _conn_out(conn, db)


@router.delete("/connections/{conn_id}", status_code=204)
def delete_connection(conn_id: str, db: Session = Depends(get_db)):
    conn = _load_conn(conn_id, db)
    count = _profile_count(conn_id, db)
    if count:
        raise HTTPException(400, f"还有 {count} 个声音档案在用这个连接")
    db.delete(conn)
    db.commit()
    forget_engine(conn_id)
    delivery.forget(conn_id)


@router.post("/connections/{conn_id}/test", response_model=TtsTestOut)
async def test_connection(conn_id: str, db: Session = Depends(get_db)):
    conn = _load_conn(conn_id, db)
    engine = _engine(conn)
    start = time.perf_counter()
    try:
        await engine.ping()
    except TTSError as e:
        raise HTTPException(e.status, e.message) from e
    out = TtsTestOut(ms=_ms(start))
    # 云端服务的文件由 AnimaVN 随请求带过去,route 算 same:声音编辑器别再提示手动放文件
    if conn.api_type == "openai":
        return TtsTestOut(ms=out.ms, route="same", model_count=getattr(engine, "last_model_count", None))
    if conn.api_type == "fish":
        return TtsTestOut(ms=out.ms, route="same")
    if conn.api_type in ("gpt_sovits", "indextts"):
        try:
            r = await delivery.route_of(conn, fresh=True)
            out = TtsTestOut(ms=out.ms, route=r.kind, plugin=r.plugin, pair_ok=r.pair_ok)
        except TTSError:
            pass  # ping 通了就算通;文件怎么送下次再问
    return out


def _openai_engine(base_url: str, api_key: str, model: str = "") -> OpenAiSpeechEngine:
    return OpenAiSpeechEngine(_clean_url(base_url, "openai"), model, api_key)


async def _list_models(engine: OpenAiSpeechEngine) -> TtsModelsOut:
    try:
        return TtsModelsOut(models=await engine.list_models())
    except TTSError as e:
        raise HTTPException(e.status, e.message) from e


@router.post("/connections/models-preview", response_model=TtsModelsOut)
async def models_preview(req: TtsModelsPreviewIn, db: Session = Depends(get_db)):
    """中转站还没保存时列模型:用表单里的地址和 key。key 留空时用 connection_id 存着的,再不行抄模型页那条"""
    llm = _llm_source(req.copy_from_llm, db)
    stored = db.get(TtsConnection, req.connection_id) if req.connection_id else None
    url = req.base_url.strip() or (llm.base_url if llm is not None else "") or ""
    key = req.api_key.strip() or (api_key_of(stored) if stored is not None else "") or ((llm.api_key or "") if llm is not None else "")
    return await _list_models(_openai_engine(url, key))


@router.post("/connections/{conn_id}/models", response_model=TtsModelsOut)
async def connection_models(conn_id: str, db: Session = Depends(get_db)):
    conn = _load_conn(conn_id, db)
    if conn.api_type != "openai":
        raise HTTPException(400, "只有中转站能列模型")
    engine = _engine(conn)
    assert isinstance(engine, OpenAiSpeechEngine)
    return await _list_models(engine)


# ── 合成 ──────────────────────────────────────────────


@dataclasses.dataclass(frozen=True)
class EmotionPick:
    """情绪表里挑中的那一行,以及怎么挑中的(/explain 给人排查语音用)"""

    row: VoiceEmotion | None
    # exact 名字对上 / alias 别名对上 / nearest 模型挑的最像的 / default 没传或对不上,用排第一的 /
    # pairing 配对表挑好的那一行(表情认法 = 认词记录时前端带来的行号)
    how: str
    # alias:对上的别名;nearest:模型认为最像的那个名字(可能是别名)
    via: str | None = None
    # nearest:相似度
    score: float | None = None


def pick_emotion(
    emotions: list[VoiceEmotion],
    wanted: str | None,
    nearest: Callable[[str, list[VoiceEmotion]], EmotionPick | None] | None = None,
) -> EmotionPick:
    """名字或别名对上(不分大小写)就用那一行;对不上时交给 nearest 挑最像的一行
    (就近回退:琴柳没有「惊讶」的参考,用最接近的一段,而不是一律念成平静);
    还是没有、或者没传情绪,用排第一的(默认)。"""
    if not emotions:
        return EmotionPick(None, "default")
    key = (wanted or "").strip().casefold()
    if key:
        for e in emotions:
            if e.label.casefold() == key:
                return EmotionPick(e, "exact")
            alias = next((a for a in e.aliases or [] if a.casefold() == key), None)
            if alias is not None:
                return EmotionPick(e, "alias", via=alias)
        if nearest is not None and (near := nearest(wanted.strip(), emotions)) is not None:
            return near
    return EmotionPick(emotions[0], "default")


# 和 /api/emotion/match 的限制一致(名字的长度上限,app/contracts.py)
_MAX_WORD = LABEL_MAX


def voice_candidates(emotions: Sequence[VoiceEmotion]) -> list[Candidate]:
    """给认词模型比的候选:每行语气的名字和别名(去首尾空白,去掉空的和超过 40 字的)。
    填配对表(app/replay/seed.py)也用它,两边挑出来的一样"""
    out = []
    for e in emotions:
        names = tuple(n.strip() for n in (e.label, *(e.aliases or [])) if 0 < len(n.strip()) <= _MAX_WORD)
        if names:
            out.append(Candidate(e.id, names))
    return out


def nearest_with(
    match: Callable[[list[str], list[Candidate]], list[Match]], wanted: str, emotions: Sequence[VoiceEmotion]
) -> EmotionPick | None:
    """用 match(认词模型的一种算法)挑最像的一行;wanted 不合法、没有候选时是 None"""
    if not wanted or len(wanted) > _MAX_WORD:
        return None
    candidates = voice_candidates(emotions)
    if not candidates:
        return None
    m = match([wanted], candidates)[0]
    row = next((e for e in emotions if e.id == m.key), None)
    return EmotionPick(row, "nearest", via=m.name, score=m.score) if row else None


def nearest_emotion(wanted: str, emotions: list[VoiceEmotion]) -> EmotionPick | None:
    """情绪识别模型挑最像的一行(名字和别名都算);模型没装或出错返回 None,由调用方用默认。
    用固定算法(每个词单独算),结果不随后端先算过什么变"""
    if not wanted or len(wanted) > _MAX_WORD or not voice_candidates(emotions):
        return None
    try:
        matcher = get_matcher()
    except EmotionUnavailable:
        return None
    return nearest_with(matcher.match_singles, wanted, emotions)


def _gsv_spec(profile: VoiceProfile, row: VoiceEmotion | None) -> tuple[VoiceSpec, str, str]:
    """GSV 的情绪就是参考音频:这一行必须有参考和原文。
    路径空、有指纹的声音(导进来的)写 blob:<指纹>,发给语音服务前由 delivery 换成实际路径。
    两个权重都得填:留空时语音服务沿用上一次加载的模型,念出来是上一个角色的声音,
    还会按「没填权重」进缓存,以后换了模型也命中这份错的(P21)。零样本就填底模的路径"""
    gpt = delivery.path_or_blob(profile.gpt_weights, profile.gpt_sha)
    sovits = delivery.path_or_blob(profile.sovits_weights, profile.sovits_sha)
    if not (gpt and sovits):
        if profile.files_at == "pending":  # 导进来了,文件还没放到语音机上
            raise HTTPException(400, f"声音「{profile.name}」的文件还没放到语音机上:去声音编辑器把文件放过去")
        raise HTTPException(
            400,
            f"声音「{profile.name}」没填 GPT / SoVITS 权重:留空会沿用语音服务上一次加载的模型,"
            "念出来是别的角色的声音。想用零样本就填底模的路径(GPT_SoVITS/pretrained_models 里的)",
        )
    if row is None:
        raise HTTPException(400, f"声音「{profile.name}」还没有参考音频")
    ref = delivery.path_or_blob(row.ref_path, row.ref_sha)
    if not ref:
        raise HTTPException(400, f"情绪「{row.label}」还没填参考音频路径")
    if not row.prompt_text:
        raise HTTPException(400, f"情绪「{row.label}」还没填参考音频的原文")
    paths, shas = list(row.aux_refs or []), list(row.aux_shas or [])
    aux = tuple(
        a
        for i in range(max(len(paths), len(shas)))
        if (a := delivery.path_or_blob(paths[i] if i < len(paths) else "", shas[i] if i < len(shas) else None))
    )
    spec = VoiceSpec(
        gpt_weights=gpt,
        sovits_weights=sovits,
        ref_path=ref,
        prompt_text=row.prompt_text,
        text_lang=profile.text_lang or "zh",
        speed=profile.speed,
        params=dict(profile.params or {}),
        aux_ref_paths=aux,
    )
    return spec, row.label, "ref"


def _indextts_spec(profile: VoiceProfile, row: VoiceEmotion | None) -> tuple[VoiceSpec, str, str]:
    """IndexTTS:音色参考必填;情绪行可以没有(沿用音色参考的语气),不需要原文。"""
    speaker = delivery.path_or_blob(profile.ref_path, profile.speaker_sha)
    if not speaker:
        raise HTTPException(400, f"声音「{profile.name}」还没填音色参考")
    spec = VoiceSpec(
        gpt_weights="",
        sovits_weights="",
        ref_path=delivery.path_or_blob(row.ref_path, row.ref_sha) if row else "",
        prompt_text="",
        text_lang=profile.text_lang or "zh",
        speed=profile.speed,
        spk_ref_path=speaker,
        emo_vector=tuple(row.emo_vector) if row and row.emo_vector else None,
        params=dict(profile.params or {}),
    )
    return spec, row.label if row else "", emo_mode(spec)


def _fish_spec(profile: VoiceProfile, row: VoiceEmotion | None) -> tuple[VoiceSpec, str, str]:
    """Fish:和 GSV 一样每个情绪是一段参考音频 + 原文,但没有权重"""
    if row is None:
        raise HTTPException(400, f"声音「{profile.name}」还没有参考音频")
    ref = delivery.path_or_blob(row.ref_path, row.ref_sha)
    if not ref:
        raise HTTPException(400, f"情绪「{row.label}」还没填参考音频路径")
    if not row.prompt_text:
        raise HTTPException(400, f"情绪「{row.label}」还没填参考音频的原文")
    spec = VoiceSpec(
        gpt_weights="",
        sovits_weights="",
        ref_path=ref,
        prompt_text=row.prompt_text,
        text_lang=profile.text_lang or "zh",
        speed=profile.speed,
        params=dict(profile.params or {}),
    )
    return spec, row.label, "ref"


def _openai_spec(profile: VoiceProfile, row: VoiceEmotion | None) -> tuple[VoiceSpec, str, str]:
    """中转站:只有音色名(params.voice),没有参考音频、没有情绪"""
    params = dict(profile.params or {})
    if not str(params.get("voice") or "").strip():
        raise HTTPException(400, f"声音「{profile.name}」没填音色名")
    spec = VoiceSpec(
        gpt_weights="",
        sovits_weights="",
        ref_path="",
        prompt_text="",
        text_lang=profile.text_lang or "zh",
        speed=profile.speed,
        params=params,
    )
    return spec, "", "none"


_SPEC_BUILDERS = {"indextts": _indextts_spec, "fish": _fish_spec, "openai": _openai_spec}


@dataclasses.dataclass(frozen=True)
class VoiceChoice:
    """一句要用的声音和语音服务、合成配置、实际用的情绪名、情绪方式(ref / vector / none)、怎么挑的情绪"""

    conn: TtsConnection
    profile: VoiceProfile
    spec: VoiceSpec
    label: str
    mode: str
    pick: EmotionPick


def _voice_for(
    profile_id: str,
    emotion: str | None,
    db: Session,
    tuning: VoiceTuning | None = None,
    emotion_id: str | None = None,
) -> VoiceChoice:
    """声音 + 想要的情绪 → 这句怎么念。
    emotion_id(配对表挑好的那一行)是这个声音自己的一行就直接用;不是、找不到,照旧按名字挑
    (老客户端、配对表没覆盖到的立绘)。
    tuning(试音台)整组替换声音存着的语速、语言和参数,只用于这一次"""
    profile = db.get(VoiceProfile, profile_id)
    if profile is None:
        raise HTTPException(404, "声音不存在")
    conn = db.get(TtsConnection, profile.connection_id)
    if conn is None:
        raise HTTPException(400, f"声音「{profile.name}」没有选语音服务")
    emotions = list_emotions(profile.id, db)
    paired = next((e for e in emotions if e.id == emotion_id), None)
    pick = EmotionPick(paired, "pairing") if paired else pick_emotion(emotions, emotion, nearest_emotion)
    build = _SPEC_BUILDERS.get(conn.api_type, _gsv_spec)
    spec, label, mode = build(profile, pick.row)
    if tuning is not None:
        params = tuning.params.model_dump(exclude_none=True)
        if tuning.seed is not None:
            params["seed"] = tuning.seed
        spec = dataclasses.replace(spec, speed=tuning.speed, text_lang=tuning.text_lang, params=params)
    return VoiceChoice(conn, profile, spec, label, mode, pick)


def _audio(data: bytes, mime: str, cache: str, emotion: str, mode: str) -> Response:
    return Response(
        content=data,
        media_type=mime,
        headers={
            "X-TTS-Cache": cache,
            # 响应头只能是 latin-1,中文情绪名要编码
            "X-TTS-Emotion": quote(emotion),
            # 这句的情绪从哪来:ref = 参考音频,vector = 向量,none = 不控制
            "X-TTS-Emo-Mode": mode,
            "Cache-Control": "no-store",
        },
    )


def _speakable(raw: str) -> str:
    text = raw.strip()
    if not _SPEAKABLE.search(text):
        raise HTTPException(400, "没有要念的文字")
    return text


class SplicePlan(Protocol):
    """拼着念的那一版(卡带登记的拼接器给的):一句拆成几段,有的交给模型念、有的换成素材里的片段"""

    @property
    def label(self) -> str:
        """用的素材的名字(/explain 的 sfx_pack)"""
        ...

    def material(self, base: dict) -> dict:
        """缓存键的材料:把不拼时的那份包一层,拼的和不拼的各存各的"""
        ...

    async def synthesize(self, spec: VoiceSpec, engine: TTSEngine, db: Session) -> tuple[bytes, str]: ...

    def describe(self) -> list[dict]:
        """拆成的几段(/explain 的 sfx,字段见 SpliceSegmentOut)"""
        ...


# 卡带登记的拼接器:这句、这个声音拼不拼,拼的话怎么拼;不拼返回 None。没有卡带登记时请求里的 sfx 当没传
Splicer = Callable[[str, "VoiceChoice", Session], SplicePlan | None]
_splicer: Splicer | None = None


def register_splicer(splicer: Splicer | None) -> None:
    """卡带加载时调;可以重复调"""
    global _splicer
    _splicer = splicer


def _splice_plan(wanted: bool, text: str, v: VoiceChoice, db: Session) -> SplicePlan | None:
    """请求要了拼接、有卡带登记了拼接器、它也说这句拼,才拼"""
    if not wanted or _splicer is None or v.conn.api_type == "openai":
        return None
    return _splicer(text, v, db)


def _material(text: str, v: VoiceChoice, engine: TTSEngine, plan: SplicePlan | None) -> dict:
    """缓存键的材料:不拼时是引擎自己的那份,拼时由拼接的那一版包一层"""
    base = engine.cache_material(text, v.spec)
    return plan.material(base) if plan is not None else base


def _mark_sent(v: VoiceChoice, db: Session) -> None:
    """文件已经送到语音机了:声音编辑器不用再提示手动放"""
    if v.profile.files_at == "pending":
        v.profile.files_at = "sent"
        db.commit()


async def _with_files(v: VoiceChoice, db: Session, run):
    result = await delivery.with_files(db, v.conn, v.spec, run)
    _mark_sent(v, db)
    return result


@router.post("/speak")
async def speak(req: TtsSpeakIn, db: Session = Depends(get_db)):
    text = _speakable(req.text)
    v = _voice_for(req.profile_id, req.emotion, db, req.tuning, req.emotion_id)
    engine = _engine(v.conn)
    plan = _splice_plan(req.sfx, text, v, db)
    if plan is not None:
        key = tts_cache.cache_key(_material(text, v, engine, plan))
        hit = None if req.fresh else tts_cache.cache_get(db, key)
        if hit is not None:
            return _audio(*hit, cache="hit", emotion=v.label, mode=v.mode)
        try:
            data, mime = await _with_files(v, db, lambda s: plan.synthesize(s, engine, db))
        except TTSError as e:
            raise HTTPException(e.status, e.message) from e
        tts_cache.cache_put(db, key, data, mime)
        return _audio(data, mime, cache="miss", emotion=v.label, mode=v.mode)
    key = tts_cache.cache_key(engine.cache_material(text, v.spec))
    # 每次合成的随机种子不同,重新生成就是换一种念法
    hit = None if req.fresh else tts_cache.cache_get(db, key)
    if hit is not None:
        return _audio(*hit, cache="hit", emotion=v.label, mode=v.mode)
    try:
        data, mime = await _with_files(v, db, lambda s: engine.synthesize(text, s))
    except TTSError as e:
        raise HTTPException(e.status, e.message) from e
    tts_cache.cache_put(db, key, data, mime)
    return _audio(data, mime, cache="miss", emotion=v.label, mode=v.mode)


@router.post("/explain", response_model=TtsExplainOut)
def explain(req: TtsExplainIn, db: Session = Depends(get_db)):
    """这句会怎么念:和 /speak 同一套挑法,但不合成、不碰语音服务。
    挑中哪一行情绪、怎么挑中的、发给语音服务的原样请求、缓存里有没有 —— 视觉小说「历史」排查语音用"""
    text = _speakable(req.text)
    v = _voice_for(req.profile_id, req.emotion, db, emotion_id=req.emotion_id)
    engine = _engine(v.conn)
    plan = _splice_plan(req.sfx, text, v, db)
    material = _material(text, v, engine, plan)
    return TtsExplainOut(
        profile_name=v.profile.name,
        connection_name=v.conn.name,
        api_type=v.conn.api_type,
        wanted=req.emotion,
        emotion=v.label,
        how=v.pick.how,
        via=v.pick.via,
        score=v.pick.score,
        mode=v.mode,
        gpt_weights=v.spec.gpt_weights,
        sovits_weights=v.spec.sovits_weights,
        request=engine.request_body(text, v.spec),
        cached=tts_cache.cache_has(db, tts_cache.cache_key(material)),
        sfx=[SpliceSegmentOut(**d) for d in plan.describe()] if plan else None,
        sfx_pack=plan.label if plan else None,
    )


@router.get("/reference")
async def reference_audio(profile_id: str, path: str, db: Session = Depends(get_db)):
    """声音配的一段参考音频(音色参考,或者某一行情绪的参考),从语音服务那台机器上原样取回 ——
    「语音详情」里试听原声用。只放行这个声音自己配过的路径,不做成能读任意文件的转发"""
    profile = db.get(VoiceProfile, profile_id)
    if profile is None:
        raise HTTPException(404, "声音不存在")
    known = {profile.ref_path}
    for e in list_emotions(profile.id, db):
        known.update([e.ref_path, *(e.aux_refs or [])])
    slots = voice_files.slots_of(db, profile)
    known.update(delivery.blob_ref(s.sha) for s in slots if s.sha)  # 导进来的声音,请求里写的是 blob:<指纹>
    if not path or path not in known:
        raise HTTPException(404, "这个声音没有配这段参考音频")
    # 声音包导进来的(第 4 步):文件就在本机的文件仓库里,不用问语音服务
    for slot in slots:
        if path in (slot.path, delivery.blob_ref(slot.sha)) and (disk := voice_files.file_of(db, slot)) is not None:
            return Response(content=disk.read_bytes(), media_type=voice_files.mime_of(db, slot), headers={"Cache-Control": "private, max-age=600"})
    conn = db.get(TtsConnection, profile.connection_id)
    if conn is None:
        raise HTTPException(400, f"声音「{profile.name}」没有选语音服务")
    try:
        data, mime = await _engine(conn).reference_audio(path)
    except TTSError as e:
        raise HTTPException(e.status, e.message) from e
    # 同一段在一次打开里常会反复听;台式机上换了文件,最多十分钟后听到新的
    return Response(content=data, media_type=mime, headers={"Cache-Control": "private, max-age=600"})


@router.post("/warmup", response_model=TtsTimingOut)
async def warmup(req: TtsWarmupIn, db: Session = Depends(get_db)):
    """用这个声音的默认情绪合成一句,不进缓存。服务刚启动时要等 30–40 秒。"""
    v = _voice_for(req.profile_id, None, db)
    engine = _engine(v.conn)
    start = time.perf_counter()
    try:
        await _with_files(v, db, lambda s: engine.warmup(s, req.force))
    except TTSError as e:
        raise HTTPException(e.status, e.message) from e
    return TtsTimingOut(ms=_ms(start))


@router.get("/cache", response_model=TtsCacheOut)
def cache_stats(db: Session = Depends(get_db)):
    count, total = tts_cache.cache_stats(db)
    return TtsCacheOut(count=count, bytes=total, limit_bytes=tts_cache.CACHE_LIMIT)


@router.delete("/cache", status_code=204)
def clear_cache(db: Session = Depends(get_db)):
    tts_cache.cache_clear(db)
