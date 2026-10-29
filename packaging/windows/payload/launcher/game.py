"""游戏本体:单独的程序,自己的窗口和任务栏图标(像二游那样,启动器只管启动;用户 10-21 定的)。

启动器点「开始游戏」开它;也能直接双击它(没开后台就自己叫一个)。
后台还没好时先放黑底 logo 的等待页(ui/boot.html),好了换成游戏页面(debug.html?play=1,开屏接着等素材)。
窗口关了它就退出;启动器关不关都不影响它。同一份存档只开一个,再开一次就把它叫到前面。
画面(全屏 / 无边框 / 窗口、大小)和启动器共用一份设置:游戏里改、启动器里改,开着的窗口都马上套上。

    源码文件夹:AnimaBackend\\.venv\\Scripts\\pythonw.exe packaging\\windows\\payload\\launcher\\game.py
"""

from __future__ import annotations

import ctypes
import logging
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import apps  # noqa: E402
import common  # noqa: E402
import gamewin  # noqa: E402
import layout as layout_mod  # noqa: E402
import settings as settings_mod  # noqa: E402
import single  # noqa: E402
import winutil  # noqa: E402

UI = HERE / "ui"
ICON = HERE / "AnimaVN.ico"
# F11 或 Alt+Enter 切换全屏(页面自己不知道外面是 pywebview)
HOTKEYS = """document.addEventListener('keydown', function (e) {
  if (e.key === 'F11' || (e.key === 'Enter' && e.altKey)) { e.preventDefault(); window.pywebview.api.toggle_fullscreen(); }
});"""
SWP_NOZORDER, SWP_FRAMECHANGED, SWP_NOACTIVATE = 0x0004, 0x0020, 0x0010


class GameApi:
    """游戏窗口里的页面能调的(等待页、游戏里的「显示 → 窗口」那两行)。属性一律下划线开头"""

    def __init__(self, game):
        self._g = game

    def toggle_fullscreen(self):
        self._g.window.toggle_fullscreen()

    def status(self):
        """等待页用:后台到哪一步了;好了带上游戏地址"""
        snap = self._g.host.snapshot()
        if snap is None:
            return {"phase": "waiting", "message": "正在叫后台起来……"}
        return {k: snap.get(k) for k in ("phase", "message", "game_url")}

    def retry(self):
        if not apps.ensure_host(self._g.lay):
            self._g.host.restart()
        return True

    def open_launcher(self):
        if not single.poke(self._g.lay.data / "launcher.ipc"):
            apps.spawn(self._g.lay, "gui.py")
        return True

    def get_display(self):
        s = settings_mod.load(self._g.lay.settings_file)
        try:
            _, _, sw, sh = winutil.screen_of(self._g.hwnd()).bounds
        except Exception:  # noqa: BLE001
            sw = sh = 10 ** 5
        sizes = [v for v in settings_mod.CHOICES["game_size"]
                 if v == s.game_size or (gamewin.size_of(v)[0] <= sw and gamewin.size_of(v)[1] <= sh)]
        return {"display": s.game_display, "size": s.game_size, "sizes": sizes}

    def set_display(self, key, value):
        if key not in settings_mod.DISPLAY_KEYS:
            raise ValueError(f"这里只能改画面:{key}")
        settings_mod.update(self._g.lay.settings_file, key, value)
        self._g.apply_display()
        return self.get_display()


class Game:
    def __init__(self, lay):
        self.lay = lay
        self.host = apps.Host(lay)
        self.window = None

    def hwnd(self) -> int:
        return self.window.native.Handle.ToInt64()

    def first_url(self) -> str:
        snap = self.host.snapshot()
        if snap and snap.get("phase") == "ready" and snap.get("game_url"):
            return snap["game_url"]
        return str(UI / "boot.html")

    def show(self) -> None:
        """再开一次 / 启动器点「回到游戏」:叫到前面(最小化了就还原)"""
        self.window.show()
        self.window.restore()
        ctypes.windll.user32.SetForegroundWindow(self.hwnd())

    def apply_display(self) -> None:
        """照设置文件里的画面设置改开着的窗口:全屏进出用 pywebview 自己的,边框和大小在界面线程里改"""
        s = settings_mod.load(self.lay.settings_file)
        form = self.window.native
        want_full = s.game_display == "fullscreen"
        if bool(form.is_fullscreen) != want_full:
            self.window.toggle_fullscreen()
        if want_full:
            return
        hwnd = self.hwnd()
        x, y, w, h = gamewin.window_rect(s.game_display, s.game_size, winutil.screen_of(hwnd),
                                         winutil.frame(winutil.window_dpi(hwnd)))
        logging.info("画面改成 %s %s → %s", s.game_display, s.game_size, (x, y, w, h))
        import System.Windows.Forms as WinForms
        from System import Func, Type

        def apply():
            if s.game_display == "borderless":
                form.FormBorderStyle = getattr(WinForms.FormBorderStyle, "None")
            else:
                form.FormBorderStyle = WinForms.FormBorderStyle.Sizable
                form.MaximizeBox = True
            if form.WindowState != WinForms.FormWindowState.Normal:
                form.WindowState = WinForms.FormWindowState.Normal
            ctypes.windll.user32.SetWindowPos(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE)

        form.Invoke(Func[Type](apply))

    def loaded(self) -> None:
        self.window.evaluate_js(HOTKEYS)


def main() -> int:
    winutil.dpi_aware()
    winutil.taskbar_id("AnimaVN.Game")
    lay = layout_mod.detect(HERE)
    lock = common.try_lock(apps.run_dir(lay) / "game.lock")
    if lock is None:
        single.poke(apps.run_dir(lay) / "game.ipc")  # 已经开着了:叫到前面
        return 0
    try:
        apps.mark_running(lay, "game")
        apps.log_to_file(lay, "game")
        if lay.kind == "portable":
            common.unpack_runtime(lay.root)
        apps.ensure_host(lay)
        # 不点一下也能放声音(封面音乐、配音)
        os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required")
        import webview

        game = Game(lay)
        s = settings_mod.load(lay.settings_file)
        args = winutil.window_args(s)
        url = game.first_url()
        logging.info("打开游戏窗口 %s %s", url, args)
        game.window = webview.create_window("AnimaVN", url, js_api=GameApi(game), background_color="#000000",
                                            easy_drag=False, **args)
        game.window.events.loaded += game.loaded
        game.window.events.shown += lambda: apps.mark_window(lay, game.window, "AnimaVN.Game", "game.py", "AnimaVN")
        single.serve(apps.run_dir(lay) / "game.ipc", {"show": game.show, "display": game.apply_display})
        # 和启动器各用一个 WebView2 配置文件夹:两个程序同时开着,共用一个会打架
        profile = apps.webview_profile(lay, "game")
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(profile), icon=str(ICON))
        logging.info("游戏窗口关了")
        return 0
    except Exception:
        logging.exception("游戏出错了")
        raise
    finally:
        common.release(lock)


if __name__ == "__main__":
    sys.exit(main())
