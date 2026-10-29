"""双击 AnimaVN 打开的启动器(pywebview + Windows 自带的 WebView2):公告、开始游戏、设置、控制台、语音服务器。

启动器只管启动(用户 10-21:「参考那些二游的做法,启动器只是用于启动的」):
- 一打开就叫后台(host.py)起来:打包游戏页面、开后端;好了手机就能扫码玩
- 开始游戏 = 开游戏本体(game.py:单独的程序,自己的窗口和任务栏图标);设置里能改成用浏览器打开
- 点完以后启动器默认留着(设置里能改成最小化 / 关掉);关掉启动器就是退出,开着的游戏不受影响
界面是 ui/(照设计稿 A 玻璃版),经 window.pywebview.api 调 App 的方法。三个程序怎么互相找见 apps.py。

    源码文件夹:start.bat(= AnimaBackend\\.venv\\Scripts\\pythonw.exe packaging\\windows\\payload\\launcher\\gui.py)
    整合包:下一份计划里的 AnimaVN.exe
"""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess
import sys
import threading
import time
import webbrowser
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import apps  # noqa: E402
import backend_api  # noqa: E402
import common  # noqa: E402
import layout as layout_mod  # noqa: E402
import net  # noqa: E402
import settings as settings_mod  # noqa: E402
import single  # noqa: E402
import winutil  # noqa: E402

UI = HERE / "ui"
ICON = HERE / "AnimaVN.ico"  # 窗口、任务栏、桌面快捷方式用的(和网页的 favicon.ico 是同一个)
NO_WINDOW = 0x08000000
RESPAWN_EVERY = 15  # 后台没在跑:隔这么多秒再叫一次
RESPAWN_TRIES = 3  # 叫了这么多次还起不来就报错


def message_box(text: str) -> None:
    ctypes.windll.user32.MessageBoxW(None, text, "AnimaVN", 0x40)


def copy_text(text: str) -> None:
    """放进剪贴板(clip.exe 认带 BOM 的 UTF-16)"""
    subprocess.run(["clip"], input=text.encode("utf-16"), check=True, creationflags=NO_WINDOW)


class App:
    """界面调的方法(名字要和 ui/launcher.js 的 API_METHODS 对上)。属性一律下划线开头:pywebview 会顺着公开属性往下翻"""

    def __init__(self, lay, host=None, clock=time.monotonic):
        self._lay = lay
        self._host = host or apps.Host(lay)
        self._clock = clock
        self._main = None
        self._version = apps.version_of(lay)
        self._test_copy = apps.is_test_copy(lay)
        self._spawned_at = clock()  # 启动器开的时候叫过一次后台
        self._spawns = 1

    def _settings(self) -> settings_mod.Settings:
        return settings_mod.load(self._lay.settings_file)

    def _host_state(self) -> dict:
        """后台的状态;后台没在跑就再叫它(隔一会儿一次),叫了几次都起不来就报错"""
        snap = self._host.snapshot()
        if snap is not None:
            self._spawns = 0
            return snap
        if not apps.running(self._lay, "host") and self._clock() - self._spawned_at > RESPAWN_EVERY:
            if self._spawns >= RESPAWN_TRIES:
                return {"phase": "failed", "message": "后台起不来。存档文件夹 logs\\host.log 里有原因，点「重试」再叫一次。"}
            self._spawned_at, self._spawns = self._clock(), self._spawns + 1
            apps.ensure_host(self._lay)
        return {"phase": "starting", "message": "正在启动后台……"}

    # ---- 给界面 ----

    def snapshot(self):
        s = self._settings()
        h = self._host_state()
        phase = "starting" if h.get("phase") in (None, "idle", "stopped") else h["phase"]
        booted = h.get("booted") or {}
        # 后台是按哪份设置开的,和文件里现在的比:要重启才生效的那几项变了就提醒
        restart_needed = bool(booted) and phase != "failed" and any(
            booted.get(k) != getattr(s, k) for k in settings_mod.RESTART_KEYS)
        return {
            "phase": phase,
            "message": h.get("message") or "",
            "kind": self._lay.kind,
            "version": self._version,
            "settings": asdict(s),
            "restart_needed": restart_needed,
            "game_open": apps.running(self._lay, "game"),
            "game_url": h.get("game_url") if phase == "ready" else None,
            "lan_url": h.get("lan_url") if phase == "ready" else None,
            "tailscale_url": h.get("tailscale_url") if phase == "ready" else None,
            "logs": h.get("logs") or [],
            "hints": h.get("hints") or [],
            "test_copy": self._test_copy,
        }

    def screen(self):
        return winutil.screen_size()

    def logs(self, name):
        return self._host.logs(name)

    def _base(self) -> str | None:
        snap = self._host.snapshot() or {}
        return snap.get("base") if snap.get("phase") == "ready" else None

    def last_play(self):
        base = self._base()
        return backend_api.last_play(base) if base else None

    def voice(self):
        base = self._base()
        return backend_api.voice_servers(base) if base else []

    def qr(self, kind="lan"):
        """手机扫的码:lan 同一个 Wi-Fi / tailscale 走 Tailscale(Wi-Fi 把设备隔开时)"""
        url = self.snapshot()["tailscale_url" if kind == "tailscale" else "lan_url"]
        return {"url": url, "svg": net.qr_svg(url)} if url else {"url": None, "svg": ""}

    def start_game(self):
        snap = self.snapshot()
        if not snap["game_url"]:
            return {"ok": False, "message": "还没启动好，稍等一下"}
        s = self._settings()
        if s.open_in == "browser":
            webbrowser.open(snap["game_url"])
            message = "在默认浏览器里打开了"
        else:
            self._open_game()
            message = ""
        if s.after_start == "minimize":
            self._main.minimize()
        elif s.after_start == "close":
            threading.Timer(0.6, self._quit).start()  # 先让界面拿到回话
        return {"ok": True, "message": message}

    def open_other(self):
        """齿轮里那一项:和设置里选的反过来(设的是游戏窗口就开浏览器,反之亦然)"""
        snap = self.snapshot()
        if not snap["game_url"]:
            return {"ok": False, "message": "还没启动好，稍等一下"}
        if self._settings().open_in == "window":
            webbrowser.open(snap["game_url"])
            return {"ok": True, "message": "在默认浏览器里打开了"}
        self._open_game()
        return {"ok": True, "message": "打开游戏窗口了"}

    def copy(self, text):
        copy_text(str(text))
        return True

    def open_url(self, url):
        if not str(url).startswith(("http://", "https://")):
            raise ValueError("只能打开网页地址")
        webbrowser.open(url)
        return True

    def open_logs(self):
        self._lay.logs.mkdir(parents=True, exist_ok=True)
        os.startfile(self._lay.logs)
        return True

    def open_data(self):
        os.startfile(self._lay.data)
        return True

    def set_setting(self, key, value):
        settings_mod.update(self._lay.settings_file, key, value)
        if key in settings_mod.DISPLAY_KEYS and apps.running(self._lay, "game"):
            single.send(apps.run_dir(self._lay) / "game.ipc", "display")  # 开着的游戏窗口马上套上
        return self.snapshot()

    def restart(self):
        if not self._host.restart():
            self._spawned_at, self._spawns = self._clock(), 1
            apps.ensure_host(self._lay)
        return True

    def minimize(self):
        self._main.minimize()
        return True

    def close(self):
        self._quit()
        return True

    # ---- 窗口 ----

    def _open_game(self):
        """游戏开着就叫到前面,没开就开一个(单独的程序)"""
        if apps.running(self._lay, "game"):
            self._let_game_come_forward()
            if single.poke(apps.run_dir(self._lay) / "game.ipc"):
                return
        apps.spawn(self._lay, "game.py")

    def _let_game_come_forward(self):
        """Windows 不许后台程序自己跳到最前面:启动器(用户刚点过,在前台)先给游戏放行"""
        try:
            pid = int((apps.run_dir(self._lay) / "game.pid").read_text("utf-8").split()[0])
            ctypes.windll.user32.AllowSetForegroundWindow(pid)
        except (OSError, ValueError, IndexError):
            pass

    def _show_main(self):
        self._main.show()
        self._main.restore()

    def _quit(self):
        self._main.destroy()


def main() -> int:
    winutil.dpi_aware()
    winutil.taskbar_id("AnimaVN.Launcher")
    lay = layout_mod.detect(HERE)
    lay.data.mkdir(parents=True, exist_ok=True)
    lock = common.try_lock(lay.data / "launcher.lock")
    if lock is None:
        if not single.poke(lay.data / "launcher.ipc"):
            message_box("AnimaVN 已经开着了（可能是以前的黑窗口版）。先把它关掉，再打开启动器。")
        return 0
    try:
        apps.mark_running(lay, "launcher")
        apps.log_to_file(lay, "launcher")  # 拿到锁的这一个才写日志(第二次双击只是把它叫出来)
        if lay.kind == "portable":
            common.unpack_runtime(lay.root)
        apps.ensure_host(lay)  # 一打开就让后台打包页面、开后端
        import webview

        app = App(lay)
        app._main = webview.create_window("AnimaVN 启动器", url=str(UI / "index.html"), js_api=app,
                                          resizable=False, frameless=True, easy_drag=False, background_color="#0e0f18",
                                          **winutil.launcher_window())
        app._main.events.shown += lambda: apps.mark_window(lay, app._main, "AnimaVN.Launcher", "gui.py", "AnimaVN 启动器")
        single.serve(lay.data / "launcher.ipc", {"show": app._show_main})
        webview.start(gui="edgechromium", private_mode=False,
                      storage_path=str(apps.webview_profile(lay, "launcher")), icon=str(ICON))
        logging.info("启动器关了")
        return 0
    except Exception:
        logging.exception("启动器出错了")
        raise
    finally:
        common.release(lock)


if __name__ == "__main__":
    sys.exit(main())
