"""前后端共用的常量(app/contracts.py)和前端那份生成的 contracts.ts"""

import re

import pytest

from app import contracts

TS = contracts.ts_path()


@pytest.mark.skipif(not TS.parent.parent.is_dir(), reason="没有前端代码(比如在 Docker 里)")
def test_generated_ts_is_fresh():
    """仓库里的 contracts.ts 要和现在的 app/contracts.py 生成出来的逐字一样"""
    have = TS.read_bytes() if TS.is_file() else b""
    want = contracts.render().encode("utf-8")
    assert have == want, (
        "frontend/src/debug/generated/contracts.ts 不是最新的:改了 app/contracts.py 以后,"
        "在 AnimaBackend 下跑 python -m app.contracts"
    )


def test_render_is_lf_and_stable():
    text = contracts.render()
    assert "\r" not in text
    assert text.startswith("// 自动生成,别手改")
    assert text == contracts.render()
    names = re.findall(r"^export const (\w+) =", text, re.M)
    # 按 app/contracts.py 里定义的顺序;生成器自己的东西(下划线开头)不导出
    assert names == [
        "LABEL_MAX",
        "LABEL_FORBIDDEN",
        "SPRITE_WIDTHS",
        "SCENE_WIDTHS",
        "SPEAKER_THRESHOLD",
        "SWITCH_THRESHOLD",
        "JEV_BEFORE_LINES",
        "EMO_DIMS",
        "EMO_DIM_MAX",
        "EMO_SUM_MAX",
        "BUILTIN_EMOTIONS",
        "REF_NAME_PATTERN",
    ]


def test_ts_literals():
    text = contracts.render()
    # 换行、回车写成转义,不能真的断行
    assert "export const LABEL_FORBIDDEN = '\\n\\r<>[]{}【】「」';" in text
    # 反斜杠要双写,JS 里 new RegExp 拿到的才是 \.
    assert "export const REF_NAME_PATTERN = '^【([^】]+)】(.+)\\\\.[A-Za-z0-9]+$';" in text
    assert "export const SPEAKER_THRESHOLD = { default: 0.8, min: 0.5, max: 0.95 } as const;" in text
    assert "  { label: '开心', aliases: ['高兴', 'happy'] },\n" in text


def test_values_hang_together():
    for t in (contracts.SPEAKER_THRESHOLD, contracts.SWITCH_THRESHOLD):
        assert t["min"] <= t["default"] <= t["max"]
    assert len(contracts.EMO_DIMS) == 8
    labels = [label for label, _ in contracts.BUILTIN_EMOTIONS]
    assert len(labels) == len(set(labels))
    for label, aliases in contracts.BUILTIN_EMOTIONS:
        for n in (label, *aliases):
            assert 0 < len(n) <= contracts.LABEL_MAX
            assert not any(c in contracts.LABEL_FORBIDDEN for c in n)
    m = re.match(contracts.REF_NAME_PATTERN, "【开心】今天天气真好.wav")
    assert m and m.groups() == ("开心", "今天天气真好")
