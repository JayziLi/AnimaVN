"""IndexTTS 小服务 + AnimaVN 的 /anima/* 接口(收声音文件,和 GSV 插件同一份 anima_gsv_routes.py)。
放在 server.py 同一个目录,启动时用它代替 server.py,参数不变:
    uv run python anima_indextts.py --host 127.0.0.1 --port 9890 --cpus 0-15
配对码在同目录的 anima_pair.txt,启动窗口也会显示。不想要了就改回 server.py。
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import uvicorn  # noqa: E402

import anima_gsv_routes  # noqa: E402
import server  # noqa: E402  按命令行参数建好 app

PAIR_CODE = anima_gsv_routes.register(server.app, HERE, [Path(r"D:\AnimaVoice"), Path(r"G:\AnimaVoice")])
print("AnimaVN 配对码:", PAIR_CODE, flush=True)

if __name__ == "__main__":
    # 和 server.py 的 __main__ 一样:模型加载完才开始监听
    server.load_model()
    uvicorn.run(server.app, host=server.args.host, port=server.args.port, access_log=False)
