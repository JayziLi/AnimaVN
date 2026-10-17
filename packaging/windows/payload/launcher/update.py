"""双击「更新.bat」跑的就是这个:去魔搭 / GitHub 看有没有新版,有就只换代码,存档不动。

    python\\python.exe launcher\\update.py

新版只改了代码 → 下一个二十来 MB 的更新包,换掉 UPDATE_ITEMS 里那几样。
新版换了运行环境(Python、依赖、情绪模型,打包时算的 runtime 指纹变了)→ 正在跑的 Python
换不掉自己,打开下载页让玩家重下整合包。
"""

import hashlib
import json
import shutil
import sys
import time
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

# 更新时整个换掉的东西(相对整合包根目录)。存档 AnimaBackend/data、python、情绪模型都不在里面
UPDATE_ITEMS = ["AnimaBackend/app", "web", "launcher", "AnimaVN.bat", "更新.bat", "使用说明.txt"]
DOWNLOAD = "_update.zip"
NEW_DIR = "_update_new"
OLD_DIR = "_update_old"


class UpdateError(Exception):
    pass


def _version_key(v: str):
    try:
        return tuple(int(x) for x in v.split("."))
    except ValueError:
        return None


def decide(local: dict, remote: dict) -> str:
    """latest:不用更新;update:只换代码;full:要重下整合包。"""
    lk, rk = _version_key(local["version"]), _version_key(remote["version"])
    if remote["version"] == local["version"] or (lk and rk and rk <= lk):
        return "latest"  # 有一边还没传完新版时,别把人「更新」回旧版
    if remote.get("runtime") != local.get("runtime"):
        return "full"
    return "update"


def fetch_manifest(sources: list[dict], get) -> tuple[dict, dict]:
    """按顺序问每个下载源的 latest.json,第一个答上来的算数。"""
    errors = []
    for source in sources:
        try:
            return source, json.loads(get(source["base"] + "latest.json"))
        except Exception as e:
            errors.append(f"  {source['name']}:{e}")
    raise UpdateError("哪个下载源都没问到新版信息(网络不通,或者还没发布):\n" + "\n".join(errors))


def check_file(path: Path, size: int, sha256: str) -> None:
    if path.stat().st_size != size:
        raise UpdateError(f"文件没下全({path.stat().st_size} / {size} 字节)")
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != sha256:
        raise UpdateError("下下来的文件校验不对,可能下坏了")


def apply_update(root: Path, new_root: Path, items: list[str], move=shutil.move) -> None:
    """把 new_root 里的 items 换进 root。旧的先挪进 OLD_DIR,中途出错全部挪回来。"""
    missing = [i for i in items if not (new_root / i).exists()]
    if missing:
        raise UpdateError(f"更新包不完整,少了:{'、'.join(missing)}")
    old = root / OLD_DIR
    shutil.rmtree(old, ignore_errors=True)
    done = []  # (item, 原来有没有)
    try:
        for item in items:
            cur = root / item
            had_old = cur.exists()
            if had_old:
                (old / item).parent.mkdir(parents=True, exist_ok=True)
                move(str(cur), str(old / item))
            done.append((item, had_old))
            cur.parent.mkdir(parents=True, exist_ok=True)
            move(str(new_root / item), str(cur))
    except Exception as e:
        for item, had_old in reversed(done):
            cur = root / item
            if cur.is_dir():
                shutil.rmtree(cur)
            elif cur.exists():
                cur.unlink()
            if had_old:
                shutil.move(str(old / item), str(cur))
        shutil.rmtree(old, ignore_errors=True)
        raise UpdateError(f"换文件时出错,已经退回原来的版本:{e}") from e
    shutil.rmtree(old, ignore_errors=True)


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "AnimaVN-updater"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read()


def _download(url: str, dest: Path, size: int) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "AnimaVN-updater"})
    got, t0, last = 0, time.time(), 0.0
    with urllib.request.urlopen(req, timeout=30) as r, dest.open("wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
            got += len(chunk)
            if time.time() - last > 0.5:
                speed = got / max(time.time() - t0, 0.1) / 1048576
                print(f"\r  {got / 1048576:.1f} / {size / 1048576:.1f} MB  {speed:.1f} MB/s   ", end="", flush=True)
                last = time.time()
    print(f"\r  {got / 1048576:.1f} / {size / 1048576:.1f} MB  下完了          ")


def download_any(sources: list[dict], info: dict, dest: Path) -> None:
    errors = []
    for source in sources:
        print(f"  从{source['name']}下载更新包……")
        try:
            _download(source["base"] + info["file"], dest, info["size"])
            check_file(dest, info["size"], info["sha256"])
            return
        except Exception as e:
            print(f"\n  {source['name']}没下成:{e}")
            errors.append(f"  {source['name']}:{e}")
    raise UpdateError("更新包下载失败:\n" + "\n".join(errors))


def main() -> int:
    root = common.ROOT
    local = common.read_json(common.VERSION_FILE)
    print(f"AnimaVN 更新(现在是 {local['version']})\n")

    lock = common.try_lock(common.LOCK)
    if lock is None:
        print("  游戏还开着:先关掉 AnimaVN 的黑窗口,再双击「更新.bat」。")
        return 1
    zip_path, new_dir = root / DOWNLOAD, root / NEW_DIR
    try:
        # 刚解压完还没玩过就点了更新:先把里面那层解开,不然第一次启动时会拿旧代码盖掉新的
        common.unpack_runtime(root)
        print("  看看有没有新版……")
        source, remote = fetch_manifest(local["sources"], _get)
        what = decide(local, remote)
        if what == "latest":
            print(f"  已经是最新版了({local['version']})。")
            return 0
        print(f"  有新版:{remote['version']}")
        if what == "full":
            print(
                "\n  这次更新换了游戏的运行环境,要重新下载整合包:\n"
                f"    {source['page']}\n"
                "  下好解压以后,把这个文件夹里的 AnimaBackend\\data 整个拷到新文件夹的同一个位置,\n"
                "  角色卡、存档就都在了。"
            )
            webbrowser.open(source["page"])
            return 0
        others = [s for s in local["sources"] if s is not source]
        download_any([source, *others], remote["update"], zip_path)
        print("  解压、换文件……")
        shutil.rmtree(new_dir, ignore_errors=True)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(new_dir)
        apply_update(root, new_dir / "AnimaVN", UPDATE_ITEMS)
        print(f"\n  更新好了:{local['version']} → {remote['version']}。双击 AnimaVN.bat 开始玩。")
        return 0
    except UpdateError as e:
        print(f"\n  更新没成功:{e}\n  游戏还是原来的版本,存档没动。")
        return 1
    finally:
        zip_path.unlink(missing_ok=True)
        shutil.rmtree(new_dir, ignore_errors=True)
        common.release(lock)


if __name__ == "__main__":
    sys.exit(main())
