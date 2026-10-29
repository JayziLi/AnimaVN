"""同一份存档只开一个启动器 / 一个游戏:开着的那个在本机一个端口上等口令。

第二次双击连过去说 show,把它叫到前面;启动器改了画面设置,对游戏说 display,让它马上套上。
"""

from __future__ import annotations

import socket
import threading
from pathlib import Path


def serve(path: Path, handlers: dict[str, object]) -> int:
    """handlers:口令 → 收到时调的函数(不带参数)"""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen()
    port = srv.getsockname()[1]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(port), "utf-8")

    def loop():
        while True:
            conn, _ = srv.accept()
            with conn:
                conn.settimeout(2)
                try:
                    fn = handlers.get(conn.recv(32).decode("ascii", "replace").strip())
                except OSError:
                    continue
            if fn:
                try:
                    fn()
                except Exception:  # noqa: BLE001 —— 一个口令出错不能把门关了
                    pass

    threading.Thread(target=loop, daemon=True).start()
    return port


def send(path: Path, command: str) -> bool:
    """给开着的那个发口令;没开(或者端口文件是上次留下的)返回 False"""
    try:
        port = int(path.read_text("utf-8").strip())
        with socket.create_connection(("127.0.0.1", port), timeout=2) as s:
            s.sendall(command.encode("ascii"))
        return True
    except (OSError, ValueError):
        return False


def poke(path: Path) -> bool:
    return send(path, "show")
