"""启动器界面用的字体子集(只打包界面里出现过的字,几十 KB):

    AnimaSerif = 思源宋体 Noto Serif SC(OFL),标题、开始按钮、页签
    AnimaLatin = Cormorant Garamond 斜体(OFL),英文小标(Console / Config ……)

字体从 Google Fonts 的 GitHub 仓库下(缓存在 %LOCALAPPDATA%\\AnimaVN-build\\fonts);界面加了字就重跑:
    AnimaBackend\\.venv\\Scripts\\python packaging\\windows\\make_launcher_fonts.py
要先装:pip install fonttools brotli(只是打字体用,不进整合包)
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
UI = HERE / "payload" / "launcher" / "ui"
OUT = UI / "fonts"
CACHE = Path(os.environ.get("LOCALAPPDATA", HERE)) / "AnimaVN-build" / "fonts"
API = "https://api.github.com/repos/google/fonts/contents/ofl/"
CJK = re.compile(r"[　-〿一-鿿＀-￯]")


def fetch(family_dir: str, pattern: str) -> tuple[Path, Path]:
    """下载这个字体家族目录里文件名匹配 pattern 的那个 ttf,和它的 OFL.txt"""
    CACHE.mkdir(parents=True, exist_ok=True)
    listing = json.loads(urllib.request.urlopen(API + family_dir, timeout=30).read())
    ttf = next(f for f in listing if re.fullmatch(pattern, f["name"]))
    ofl = next(f for f in listing if f["name"] == "OFL.txt")
    out = []
    for f in (ttf, ofl):
        dest = CACHE / f"{family_dir}-{f['name']}"
        if not dest.exists():
            print("下载", f["download_url"])
            dest.write_bytes(urllib.request.urlopen(f["download_url"], timeout=300).read())
        out.append(dest)
    return out[0], out[1]


def ui_text() -> str:
    return "".join(p.read_text("utf-8") for p in UI.glob("*") if p.suffix in (".html", ".js", ".json"))


def make(src: Path, dest: Path, text: str, wght: tuple[int, int]) -> None:
    font = TTFont(src)
    # 先挑字再裁粗细:反过来做(先 instancer)子集时会报 KeyError: 'uni327F'
    opts = subset.Options()
    opts.layout_features = ["*"]
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    font = instancer.instantiateVariableFont(font, {"wght": wght})  # 只留要用的粗细
    font.flavor = "woff2"
    font.save(dest)
    print(dest.name, dest.stat().st_size, "字节")


def main() -> None:
    text = ui_text()
    cjk = sorted(set(CJK.findall(text)))
    ascii_ = "".join(chr(c) for c in range(0x20, 0x7F))
    serif_src, serif_ofl = fetch("notoserifsc", r"NotoSerifSC\[wght\]\.ttf")
    latin_src, latin_ofl = fetch("cormorantgaramond", r"CormorantGaramond-Italic\[wght\]\.ttf")
    OUT.mkdir(parents=True, exist_ok=True)
    make(serif_src, OUT / "serif.woff2", "".join(cjk) + ascii_, (500, 700))
    make(latin_src, OUT / "latin-italic.woff2", ascii_, (500, 600))
    (OUT / "serif-chars.txt").write_text("".join(cjk) + "\n", "utf-8")
    (OUT / "OFL-NotoSerifSC.txt").write_bytes(serif_ofl.read_bytes())
    (OUT / "OFL-CormorantGaramond.txt").write_bytes(latin_ofl.read_bytes())
    print(f"宋体子集 {len(cjk)} 个字")


if __name__ == "__main__":
    main()
