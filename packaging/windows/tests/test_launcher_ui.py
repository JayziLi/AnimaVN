import ast
import re
from pathlib import Path

UI = Path(__file__).resolve().parent.parent / "payload" / "launcher" / "ui"
CJK = re.compile(r"[　-〿一-鿿＀-￯]")


def ui_chars() -> set[str]:
    text = "".join(p.read_text("utf-8") for p in UI.glob("*") if p.suffix in (".html", ".js", ".json"))
    return set(CJK.findall(text))


def test_serif_subset_covers_every_chinese_character_in_the_ui():
    have = set((UI / "fonts" / "serif-chars.txt").read_text("utf-8").replace("\n", ""))
    missing = sorted(ui_chars() - have)
    assert not missing, f"界面里新加了字,重跑 make_launcher_fonts.py:{''.join(missing)}"


def test_every_api_the_page_calls_exists_in_gui_app():
    js = (UI / "launcher.js").read_text("utf-8")
    names = re.search(r"const API_METHODS = \[([^\]]*)\]", js).group(1)
    called = set(re.findall(r"'(\w+)'", names))
    used = set(re.findall(r"call\('(\w+)'", js)) | set(re.findall(r"api\(\)\.(\w+)\(", js))
    assert used <= called, f"launcher.js 调了没列进 API_METHODS 的:{used - called}"
    tree = ast.parse((UI.parent / "gui.py").read_text("utf-8"))
    app = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "App")
    have = {f.name for f in app.body if isinstance(f, ast.FunctionDef) and not f.name.startswith("_")}
    assert called <= have, f"gui.App 少了:{called - have}"
