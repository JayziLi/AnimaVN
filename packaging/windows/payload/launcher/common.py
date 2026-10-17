"""启动器(start.py)和更新器(update.py)共用的:文件夹在哪、同一份存档只许一个程序开着。"""

import importlib
import json
import msvcrt
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # 整合包的根文件夹(AnimaVN.bat 所在)
# 整合包里依赖、后端、页面、模型是一个压缩包套在里面:Windows 自带的解压一万个小文件要一两个小时,
# 外层只剩几十个文件,里面这个第一次启动时用 Python 解(半分钟)
RUNTIME_ZIP = "runtime.zip"
DATA = ROOT / "AnimaBackend" / "data"  # 存档:角色卡、聊天、立绘……更新时不动
LOCK = DATA / "launcher.lock"  # 游戏开着时锁住;更新器拿不到锁就说「先关游戏」
PORT_FILE = DATA / "launcher.port"  # 开着的那个游戏用的端口,第二次双击时直接打开它
VERSION_FILE = ROOT / "launcher" / "version.json"  # 打包时写的:版本、运行环境指纹、下载源


def try_lock(path: Path):
    """拿到锁返回打开的文件(一直开着就一直锁着),别人拿着返回 None。进程退出时系统自动放开。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "a+b")
    try:
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        f.close()
        return None
    return f


def release(lock) -> None:
    lock.seek(0)
    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
    lock.close()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text("utf-8"))


def unpack_runtime(root: Path = ROOT) -> bool:
    """有 runtime.zip 就解开、解完删掉;没有(早解过了)返回 False。

    解到一半关了窗口也没事:zip 还在,下次接着从头覆盖着解。拿着锁再调,别两个程序一起解。
    """
    zip_path = root / RUNTIME_ZIP
    if not zip_path.is_file():
        return False
    t0 = time.time()
    with zipfile.ZipFile(zip_path) as z:
        members = z.infolist()
        total = sum(m.file_size for m in members) or 1
        done, shown = 0, -1
        for m in members:
            z.extract(m, root)
            done += m.file_size
            pct = done * 100 // total
            if pct != shown:
                print(f"\r  第一次启动,解压中 {pct}%", end="", flush=True)
                shown = pct
    print(f"\r  第一次启动,解压好了({time.time() - t0:.0f} 秒)")
    zip_path.unlink()
    # Python 启动时 site-packages 还不存在,已经记成了「这里没东西」:让它重新看一遍
    importlib.invalidate_caches()
    return True
