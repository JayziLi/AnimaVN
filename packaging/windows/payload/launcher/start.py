"""双击 AnimaVN.bat 跑的就是这个:一个端口同时给游戏页面和后端,起来以后自动开浏览器。

    python\\python.exe launcher\\start.py [--no-browser]

已经开着一个(另一个黑窗口)就不再起第二个后端 —— 两个后端同时写一份存档会出事 —— 直接把浏览器指过去。
"""

import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
from net import answers, lan_ip, pick_port  # noqa: E402,F401  (test_launcher 还从 start 拿 pick_port)

MIGRATING_FLAG = common.DATA / "animabackend.db.migrating"  # 后端升级数据库时留的(app/migrations)


def wait_then_open(port: int, open_browser: bool, started: float, owner: bool = True) -> None:
    url = f"http://localhost:{port}/debug.html"
    said_migrating = False
    next_ping = time.time() + 15
    while time.time() - started < 1800:
        if answers(f"http://127.0.0.1:{port}/api/health"):
            print(f"\n  好了({time.time() - started:.0f} 秒)。游戏地址:{url}")
            ip = lan_ip()
            if ip:
                print(f"  手机连同一个 Wi-Fi,浏览器打开 http://{ip}:{port}/debug.html")
            if owner:
                print("  玩完关掉这个黑窗口就是退出。\n", flush=True)
            if open_browser:
                webbrowser.open(url)
            return
        if not said_migrating and MIGRATING_FLAG.exists():
            print("  正在升级存档,存档大的话要几分钟,别关窗口……", flush=True)
            said_migrating = True
        elif owner and time.time() > next_ping:  # 隔一会儿说一声,别让人以为卡住了
            print(f"  还在准备……({time.time() - started:.0f} 秒)", flush=True)
            next_ping = time.time() + 15
        time.sleep(0.5)
    print("  等了半个小时还没起来,看看上面有没有报错。", flush=True)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    open_browser = "--no-browser" not in argv
    started = time.time()
    version = common.read_json(common.VERSION_FILE).get("version", "?")
    print(f"AnimaVN {version}\n")

    lock = common.try_lock(common.LOCK)
    if lock is None:
        print("  AnimaVN 已经开着了(另一个黑窗口),直接打开游戏页面。")
        try:
            port = int(common.PORT_FILE.read_text().strip())
        except (OSError, ValueError):
            print("  另一个黑窗口还在准备(第一次启动要解压),等它好了会自己打开浏览器。")
            return 1
        wait_then_open(port, open_browser, started, owner=False)
        return 0

    try:
        first_run = common.unpack_runtime()
        port = pick_port()
        common.PORT_FILE.write_text(str(port))
        # 第一次:Windows 要把 numpy、音频、数据库这些库的文件挨个过一遍,一两分钟;以后十几秒
        print("  正在启动" + (",第一次要一两分钟……" if first_run else "……"), flush=True)
        threading.Thread(target=wait_then_open, args=(port, open_browser, started), daemon=True).start()
        import server

        server.serve("0.0.0.0", port, log_level="warning")
    except Exception:
        traceback.print_exc()
        print("\n  启动失败了。把这个窗口截图发给作者,或者到 GitHub 提 issue。")
        return 1
    finally:
        common.release(lock)
    return 0


if __name__ == "__main__":
    sys.exit(main())
