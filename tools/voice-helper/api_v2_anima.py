"""AnimaVN 用的 GPT-SoVITS 启动入口:原样跑 api_v2.py,再加 /anima/* 接口(收声音文件、按指纹查、同机探测、只读取文件),
见 anima_gsv_routes.py;要和这个文件放在同一个目录。

放在语音机的 D:\GPT-SoVITS\ 下,由 start-api.bat 启动:
    runtime\python.exe api_v2_anima.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
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

import api_v2  # noqa: E402

import anima_gsv_routes  # noqa: E402

# 老声音放在 D:\AnimaVoice、G:\AnimaVoice;别的电脑上这两个目录不存在,register 会跳过
PAIR_CODE = anima_gsv_routes.register(
    api_v2.APP, Path(__file__).resolve().parent, [Path(r"D:\AnimaVoice"), Path(r"G:\AnimaVoice")]
)
print("AnimaVN 配对码:", PAIR_CODE)


if __name__ == "__main__":
    try:
        host = None if api_v2.host == "None" else api_v2.host
        uvicorn.run(app=api_v2.APP, host=host, port=api_v2.port, workers=1)
    except Exception:
        traceback.print_exc()
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)
