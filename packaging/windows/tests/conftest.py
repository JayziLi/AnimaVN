import http.server
import json
import sys
import threading
from pathlib import Path

import pytest

# 整合包里的启动器 / 更新器是单独的脚本(不在 app 里),测试直接按文件夹导入
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "payload" / "launcher"))


class _FakeBackend(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/ok":
            self._send(200, {"a": 1})
        elif self.path == "/text":
            self._send(200, b"data:image/png;base64,AAA", "text/plain")
        else:
            self._send(404, {"detail": "这张卡没有头像"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self._send(200, {"got": json.loads(self.rfile.read(n) or b"{}")})


@pytest.fixture
def fake_backend():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FakeBackend)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
