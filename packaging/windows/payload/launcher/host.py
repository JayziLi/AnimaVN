"""后台:后端 + 游戏页面(看不见窗口)。启动器、游戏谁先开谁把它叫起来(apps.ensure_host)。

一开就按设置打包页面、开后端 —— 启动器开着、这里好了,手机就能扫码玩。
启动器和游戏都关了,它停掉后端和页面,自己退出。
启动器和游戏经本机一个小 HTTP 服务找它(端口写在 data\\run\\host.port):
    GET /snapshot          到哪一步了、游戏地址、日志列表、常见报错
    GET /logs?name=backend 某个进程最近的输出
    POST /restart          按文件里最新的设置重开(启动器改了端口、局域网这些)
"""

from __future__ import annotations

import http.server
import json
import logging
import sys
import threading
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import apps  # noqa: E402
import common  # noqa: E402
import layout as layout_mod  # noqa: E402
from controller import Controller  # noqa: E402

GRACE = 20  # 刚开的头这么多秒不收工:叫它的那个程序可能还没写好自己的进程号
IDLE_LIMIT = 4  # 启动器和游戏都不在了,再等这么多秒(重开启动器、从启动器切到游戏都在这几秒里)
CLIENTS = ("launcher", "game")


def serve(ctl, port_file: Path) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, body) -> None:
            raw = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/snapshot":
                self._send(ctl.snapshot())
            elif u.path == "/logs":
                self._send(ctl.logs(urllib.parse.parse_qs(u.query).get("name", [""])[0]))
            else:
                self.send_error(404)

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if self.path == "/restart":
                threading.Thread(target=ctl.restart, daemon=True).start()
                self._send(True)
            else:
                self.send_error(404)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port_file.parent.mkdir(parents=True, exist_ok=True)
    port_file.write_text(str(srv.server_address[1]), "utf-8")
    return srv


def wait_until_alone(anyone_there, sleep=time.sleep, grace: int = GRACE, idle_limit: int = IDLE_LIMIT) -> None:
    """每秒看一眼启动器和游戏还在不在;都不在了连续 idle_limit 秒(开头 grace 秒不算)就回去"""
    t = idle = 0
    while True:
        sleep(1)
        t += 1
        idle = 0 if anyone_there() else idle + 1
        if t >= grace and idle >= idle_limit:
            return


def main() -> int:
    lay = layout_mod.detect(HERE)
    lock = common.try_lock(apps.run_dir(lay) / "host.lock")
    if lock is None:
        return 0  # 已经有一个后台了
    try:
        apps.mark_running(lay, "host")
        apps.log_to_file(lay, "host")
        ctl = Controller(lay, version=apps.version_of(lay))
        srv = serve(ctl, apps.run_dir(lay) / "host.port")
        ctl.start()
        wait_until_alone(lambda: any(apps.running(lay, n) for n in CLIENTS))
        logging.info("启动器和游戏都关了,收工")
        ctl.shutdown()
        srv.shutdown()
        return 0
    except Exception:
        logging.exception("后台出错了")
        raise
    finally:
        common.release(lock)


if __name__ == "__main__":
    sys.exit(main())
