"""启动器开的子进程(后端、游戏页面、打包游戏页面)。

平时不弹黑窗口:输出收进来给控制台页看,同时写进日志文件。
「显示终端窗口」开着时后端照以前另开一个黑窗口,输出就只在那个窗口里。
"""

from __future__ import annotations

import collections
import datetime
import os
import re
import subprocess
import threading
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_CONSOLE = 0x00000010
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
LOG_ROTATE_BYTES = 2_000_000


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gbk", "replace")  # cmd 自己的报错是 GBK


class Proc:
    def __init__(self, name: str, cmd: list[str], cwd: Path, env: dict[str, str] | None = None,
                 visible: bool = False, log_file: Path | None = None, keep: int = 3000):
        self.name, self.cmd, self.cwd, self.env = name, cmd, cwd, env or {}
        self.visible, self.log_file = visible, log_file
        self._lines: collections.deque[str] = collections.deque(maxlen=keep)
        self._lock = threading.Lock()
        self._p: subprocess.Popen | None = None
        self._pump_thread: threading.Thread | None = None

    def start(self) -> None:
        if self.log_file:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            if self.log_file.exists() and self.log_file.stat().st_size > LOG_ROTATE_BYTES:
                self.log_file.replace(self.log_file.with_name(self.log_file.stem + ".old.log"))
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "NO_COLOR": "1",
               "FORCE_COLOR": "0", **self.env}
        self._add(f"$ {subprocess.list2cmdline(self.cmd)}")
        if self.visible:
            self._p = subprocess.Popen(self.cmd, cwd=self.cwd, env=env, creationflags=CREATE_NEW_CONSOLE)
            self._add("（显示终端窗口开着：输出在另开的黑窗口里）")
            return
        self._p = subprocess.Popen(self.cmd, cwd=self.cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=CREATE_NO_WINDOW)
        self._pump_thread = threading.Thread(target=self._pump, daemon=True)
        self._pump_thread.start()

    def _pump(self) -> None:
        for raw in iter(self._p.stdout.readline, b""):
            self._add(ANSI.sub("", _decode(raw)).rstrip("\r\n"))

    def _add(self, text: str) -> None:
        line = f"{datetime.datetime.now():%H:%M:%S}  {text}"
        with self._lock:
            self._lines.append(line)
            if self.log_file:
                with self.log_file.open("a", encoding="utf-8") as f:
                    f.write(line + "\n")

    def tail(self, n: int = 500) -> list[str]:
        with self._lock:
            return list(self._lines)[-n:]

    def alive(self) -> bool:
        return self._p is not None and self._p.poll() is None

    def wait(self, timeout: float | None = None) -> int:
        code = self._p.wait(timeout)
        if self._pump_thread:
            self._pump_thread.join(5)  # 最后几行也收进来
        return code

    def stop(self) -> None:
        """连同它开的子进程一起结束(cmd → npx → node 这种)"""
        if not self.alive():
            return
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(self._p.pid)], capture_output=True, timeout=30,
                       creationflags=CREATE_NO_WINDOW)
        try:
            self._p.wait(10)
        except subprocess.TimeoutExpired:
            self._p.kill()
