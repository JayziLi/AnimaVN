"""设计原型的本机静态服务:和 python -m http.server 一样,但每次都让浏览器拿最新文件(改了原型刷新就能看到)。
在 docs/design 下运行:python serve.py [端口,默认 8765]"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
handler = partial(NoCache, directory=str(Path(__file__).parent))
ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
