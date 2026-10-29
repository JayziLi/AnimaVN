"""启动器、游戏、后台三个程序怎么互相找:谁开着、后台在哪个端口、开一个新的。

    启动器 gui.py   公告、开始游戏、设置、控制台;一打开就叫后台起来(手机马上能扫码)
    游戏   game.py  单独的程序,自己的窗口和任务栏图标;没有后台就自己叫一个
    后台   host.py  看不见,管后端和游戏页面;启动器和游戏都关了它自己收工

谁开着:每个程序在存档文件夹的 run\\ 里写一个「进程号 + 开机时间」,别人拿它问 Windows 那个进程还在不在
(只看进程号的话,进程退了号码会被别的程序用掉)。后台另写一个端口文件,启动器和游戏经它要状态和日志。
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import logging
import os
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path

import net

NO_WINDOW = 0x08000000
DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP:开它的程序关了它也不跟着走
STILL_ACTIVE = 259


def run_dir(lay) -> Path:
    return lay.data / "run"


# ---- 谁开着 ----

def _start_time(pid: int) -> int | None:
    """进程的开机时间(FILETIME 的整数);进程不在了返回 None"""
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return None
    try:
        code = wintypes.DWORD()
        if not k.GetExitCodeProcess(h, ctypes.byref(code)) or code.value != STILL_ACTIVE:
            return None
        times = [wintypes.FILETIME() for _ in range(4)]
        if not k.GetProcessTimes(h, *[ctypes.byref(t) for t in times]):
            return None
        return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
    finally:
        k.CloseHandle(h)


def mark_running(lay, name: str) -> None:
    pid = os.getpid()
    path = run_dir(lay) / f"{name}.pid"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{pid} {_start_time(pid)}", "utf-8")


def running(lay, name: str, start_time=_start_time) -> bool:
    try:
        pid, born = (run_dir(lay) / f"{name}.pid").read_text("utf-8").split()
        return str(start_time(int(pid))) == born
    except (OSError, ValueError):
        return False


def version_of(lay) -> str:
    vf = lay.launcher / "version.json"
    if vf.is_file():
        return json.loads(vf.read_text("utf-8")).get("version", "")
    try:
        branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=lay.root, capture_output=True,
                                text=True, timeout=5, creationflags=NO_WINDOW).stdout.strip()
    except OSError:
        branch = ""
    return "源码文件夹" + (f" · {branch}" if branch else "")


def webview_profile(lay, name: str) -> Path:
    """WebView2 的配置文件夹:固定下来启动快(临时的每次冷启动 5–13 秒,固定 2 秒);
    每个安装、每个程序一份(启动器 launcher / 游戏 game),两个程序同时开着共用一个会打架"""
    tag = hashlib.md5(str(lay.root).encode()).hexdigest()[:8]
    suffix = "" if name == "launcher" else f"-{name}"
    return Path(os.environ.get("LOCALAPPDATA", lay.data)) / "AnimaVN" / f"webview-{tag}{suffix}"


def mark_window(lay, window, app_id: str, script: str, name: str) -> None:
    """窗口出来以后在任务栏上用 AnimaVN 的图标和名字(winutil.window_identity;商店版 Python 下不这样会显示 Python 图标)"""
    import winutil

    hwnd = window.native.Handle.ToInt64()
    icon = str(lay.launcher / "AnimaVN.ico")
    command = f'"{pythonw(lay)}" "{lay.launcher / script}"'
    logging.info("任务栏身份 %s %s", app_id, winutil.window_identity(hwnd, app_id, icon, command, name))


def is_test_copy(lay) -> bool:
    """git 分身文件夹(.git 是个文件):里面是测试用的副本,界面上要挂「测试版」"""
    return (lay.root / ".git").is_file()


# ---- 开一个新的 ----

def pythonw(lay) -> Path:
    """不弹黑窗口的那个 python(和 lay.python 同一个文件夹)"""
    return lay.python.with_name("pythonw.exe")


def spawn(lay, script: str, *args: str) -> subprocess.Popen:
    """另开一个程序(launcher 文件夹里的 script),和自己脱钩:自己关了它照样跑"""
    cmd = [str(pythonw(lay)), str(lay.launcher / script), *args]
    logging.info("开 %s", " ".join(cmd))
    # WebView2 的启动参数各管各的(游戏要自动放声音,启动器不用),别把自己的传下去
    env = {k: v for k, v in os.environ.items() if k != "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"}
    return subprocess.Popen(cmd, cwd=lay.root, env=env, creationflags=DETACHED | NO_WINDOW, close_fds=True,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def log_to_file(lay, name: str) -> None:
    """pythonw 没有控制台:自己的输出和报错(包括 pywebview 记的)写进 data/logs/<name>.log"""
    lay.logs.mkdir(parents=True, exist_ok=True)
    f = open(lay.logs / f"{name}.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115 —— 一直开到进程结束
    sys.stdout = sys.stderr = f
    logging.basicConfig(level=logging.INFO, stream=f, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.info("%s 打开了(进程 %s)", name, os.getpid())


# ---- 后台 ----

class Host:
    """问后台要东西。后台没开、刚关、端口文件是上次留下的,都返回 None / 空,不抛"""

    def __init__(self, lay, get_json=net.get_json, post_json=net.post_json):
        self._lay, self._get, self._post = lay, get_json, post_json

    def _url(self, path: str) -> str | None:
        try:
            port = int((run_dir(self._lay) / "host.port").read_text("utf-8").strip())
        except (OSError, ValueError):
            return None
        return f"http://127.0.0.1:{port}{path}"

    def snapshot(self) -> dict | None:
        url = self._url("/snapshot")
        try:
            return self._get(url, timeout=3) if url else None
        except net.BackendError:
            return None

    def logs(self, name: str) -> list[str]:
        url = self._url(f"/logs?name={name}")
        try:
            return self._get(url, timeout=3) if url else []
        except net.BackendError:
            return []

    def restart(self) -> bool:
        url = self._url("/restart")
        try:
            return bool(url and self._post(url, {}, timeout=3))
        except net.BackendError:
            return False


def ensure_host(lay, is_running=None, start=None) -> bool:
    """后台没开就开一个;开了新的返回 True"""
    if (is_running or running)(lay, "host"):
        return False
    (start or spawn)(lay, "host.py")
    return True
