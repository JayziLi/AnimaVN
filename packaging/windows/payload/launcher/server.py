"""整合包的后端:一个端口同时给接口和打包好的游戏页面。

启动器(gui.py)用不带窗口的方式开它,输出收进控制台页;黑窗口版(start.py)直接在自己的进程里调 serve。
    python\\python.exe launcher\\server.py --port 8000 [--host 0.0.0.0]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="AnimaVN 后端 + 游戏页面")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    return ap.parse_args(argv)


def serve(host: str, port: int, root: Path = common.ROOT, log_level: str = "info") -> None:
    sys.path.insert(0, str(root / "AnimaBackend"))
    import uvicorn
    from fastapi.staticfiles import StaticFiles

    from app.main import app

    # 接口都在 /api 下面(先挂的先匹配),剩下的路径都交给打包好的游戏页面
    app.mount("/", StaticFiles(directory=root / "web", html=True), name="web")
    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    a = parse_args(sys.argv[1:])
    serve(a.host, a.port)
