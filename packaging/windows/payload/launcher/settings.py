"""启动器、游戏、后台共用的设置(启动器设置页那几项,游戏里也能改画面),存在存档文件夹里的 launcher.json。

读坏了、缺项、值不认识都按默认补上 —— 设置文件坏了不能让启动器打不开。
三个程序都会写:改一项用 update(),每次从文件读最新的再改,别拿手里的旧副本盖掉别人刚改的。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path

# 只能在这几个里选的
CHOICES = {
    "after_start":("stay", "minimize", "close"),
    "game_display": ("fullscreen", "borderless", "window"),
    "game_size": ("1280x720", "1600x900", "1920x1080", "2560x1440", "3840x2160"),
    "dev_mode": ("build", "dev"),
}
# 改了要重启后台(后端、游戏页面)才生效的
RESTART_KEYS = frozenset({"terminal", "lan", "port", "dev_mode"})
# 游戏窗口的样子:游戏开着时改了马上套上
DISPLAY_KEYS = frozenset({"game_display", "game_size"})


@dataclass(frozen=True)
class Settings:
    # 开始游戏按钮下面那个勾:勾了开全屏的游戏窗口(游戏本体 game.py),没勾用默认浏览器(用户 10-29 定的)
    fullscreen_start: bool = False
    after_start: str = "stay"  # 点了开始游戏以后启动器:stay 留着 / minimize 最小化 / close 关掉(游戏不受影响)
    # 游戏窗口怎么显示:fullscreen 全屏 / borderless 无边框窗口 / window 窗口(gamewin.py);
    # 启动器每次开游戏窗口都先设回全屏,玩的时候 F11 或游戏里「设置 → 显示」再改
    game_display: str = "fullscreen"
    game_size: str = "1920x1080"  # 无边框和窗口的画面大小;全屏时是按 F11 退出全屏后的大小
    auto_start: bool = False  # 打开启动器就进游戏
    terminal: bool = False  # 显示终端窗口:后端另开一个黑窗口(以前的样子)
    lan: bool = True  # 让同一个 Wi-Fi 下的手机连进来
    port: int = 8000  # 后端端口;整合包里被占着就往后找
    auto_update: bool = True  # 打开时看一眼有没有新版本(整合包才有)
    dev_mode: str = "build"  # 源码文件夹里:build 打包版(以前的 play.bat)/ dev 开发版(以前的 start.bat)


_BAD = object()


def _check(key: str, value):
    """合法就原样返回,不合法返回 _BAD"""
    if key in CHOICES:
        return value if value in CHOICES[key] else _BAD
    kind = type(getattr(Settings(), key))
    if kind is bool:
        return value if isinstance(value, bool) else _BAD
    if kind is int:
        ok = isinstance(value, int) and not isinstance(value, bool) and 1024 <= value <= 65535
        return value if ok else _BAD
    return _BAD


def load(path: Path) -> Settings:
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    good = {}
    for f in fields(Settings):
        if f.name in raw and (v := _check(f.name, raw[f.name])) is not _BAD:
            good[f.name] = v
    return Settings(**good)


def save(path: Path, s: Settings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(asdict(s), ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(path)


def change(s: Settings, key: str, value) -> Settings:
    """设置页改一项;不认识的键、不合法的值抛 ValueError"""
    if key not in {f.name for f in fields(Settings)}:
        raise ValueError(f"没有这个设置:{key}")
    v = _check(key, value)
    if v is _BAD:
        raise ValueError(f"{key} 不能设成 {value!r}")
    return replace(s, **{key: v})


def update(path: Path, key: str, value) -> Settings:
    """从文件读最新的、改一项、存回去;不合法抛 ValueError(文件不动)"""
    new = change(load(path), key, value)
    save(path, new)
    return new
