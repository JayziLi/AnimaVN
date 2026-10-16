from app import contracts
from app.tts.emotion_presets import (
    BUILTIN_EMOTIONS,
    PRESETS,
    _VECTORS,
    clean_emo_vector,
    dims_to_vector,
    preset_vector,
)


def test_preset_vector_by_name_then_alias():
    assert preset_vector(["开心"]) == [0.8, 0, 0, 0, 0, 0, 0, 0]
    assert preset_vector(["Happy"]) == [0.8, 0, 0, 0, 0, 0, 0, 0]
    # 立绘名不在表里,按别名:阿米娅的「红瞳」别名里有 angry
    assert preset_vector(["红瞳", "angry", "生气"]) == [0, 0.7, 0, 0, 0, 0, 0, 0]
    assert preset_vector(["慌张", "flustered", "害羞"]) == [0, 0, 0, 0.4, 0, 0, 0.4, 0]
    # 平静 / 说话 = 不控制;表里没有的(琴柳的「持旗」)也是不控制
    assert preset_vector(["平静", "normal"]) is None
    assert preset_vector(["说话", "talk"]) is None
    assert preset_vector(["持旗", "flag"]) is None


def test_every_preset_passes_validation():
    for _names, dims in PRESETS:
        if dims:
            vec = dims_to_vector(dims)
            assert clean_emo_vector(vec) == vec


def test_builtin_emotions_are_the_preset_groups():
    assert [label for label, _ in BUILTIN_EMOTIONS] == [names[0] for names, _ in PRESETS]
    assert BUILTIN_EMOTIONS[2] == ("开心", ("高兴", "happy"))


def test_presets_cover_the_contract_emotions():
    """名字和别名只在 app/contracts.py 写一份(前端那份是生成的,tests/test_contracts.py 管它是不是最新的);
    这里的默认向量要一项不多一项不少地对上"""
    assert BUILTIN_EMOTIONS == contracts.BUILTIN_EMOTIONS
    assert [names for names, _ in PRESETS] == [(label, *aliases) for label, aliases in contracts.BUILTIN_EMOTIONS]
    assert set(_VECTORS) == {label for label, _ in contracts.BUILTIN_EMOTIONS}
