"""卡带的边界(app/plugins/__init__.py 开头的规矩):卡带外面谁都不 import 卡带,卡带之间也不。

卡带的名字从登记处拿(CARTRIDGE_MODULES),这里不写。卡带自己的文件:app/plugins/<名>.py 或 app/plugins/<名>/,
它的测试在 tests/plugins/<名>/。只有登记处和私有工具可以碰别的卡带。
"""

import ast
from collections.abc import Iterable
from pathlib import Path

from app.plugins import CARTRIDGE_MODULES

BACKEND = Path(__file__).resolve().parent.parent
PACKAGE = "app.plugins"
# 登记处要按名字 import 它们
REGISTRY = "app/plugins/__init__.py"
# 私有工具:生成公开版时一起删(publish/make_public.py 的 DROP),可以直接 import 卡带
PRIVATE_TOOLS = ("app/replay/", "tests/test_replay_")


def _absolute(module: str | None, level: int, package: str) -> str | None:
    """from 后面那段换成完整的模块名;相对 import 往上跳出了顶层时是 None"""
    if level == 0:
        return module
    parts = package.split(".") if package else []
    if level - 1 > len(parts):
        return None
    base = parts[: len(parts) - (level - 1)]
    return ".".join([*base, module] if module else base) or None


def cartridge_imports(
    source: str, module: str, *, is_package: bool = False, cartridges: Iterable[str] = CARTRIDGE_MODULES
) -> list[str]:
    """这段代码碰了哪些卡带:返回卡带的完整模块名(一处一条)。

    import / from … import(含相对 import、从 app.plugins import 卡带名)都算;写成字符串的模块路径
    (importlib.import_module("app.plugins.x")、monkeypatch 的 "app.plugins.x.y")也算
    """
    targets = [f"{PACKAGE}.{name}" for name in cartridges]

    def hit(name: str | None) -> str | None:
        return next((t for t in targets if name == t or (name or "").startswith(t + ".")), None)

    package = module if is_package else module.rpartition(".")[0]
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found += [t for a in node.names if (t := hit(a.name))]
        elif isinstance(node, ast.ImportFrom):
            base = _absolute(node.module, node.level, package)
            if base is None:
                continue
            if t := hit(base):
                found.append(t)
            else:
                found += [t for a in node.names if (t := hit(f"{base}.{a.name}"))]
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and (t := hit(node.value)):
            found.append(t)
    return found


def _module_of(rel: str) -> tuple[str, bool]:
    """app/api/tts.py → (app.api.tts, False);app/plugins/__init__.py → (app.plugins, True)"""
    parts = rel.removesuffix(".py").split("/")
    if parts[-1] == "__init__":
        return ".".join(parts[:-1]), True
    return ".".join(parts), False


def _owns(rel: str, name: str) -> bool:
    """rel 是不是卡带 name 自己的文件(含它的测试)"""
    return rel == f"app/plugins/{name}.py" or rel.startswith((f"app/plugins/{name}/", f"tests/plugins/{name}/"))


def violations(rel: str, source: str, cartridges: Iterable[str] = CARTRIDGE_MODULES) -> list[str]:
    module, is_package = _module_of(rel)
    out = []
    for target in cartridge_imports(source, module, is_package=is_package, cartridges=cartridges):
        if not _owns(rel, target.removeprefix(PACKAGE + ".").split(".")[0]):
            out.append(f"{rel} → {target}")
    return out


def test_nobody_outside_a_cartridge_imports_it():
    files = sorted(p for top in ("app", "tests") for p in (BACKEND / top).rglob("*.py"))
    assert any(p.relative_to(BACKEND).as_posix() == REGISTRY for p in files), "路径算错了,没扫到登记处"
    bad: list[str] = []
    for path in files:
        rel = path.relative_to(BACKEND).as_posix()
        if rel == REGISTRY or rel.startswith(PRIVATE_TOOLS):
            continue
        bad += violations(rel, path.read_text(encoding="utf-8-sig"))
    assert bad == []


# ---- 扫 import 的规则本身(用假卡带名) ----

FAKE = ("fake_a", "fake_b")


def _scan(rel: str, source: str) -> list[str]:
    return violations(rel, source, FAKE)


def test_scanner_catches_every_way_of_importing():
    source = "\n".join(
        [
            "import app.plugins.fake_a",
            "import app.plugins.fake_a.models as m",
            "from app.plugins.fake_a import router",
            "from app.plugins.fake_a.sub import thing",
            "from app.plugins import fake_b, Cartridge",
            "from app import plugins",
            "import importlib",
            "importlib.import_module('app.plugins.fake_b')",
            "def f(monkeypatch):",
            "    monkeypatch.setattr('app.plugins.fake_a.SETTING', 1)",
            "    import app.plugins.fake_b",
        ]
    )
    got = _scan("app/api/tts.py", source)
    assert sorted(got) == ["app/api/tts.py → app.plugins.fake_a"] * 5 + ["app/api/tts.py → app.plugins.fake_b"] * 3


def test_scanner_resolves_relative_imports():
    # 普通模块里 . 是它所在的包;app/api/x.py 里的 ..plugins 就是 app.plugins
    assert _scan("app/api/x.py", "from ..plugins import fake_a") == ["app/api/x.py → app.plugins.fake_a"]
    assert _scan("app/api/x.py", "from ..plugins.fake_b import y") == ["app/api/x.py → app.plugins.fake_b"]
    assert _scan("app/api/x.py", "from .plugins import fake_a") == []
    # 包的 __init__.py 里 . 是这个包自己
    assert _scan("app/__init__.py", "from .plugins import fake_a") == ["app/__init__.py → app.plugins.fake_a"]
    assert _scan("app/sub/__init__.py", "from .plugins import fake_a") == []
    assert _scan("app/sub/__init__.py", "from ..plugins import fake_a") == ["app/sub/__init__.py → app.plugins.fake_a"]
    # 跳出顶层的不管(Python 自己会报错)
    assert _scan("app/x.py", "from .... import fake_a") == []


def test_cartridge_may_import_itself_and_the_core_but_not_another_cartridge():
    source = "from . import Cartridge\nfrom .fake_a import helpers\nfrom app.db import Base\n"
    assert _scan("app/plugins/fake_a.py", source) == []
    assert _scan("app/plugins/fake_a/api.py", "from app.plugins.fake_a.models import M") == []
    assert _scan("tests/plugins/fake_a/test_api.py", "import app.plugins.fake_a") == []
    assert _scan("app/plugins/fake_b.py", "from .fake_a import helpers") == [
        "app/plugins/fake_b.py → app.plugins.fake_a"
    ]
    assert _scan("tests/plugins/fake_b/test_x.py", "import app.plugins.fake_a") == [
        "tests/plugins/fake_b/test_x.py → app.plugins.fake_a"
    ]


def test_scanner_ignores_lookalikes():
    source = "\n".join(
        [
            "import app.plugins",
            "from app.plugins import Cartridge, load_cartridges",
            "import app.plugins.fake_ab",
            "x = 'app.plugins.fake_a 不是一个模块路径'",
            "y = 'app.plugins.'",
            '"""文档里提到 app.plugins.fake_a 也不算"""',
        ]
    )
    assert _scan("app/main.py", source) == []
