"""前后端共用的常量:只在这里写一份,前端那份是从这里生成的。

改了这里以后,在 AnimaBackend 下跑 `python -m app.contracts`,重新生成
frontend/src/debug/generated/contracts.ts(每个常量上面紧挨着的注释也一起搬过去);
tests/test_contracts.py 检查生成的文件是不是最新的。

只放中性的常量:名字的规矩、图片宽度、Jev 门槛、内置表情、情绪向量、参考文件名。
卡带(app/plugins)的词留在卡带自己的文件里。
"""

import ast
import math
from pathlib import Path

# 名字(表情名、素材名、别名 —— AI 要在标签里点名的)最长几个字
LABEL_MAX = 40

# 名字里不许用的字符:表情名会被塞进用户自定义的标签模板里(比如 <sprite:{表情}>、【{表情}】),
# 名字里带这些括号,解析器就分不清标签在哪里结束了
LABEL_FORBIDDEN = "\n\r<>[]{}【】「」"

# 图片接口 ?w= 前端会要的宽度:立绘 电脑 1280 / 触屏 1024。后端启动后按这几个宽度先转一遍(app/images.py)
SPRITE_WIDTHS = {"desktop": 1280, "touch": 1024}
# 背景、CG:游戏里铺满屏幕,电脑 1920 / 触屏 1280
SCENE_WIDTHS = {"desktop": 1920, "touch": 1280}

# Jev 说话人门槛(判成「不是主角说的」要有这么大把握):默认、可调范围
SPEAKER_THRESHOLD = {"default": 0.8, "min": 0.5, "max": 0.95}
# Jev 换背景 / 音乐 / CG 的门槛:默认、可调范围
SWITCH_THRESHOLD = {"default": 0.6, "min": 0.3, "max": 0.95}
# Jev 判每句时带上一条回复的最后几句:默认、可调范围(0 = 不带;超过 24 没测过,见 specs/2026-10-15-jev-previous-reply-ab.md)
JEV_BEFORE_LINES = {"default": 24, "min": 0, "max": 24}

# IndexTTS 情绪向量的 8 维,顺序是 IndexTTS 官方定的
EMO_DIMS = ("高兴", "愤怒", "悲伤", "害怕", "厌恶", "忧郁", "惊讶", "平静")
# 情绪向量每维 0–1.2,合计不超过 1.5 —— 再高会明显影响音色相似度
# (见 docs/superpowers/specs/2026-09-24-indextts-engine-design.md)
EMO_DIM_MAX = 1.2
# 情绪向量各维加起来的上限(见 EMO_DIM_MAX)
EMO_SUM_MAX = 1.5

# 没配立绘的卡用的内置基础表情:{{sprites}} 展开成它们,立绘标签也拿它们当候选。
# 每组是(名字, 别名);app/tts/emotion_presets.py 的 IndexTTS 默认向量正好覆盖每一项
BUILTIN_EMOTIONS: list[tuple[str, tuple[str, ...]]] = [
    ("平静", ("normal", "calm", "neutral", "说话", "talk", "默认")),
    ("微笑", ("smile",)),
    ("开心", ("高兴", "happy")),
    ("温柔", ("gentle",)),
    ("认真", ("serious",)),
    ("担心", ("worried",)),
    ("难过", ("伤心", "sad")),
    ("哭", ("cry",)),
    ("惊讶", ("surprised",)),
    ("慌张", ("flustered",)),
    ("害羞", ("脸红", "shy")),
    ("疑惑", ("confused",)),
    ("生气", ("angry",)),
    ("害怕", ("afraid", "scared")),
    ("厌恶", ("嫌弃", "disgusted")),
    ("忧郁", ("失落", "melancholic")),
]

# 语音服务那台机器上参考音频的命名:【情绪】原文.wav,取出情绪名和原文(Python 和 JS 的正则都认这一句)
REF_NAME_PATTERN = r"^【([^】]+)】(.+)\.[A-Za-z0-9]+$"


# ---- 生成前端那份 ----

_HEADER = "// 自动生成,别手改;改 AnimaBackend/app/contracts.py 以后,在 AnimaBackend 下跑 python -m app.contracts\n"


def ts_path() -> Path:
    return Path(__file__).resolve().parents[2] / "frontend" / "src" / "debug" / "generated" / "contracts.ts"


def _ts_shape(name: str, value):
    """前端用起来顺手的形状:内置表情在前端一直是 {label, aliases}"""
    if name == "BUILTIN_EMOTIONS":
        return [{"label": label, "aliases": list(aliases)} for label, aliases in value]
    return value


def _ts_str(s: str) -> str:
    escaped = (
        s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    )
    return f"'{escaped}'"


def _ts_value(v, indent: str = "") -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | float):
        if not math.isfinite(v):
            raise ValueError(f"前端写不了 {v!r}")
        return repr(v)
    if isinstance(v, str):
        return _ts_str(v)
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{k}: {_ts_value(x)}" for k, x in v.items()) + " }"
    if isinstance(v, list | tuple):
        # 里面是数组 / 对象的一项一行,其余写在一行
        if any(isinstance(x, list | tuple | dict) for x in v):
            inner = indent + "  "
            return "[\n" + "".join(f"{inner}{_ts_value(x, inner)},\n" for x in v) + indent + "]"
        return "[" + ", ".join(_ts_value(x) for x in v) + "]"
    raise TypeError(f"前端写不了 {type(v).__name__}")


def _exported() -> list[tuple[str, list[str]]]:
    """按定义的顺序列出要给前端的常量(大写、不带下划线开头的),带上紧挨着它上面的注释"""
    source = Path(__file__).read_text(encoding="utf-8")
    lines = source.splitlines()
    out: list[tuple[str, list[str]]] = []
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
        elif isinstance(node, ast.AnnAssign):
            target = node.target
        else:
            continue
        if not isinstance(target, ast.Name) or not target.id.isupper() or target.id.startswith("_"):
            continue
        comments: list[str] = []
        i = node.lineno - 2
        while i >= 0 and lines[i].lstrip().startswith("#"):
            comments.insert(0, lines[i].lstrip()[1:].strip())
            i -= 1
        out.append((target.id, comments))
    return out


def render() -> str:
    """生成的 contracts.ts 全文(LF 换行)"""
    chunks = [_HEADER]
    for name, comments in _exported():
        value = _ts_shape(name, globals()[name])
        if any("*/" in c for c in comments):
            raise ValueError(f"{name} 的注释里不能有 */")
        if len(comments) == 1:
            doc = f"/** {comments[0]} */\n"
        elif comments:
            doc = "/**\n" + "".join(f" * {c}\n" for c in comments) + " */\n"
        else:
            doc = ""
        literal = _ts_value(value)
        suffix = " as const" if isinstance(value, list | tuple | dict) else ""
        chunks.append(f"\n{doc}export const {name} = {literal}{suffix};\n")
    return "".join(chunks)


def main() -> None:
    path = ts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(render())
    print(f"已生成 {path}")


if __name__ == "__main__":
    main()
