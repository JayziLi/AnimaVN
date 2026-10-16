"""IndexTTS 的情绪向量:校验,以及「立绘表情名 → 默认向量」这张表。

向量 8 维,顺序是 IndexTTS 官方定的。每维 0–1.2,合计不超过 1.5 —— 再高会明显影响
音色相似度(见 docs/superpowers/specs/2026-09-24-indextts-engine-design.md)。
维度、上限和内置表情的名字前后端共用,在 app/contracts.py;这里只放默认向量。
"""

from app.contracts import BUILTIN_EMOTIONS, EMO_DIM_MAX, EMO_DIMS, EMO_SUM_MAX

DIM_MAX = EMO_DIM_MAX
SUM_MAX = EMO_SUM_MAX


def clean_emo_vector(raw: list[float] | None) -> list[float] | None:
    """校验并规整成 3 位小数。全 0 等于不控制,存成 None。不合格抛 ValueError,说明是哪一项。"""
    if raw is None:
        return None
    if len(raw) != len(EMO_DIMS):
        raise ValueError(f"情绪向量要正好 {len(EMO_DIMS)} 个数(现在是 {len(raw)} 个)")
    out: list[float] = []
    for name, value in zip(EMO_DIMS, raw):
        v = float(value)
        # NaN 两边都不成立,也会落到这里
        if not 0 <= v <= DIM_MAX:
            raise ValueError(f"「{name}」要在 0 到 {DIM_MAX} 之间")
        out.append(round(v, 3))
    total = sum(out)
    if total > SUM_MAX + 1e-9:
        raise ValueError(f"情绪向量合计 {total:.2f},不能超过 {SUM_MAX}")
    return out if total > 0 else None


# 内置表情的名字 → 默认向量(没写的维度是 0;None = 不控制,沿用音色参考的语气)。
# 只是起点,要以用户试听为准。名字和别名在 app/contracts.py 的 BUILTIN_EMOTIONS(BUILTIN_EMOTIONS 也从这里
# 照旧导出),每一项都要有向量(有测试对照)
_VECTORS: dict[str, dict[str, float] | None] = {
    "平静": None,
    "微笑": {"高兴": 0.4, "平静": 0.4},
    "开心": {"高兴": 0.8},
    "温柔": {"高兴": 0.3, "平静": 0.5},
    "认真": {"愤怒": 0.1, "平静": 0.6},
    "担心": {"害怕": 0.4, "忧郁": 0.3},
    "难过": {"悲伤": 0.8},
    "哭": {"悲伤": 1.0},
    "惊讶": {"惊讶": 0.8},
    "慌张": {"害怕": 0.4, "惊讶": 0.4},
    "害羞": {"高兴": 0.3, "害怕": 0.3},
    "疑惑": {"惊讶": 0.4, "平静": 0.3},
    "生气": {"愤怒": 0.7},
    "害怕": {"害怕": 0.8},
    "厌恶": {"厌恶": 0.7},
    "忧郁": {"忧郁": 0.7},
}
# 表情名 / 别名 → 默认向量:每组第一个词是名字,其余是别名
PRESETS: list[tuple[tuple[str, ...], dict[str, float] | None]] = [
    ((label, *aliases), _VECTORS[label]) for label, aliases in BUILTIN_EMOTIONS
]
_BY_NAME = {n.casefold(): dims for names, dims in PRESETS for n in names}


def dims_to_vector(dims: dict[str, float]) -> list[float]:
    return [dims.get(name, 0.0) for name in EMO_DIMS]


def preset_vector(names: list[str]) -> list[float] | None:
    """立绘表情名在前、别名在后,第一个在表里的为准;都不在表里 → None(不控制)。"""
    for n in names:
        key = n.strip().casefold()
        if key in _BY_NAME:
            dims = _BY_NAME[key]
            return dims_to_vector(dims) if dims else None
    return None
