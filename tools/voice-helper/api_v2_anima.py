"""AnimaVN 用的 GPT-SoVITS 启动入口:原样跑 api_v2.py,再加一条只读接口
GET /anima/ref?path=<语音机上的文件路径>:把参考音频或模型文件原样发出来。

用处:AnimaVN「历史 → 语音详情」试听参考音频的原声(2026-09-26 起);导出声音包时把参考和模型
拉回笔记本(2026-10-17 起,第 4 步)。只读,不收任何文件。

放在语音机的 D:\\GPT-SoVITS\\ 下,由 start-api.bat 启动:
    runtime\\python.exe api_v2_anima.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
GSV 源码一行不改:import api_v2(它在模块加载时就按命令行参数建好 APP 和推理管线),挂上路由,
再照 api_v2 的 __main__ 启动。想退回原版:把 start-api.bat 里的 api_v2_anima.py 改回 api_v2.py。
这份是正本:仓库 tools/voice-helper/api_v2_anima.py;台式机上的从这里拷。
"""

import os
import signal
import sys
import traceback
from pathlib import Path

# 整合包 runtime 是嵌入式 Python,不会把脚本所在目录放进 sys.path(api_v2.py 自己也是手动加的)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402

import api_v2  # noqa: E402

# 只放行这几个目录下的音频和模型文件(存在的目录才算):9880 经 tailscale serve 在 tailnet 上可达,
# 不能做成能读任意文件的口子。D 盘是主仓库,刻晴在 G 盘
ROOTS = [p.resolve() for p in (Path(r"D:\AnimaVoice"), Path(r"G:\AnimaVoice")) if p.exists()]
ALLOWED = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".ckpt", ".pth"}


@api_v2.APP.get("/anima/ref")
def anima_ref(path: str):
    try:
        p = Path(path).resolve()
    except (OSError, ValueError):
        return JSONResponse(status_code=400, content={"detail": f"路径不对:{path}"})
    if not any(p.is_relative_to(r) for r in ROOTS) or p.suffix.lower() not in ALLOWED:
        roots = "、".join(str(r) for r in ROOTS)
        return JSONResponse(status_code=403, content={"detail": f"只能读 {roots} 下面的音频和模型文件"})
    if not p.is_file():
        return JSONResponse(status_code=404, content={"detail": f"文件不存在:{path}"})
    return FileResponse(p, filename=p.name)


if __name__ == "__main__":
    try:
        host = None if api_v2.host == "None" else api_v2.host
        uvicorn.run(app=api_v2.APP, host=host, port=api_v2.port, workers=1)
    except Exception:
        traceback.print_exc()
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
