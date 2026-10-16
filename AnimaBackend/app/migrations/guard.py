"""迁移没成功时挡住接口的中间件。纯 ASGI 写法(不用 BaseHTTPMiddleware),不碰流式响应。

closed(升级失败):除了 /api/health 和 /api/meta/migrations,/api 下一律 503
read_only(库被更新的版本升级过):只放行 GET / HEAD / OPTIONS
"""

import json

from app.migrations import state

ALWAYS_OPEN = ("/api/health", "/api/meta/migrations")
READ_METHODS = ("GET", "HEAD", "OPTIONS")


class MigrationGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        gate = state.current.gate
        path = scope.get("path", "")
        if gate == "open" or path in ALWAYS_OPEN or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return
        if gate == "read_only" and scope.get("method", "GET") in READ_METHODS:
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": state.current.message or "数据库暂时不能用"}, ensure_ascii=False).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 503,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
