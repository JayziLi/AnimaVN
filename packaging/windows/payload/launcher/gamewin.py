"""游戏窗口怎么开(设置页「游戏窗口」那两项):全屏 / 无边框窗口 / 窗口,多大,开在哪块屏幕上。只算不开,好测。

大小照游戏的说法写分辨率:1920×1080 = 画面实打实 1920×1080 个像素(不算标题栏和边框)。
屏幕坐标也是实打实的像素(pywebview 开着时进程是 DPI aware 的);pywebview 收的位置和大小却是
「逻辑像素」,它自己再乘系统缩放(比如 150%),所以这里先除掉。
pywebview 的 width/height 是连边框带标题栏的外框;无边框时它去掉边框、画面大小不变,外框跟着缩成画面那么大
—— 所以两种都是「画面 + 边框」传进去(边框多大由 gui.py 问 Windows,150% 下左右合计 22、上下 56)。
比屏幕大(窗口模式还要让出任务栏)就等比缩到放得下。开在鼠标所在的那块屏幕上:点「开始游戏」时鼠标就在启动器上。
"""

from __future__ import annotations

from dataclasses import dataclass

MIN_SIZE = (640, 360)  # 窗口模式最小能拖到多小,逻辑像素(手机横过来也就这么大,页面撑得住)

Area = tuple[int, int, int, int]  # x, y, 宽, 高


@dataclass(frozen=True)
class Screen:
    bounds: Area  # 整块屏幕
    work: Area  # 去掉任务栏


def size_of(choice: str) -> tuple[int, int]:
    w, h = choice.split("x")
    return int(w), int(h)


def pick_screen(screens: list[Screen], point: tuple[int, int]) -> Screen:
    """鼠标在哪块屏幕上;都不在就用主屏(左上角是 0,0 的那块),再没有就第一块"""
    px, py = point
    for s in screens:
        x, y, w, h = s.bounds
        if x <= px < x + w and y <= py < y + h:
            return s
    return next((s for s in screens if s.bounds[:2] == (0, 0)), screens[0])


def _logical(px: int, scale: float) -> float:
    """pywebview 拿去 int(值 × 缩放):给个带小数的,乘回去正好落在 px 上(150% 时整数逻辑像素会差一个像素)"""
    return (px + (0.5 if px >= 0 else -0.5)) / scale


def window_rect(display: str, size: str, screen: Screen, frame: tuple[int, int]) -> Area:
    """窗口外框放哪、多大(实打实的像素):无边框时外框就是画面,窗口模式是画面 + 边框。全屏也算一个(F11 退出后回到它)"""
    w, h = size_of(size)
    fw, fh = frame
    if display == "borderless":
        rx, ry, rw, rh = screen.bounds  # 无边框可以盖满整块屏幕(和屏幕一样大就等于全屏)
        room_w, room_h = rw, rh
    else:
        rx, ry, rw, rh = screen.work
        room_w, room_h = rw - fw, rh - fh
    k = min(1.0, room_w / w, room_h / h)
    w, h = round(w * k), round(h * k)
    if display == "borderless":
        return rx + (rw - w) // 2, ry + (rh - h) // 2, w, h
    return rx + (rw - w - fw) // 2, ry + (rh - h - fh) // 2, w + fw, h + fh


def window_args(display: str, size: str, screen: Screen, scale: float, frame: tuple[int, int]) -> dict:
    """给 webview.create_window 的位置、大小和样子。scale = 系统缩放(1.5 = 150%),frame = 边框加标题栏占的像素"""
    x, y, w, h = window_rect(display, size, screen, frame)
    if display == "borderless":
        w, h = w + frame[0], h + frame[1]  # pywebview 先按带边框的开、再去掉边框(画面大小不变),所以先加上
    return {
        "x": _logical(x, scale),
        "y": _logical(y, scale),
        "width": _logical(w, scale),
        "height": _logical(h, scale),
        "fullscreen": display == "fullscreen",
        "frameless": display == "borderless",
        "resizable": display != "borderless",
        "min_size": MIN_SIZE,
    }
