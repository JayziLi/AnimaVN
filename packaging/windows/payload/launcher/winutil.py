"""启动器和游戏共用的 Windows 窗口小事:屏幕、缩放、边框、任务栏分组。算位置大小的规矩在 gamewin.py。

两个程序一开头都先调 dpi_aware(),设成「每块屏按自己的缩放」(PMv2):
- pywebview 自己只设「系统 DPI」:缩放和主屏不一样的副屏上,窗口会被系统拉伸(糊,而且 1920×1080 不再是 1920×1080)
- WinForms 第一次查屏幕就把结果缓存了,开窗前就得设好,不然查到的是缩过的坐标,窗口会开偏
设了以后坐标、大小全是实打实的像素。pywebview 收的「逻辑像素」它会乘上窗口刚建出来时那块屏(主屏)的缩放,
所以传给它的要除以 scale();边框按窗口要去的那块屏的 DPI 算。
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes

import gamewin

WS_OVERLAPPEDWINDOW = 0x00CF0000
u32 = ctypes.windll.user32


def dpi_aware() -> None:
    try:
        if u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            return
    except AttributeError:  # Windows 10 1703 以前没有
        pass
    u32.SetProcessDPIAware()


def taskbar_id(app_id: str) -> None:
    """任务栏上自成一组、用自己的图标(启动器和游戏各一个,别和别的 python 程序挤在一起)"""
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)


class _GUID(ctypes.Structure):
    _fields_ = [("b", ctypes.c_ubyte * 16)]

    @classmethod
    def of(cls, text: str) -> _GUID:
        import uuid

        g = cls()
        ctypes.memmove(g.b, uuid.UUID(text).bytes_le, 16)
        return g


class _PROPERTYKEY(ctypes.Structure):
    _fields_ = [("fmtid", _GUID), ("pid", wintypes.DWORD)]


class _PROPVARIANT(ctypes.Structure):
    _fields_ = [("vt", wintypes.USHORT), ("r1", wintypes.WORD), ("r2", wintypes.WORD), ("r3", wintypes.WORD),
                ("val", ctypes.c_void_p), ("pad", ctypes.c_void_p)]


def window_identity(hwnd: int, app_id: str, icon: str, command: str, name: str) -> list[int]:
    """给窗口单独打上任务栏身份:自己的编号 + 图标(+ 固定到任务栏后怎么重开)。

    taskbar_id() 只管进程;源码文件夹的环境要是商店版 Python(WindowsApps 里那个),它是打包应用,
    任务栏按安装包认、显示 Python 的图标,窗口自己挂的图标不管用(用户 10-23 看到任务栏上是 Python 图标)。
    窗口上的这几个属性系统会认。返回每一项的结果码(0 = 成功);「重开命令」有时被拒,不影响图标。
    """
    store = ctypes.c_void_p()
    iid = _GUID.of("{886d8eeb-8cf2-4446-8d02-cdba1dbdcf99}")  # IPropertyStore
    hr = ctypes.windll.shell32.SHGetPropertyStoreForWindow(wintypes.HWND(hwnd), ctypes.byref(iid), ctypes.byref(store))
    if hr != 0 or not store:
        return [hr]
    vtable = ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    set_value = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(_PROPERTYKEY),
                                   ctypes.POINTER(_PROPVARIANT))(vtable[6])
    commit = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p)(vtable[7])
    release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtable[2])
    fmtid = _GUID.of("{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}")  # System.AppUserModel.*
    results = []
    # 重开命令 2、显示名 4、图标 3,编号 5 最后设
    for pid, value in ((2, command), (4, name), (3, f"{icon},0"), (5, app_id)):
        buf = ctypes.create_unicode_buffer(value)
        pv = _PROPVARIANT(31, 0, 0, 0, ctypes.cast(buf, ctypes.c_void_p), None)  # VT_LPWSTR
        results.append(set_value(store, ctypes.byref(_PROPERTYKEY(fmtid, pid)), ctypes.byref(pv)))
    results.append(commit(store))
    release(store)
    return results


def scale() -> float:
    """主屏的缩放(1.5 = 150%):pywebview 把逻辑像素乘的就是这个(窗口先建在主屏上)"""
    return u32.GetDpiForSystem() / 96


def frame(dpi: int | None = None) -> tuple[int, int]:
    """普通窗口的边框加标题栏在这个 DPI 下占多少像素(左右合计、上下合计);不给就按主屏"""
    r = wintypes.RECT(0, 0, 0, 0)
    u32.AdjustWindowRectExForDpi(ctypes.byref(r), WS_OVERLAPPEDWINDOW, False, 0, dpi or u32.GetDpiForSystem())
    return r.right - r.left, r.bottom - r.top


def monitor_dpi(screen: gamewin.Screen) -> int:
    x, y, w, h = screen.bounds
    u32.MonitorFromPoint.restype = wintypes.HMONITOR
    hmon = u32.MonitorFromPoint(wintypes.POINT(x + w // 2, y + h // 2), 2)
    dx, dy = wintypes.UINT(), wintypes.UINT()
    if ctypes.windll.shcore.GetDpiForMonitor(hmon, 0, ctypes.byref(dx), ctypes.byref(dy)) != 0:
        return u32.GetDpiForSystem()
    return dx.value


def window_dpi(hwnd: int) -> int:
    return u32.GetDpiForWindow(wintypes.HWND(hwnd)) or u32.GetDpiForSystem()


class _MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD)]


def _area(r: wintypes.RECT) -> gamewin.Area:
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def _screen(hmon) -> gamewin.Screen:
    mi = _MONITORINFO()
    mi.cbSize = ctypes.sizeof(mi)
    u32.GetMonitorInfoW(hmon, ctypes.byref(mi))
    return gamewin.Screen(_area(mi.rcMonitor), _area(mi.rcWork))


def screens() -> list[gamewin.Screen]:
    out = []
    proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT),
                              wintypes.LPARAM)

    def each(h, _dc, _r, _p):
        out.append(_screen(h))
        return True

    u32.EnumDisplayMonitors(None, None, proc(each), 0)
    return out


def cursor() -> tuple[int, int]:
    p = wintypes.POINT()
    u32.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


def screen_under_cursor() -> gamewin.Screen:
    return gamewin.pick_screen(screens(), cursor())


def screen_of(hwnd: int) -> gamewin.Screen:
    """窗口现在在哪块屏幕上(大半在哪块算哪块)"""
    u32.MonitorFromWindow.restype = wintypes.HMONITOR
    return _screen(u32.MonitorFromWindow(wintypes.HWND(hwnd), 2))  # MONITOR_DEFAULTTONEAREST


def screen_size() -> list[int] | None:
    """鼠标所在那块屏幕多大(实打实的像素):设置页只列放得下的画面大小"""
    try:
        _, _, w, h = screen_under_cursor().bounds
        return [w, h]
    except Exception:  # noqa: BLE001
        return None


def window_args(s, screen: gamewin.Screen | None = None) -> dict:
    """照设置算游戏窗口的位置、大小、样子(默认开在鼠标那块屏幕上);算不出来就照旧全屏"""
    try:
        scr = screen or screen_under_cursor()
        return gamewin.window_args(s.game_display, s.game_size, scr, scale(), frame(monitor_dpi(scr)))
    except Exception:  # noqa: BLE001
        import logging

        logging.exception("算游戏窗口大小出错了,照旧全屏")
        return {"fullscreen": True, "min_size": gamewin.MIN_SIZE}


def launcher_window() -> dict:
    """启动器窗口放哪、多大:在鼠标那块屏的正中,画面是 1280×720 个逻辑像素(150% 的屏上 1920×1080),
    屏幕小(比如 1366 宽、或者 1080p 开 150% 缩放)就按屏幕宽度的 86% 缩。
    给 pywebview 的数:它无边框时会把边框那圈缩掉,所以宽高先加上;再按主屏缩放折过"""
    try:
        scr = screen_under_cursor()
        dpi = monitor_dpi(scr)
    except Exception:  # noqa: BLE001
        return {"width": 1280, "height": 720}
    k = dpi / 96
    w = min(1280, int(scr.bounds[2] / k * 0.86))
    cw, ch = round(w * k), round(w * 9 / 16 * k)
    fw, fh = frame(dpi)
    wx, wy, ww, wh = scr.work
    s = scale()
    return {"x": gamewin._logical(wx + (ww - cw) // 2, s), "y": gamewin._logical(wy + (wh - ch) // 2, s),
            "width": gamewin._logical(cw + fw, s), "height": gamewin._logical(ch + fh, s)}
