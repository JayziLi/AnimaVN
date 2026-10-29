"""每种情况要开哪些进程、等哪个地址答应、游戏地址是什么。只算不开,好测。

整合包:一个 python 进程(server.py)同时给接口和打包好的页面,端口被占着就往后找(启动器选好再传进来)。
源码文件夹:后端(uvicorn)+ 游戏页面。打包版先 vite build 再 vite preview(5180,以前的 play.bat);
开发版 npm run dev(5173,以前的 start.bat)。这两个端口是后端 CORS 放行的,不能改。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from layout import Layout
from settings import Settings

BUILD_PORT, DEV_PORT = 5180, 5173


@dataclass(frozen=True)
class Step:
    name: str  # backend / web / build
    label: str  # 界面上的叫法:后端 / 游戏页面 / 打包游戏页面
    cmd: list[str]
    cwd: Path
    env: dict[str, str] = field(default_factory=dict)
    health: str = ""  # 这个地址答应了才算起来;空 = 跑完就行


@dataclass(frozen=True)
class Plan:
    prepare: list[Step]  # 先跑完的
    services: list[Step]  # 一直开着的
    page_port: int  # 游戏页面的端口
    host: str  # 0.0.0.0 让手机连 / 127.0.0.1 只给这台电脑

    # ?play=1:黑底 logo 开屏,角色卡和图都下好了才出「点击进入游戏」(frontend/src/debug/vn/PlaySplash.tsx)
    def game_url(self) -> str:
        return f"http://localhost:{self.page_port}/debug.html?play=1"

    def lan_url(self, ip: str | None) -> str | None:
        return f"http://{ip}:{self.page_port}/debug.html?play=1" if ip and self.host == "0.0.0.0" else None


def make_plan(lay: Layout, s: Settings, backend_port: int) -> Plan:
    host = "0.0.0.0" if s.lan else "127.0.0.1"
    health = f"http://127.0.0.1:{backend_port}/api/health"
    if lay.kind == "portable":
        cmd = [str(lay.python), str(lay.launcher / "server.py"), "--host", host, "--port", str(backend_port)]
        return Plan([], [Step("backend", "后端", cmd, lay.root, health=health)], backend_port, host)

    backend = Step("backend", "后端",
                   [str(lay.python), "-m", "uvicorn", "app.main:app", "--host", host, "--port", str(backend_port)],
                   lay.backend, health=health)
    # 页面默认找 8000 的后端;换了端口要告诉它(frontend/src/debug/lib/api.ts 的 VITE_API_PORT)
    env = {} if backend_port == 8000 else {"VITE_API_PORT": str(backend_port)}
    expose = ["--host"] if s.lan else []
    if s.dev_mode == "dev":
        web = Step("web", "游戏页面", ["cmd", "/c", "npm", "run", "dev", "--", *expose, "--port", str(DEV_PORT), "--strictPort"],
                   lay.frontend, env, f"http://localhost:{DEV_PORT}/debug.html")
        return Plan([], [backend, web], DEV_PORT, host)
    build = Step("build", "打包游戏页面", ["cmd", "/c", "npx", "vite", "build", "--logLevel", "error"], lay.frontend, env)
    web = Step("web", "游戏页面", ["cmd", "/c", "npx", "vite", "preview", *expose, "--port", str(BUILD_PORT), "--strictPort"],
               lay.frontend, env, f"http://localhost:{BUILD_PORT}/debug.html")
    return Plan([build], [backend, web], BUILD_PORT, host)
