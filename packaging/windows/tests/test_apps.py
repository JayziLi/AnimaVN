import os

import apps
import host
from layout import Layout


def lay(tmp_path):
    return Layout("repo", tmp_path, tmp_path / "python.exe", tmp_path / "launcher")


class FakeCtl:
    restarted = False

    def snapshot(self):
        return {"phase": "ready", "game_url": "http://localhost:5180/debug.html?play=1"}

    def logs(self, name):
        return [f"{name} 的输出"]

    def restart(self):
        FakeCtl.restarted = True


def test_running_needs_the_same_process_and_start_time(tmp_path):
    l = lay(tmp_path)
    assert apps.running(l, "game") is False  # 没有 pid 文件
    apps.mark_running(l, "game")
    assert apps.running(l, "game") is True  # 就是这个测试进程
    pid = os.getpid()
    (apps.run_dir(l) / "game.pid").write_text(f"{pid} 12345", "utf-8")  # 号码一样、开机时间不一样 = 号码被别人用了
    assert apps.running(l, "game") is False
    assert apps.running(l, "game", start_time=lambda p: 12345) is True


def test_host_client_talks_to_the_host_server(tmp_path):
    l = lay(tmp_path)
    client = apps.Host(l)
    assert client.snapshot() is None and client.logs("backend") == [] and client.restart() is False  # 后台还没开
    srv = host.serve(FakeCtl(), apps.run_dir(l) / "host.port")
    try:
        assert client.snapshot()["phase"] == "ready"
        assert client.logs("backend") == ["backend 的输出"]
        assert client.restart() is True
    finally:
        srv.shutdown()
    assert client.snapshot() is None  # 端口文件是关掉的那个留下的


def test_ensure_host_only_starts_one(tmp_path):
    started = []
    assert apps.ensure_host(lay(tmp_path), is_running=lambda *a: False, start=lambda l, s: started.append(s)) is True
    assert apps.ensure_host(lay(tmp_path), is_running=lambda *a: True, start=lambda l, s: started.append(s)) is False
    assert started == ["host.py"]


def test_host_waits_out_the_grace_then_leaves_when_alone():
    ticks = []
    host.wait_until_alone(lambda: False, sleep=ticks.append, grace=5, idle_limit=2)
    assert len(ticks) == 5  # 开头 5 秒不收工


def test_host_stays_while_anyone_is_there():
    seen = iter([True] * 30 + [False] * 10)
    ticks = []
    host.wait_until_alone(lambda: next(seen), sleep=ticks.append, grace=3, idle_limit=4)
    assert len(ticks) == 34  # 有人在的 30 秒一直留着,都走了再等 4 秒


def test_webview_profiles_are_separate_per_program(tmp_path):
    l = lay(tmp_path)
    assert apps.webview_profile(l, "launcher") != apps.webview_profile(l, "game")
    assert apps.webview_profile(l, "launcher").name.startswith("webview-")
