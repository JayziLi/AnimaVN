"""启动器(gui.App)怎么拼后台的状态、开游戏、改设置。后台和游戏都是假的,不开窗口"""

import json

import pytest

import apps
import gui
import settings as S
from layout import Layout


class FakeHost:
    def __init__(self, snap=None):
        self.snap = snap
        self.restarted = 0

    def snapshot(self):
        return self.snap

    def logs(self, name):
        return []

    def restart(self):
        self.restarted += 1
        return self.snap is not None


READY = {"phase": "ready", "message": "", "booted": S.Settings().__dict__, "base": "http://127.0.0.1:8000",
         "game_url": "http://localhost:5180/debug.html?play=1", "lan_url": "http://192.168.1.5:5180/debug.html?play=1",
         "tailscale_url": "http://100.101.1.2:5180/debug.html?play=1",
         "logs": [], "hints": []}


@pytest.fixture
def world(tmp_path, monkeypatch):
    """假的三个程序:running 看这个集合,spawn / send 记下来"""
    lay = Layout("repo", tmp_path, tmp_path / "python.exe", tmp_path / "launcher")
    alive: set[str] = set()
    spawned: list[str] = []
    sent: list[str] = []
    monkeypatch.setattr(apps, "running", lambda l, name, **k: name in alive)
    monkeypatch.setattr(apps, "spawn", lambda l, script, *a: spawned.append(script))
    monkeypatch.setattr(gui.single, "send", lambda path, cmd: sent.append(cmd) or True)
    monkeypatch.setattr(gui.single, "poke", lambda path: sent.append("show") or True)
    monkeypatch.setattr(gui.webbrowser, "open", lambda url: sent.append(f"browser {url}"))
    monkeypatch.setattr(apps, "version_of", lambda l: "测试")

    class W:
        pass

    w = W()
    w.lay, w.alive, w.spawned, w.sent = lay, alive, spawned, sent
    return w


def make(world, snap=READY, clock=None):
    app = gui.App(world.lay, host=FakeHost(snap), clock=clock or (lambda: 0))

    class Main:
        minimized = destroyed = False

        def minimize(self):
            Main.minimized = True

        def destroy(self):
            Main.destroyed = True

    app._main = Main()
    return app


def test_snapshot_passes_on_the_host_state(world):
    snap = make(world).snapshot()
    assert snap["phase"] == "ready" and snap["game_url"].endswith("?play=1") and snap["restart_needed"] is False
    assert snap["game_open"] is False
    world.alive.add("game")
    assert make(world).snapshot()["game_open"] is True


def test_no_host_yet_means_starting_and_no_game_url(world):
    snap = make(world, snap=None).snapshot()
    assert snap["phase"] == "starting" and snap["game_url"] is None and snap["lan_url"] is None


def test_host_that_never_comes_up_is_called_again_then_reported(world):
    t = [0]
    app = make(world, snap=None, clock=lambda: t[0])
    for t[0] in (20, 40, 60):
        app.snapshot()
    assert world.spawned == ["host.py", "host.py"]  # 开启动器时叫过一次,又叫了两次
    t[0] = 80
    assert app.snapshot()["phase"] == "failed"


def test_changed_restart_setting_asks_for_restart(world):
    app = make(world)
    app.set_setting("fullscreen_start", True)
    assert app.snapshot()["restart_needed"] is False
    app.set_setting("lan", False)
    assert app.snapshot()["restart_needed"] is True
    saved = json.loads(world.lay.settings_file.read_text("utf-8"))
    assert saved["lan"] is False and saved["fullscreen_start"] is True
    with pytest.raises(ValueError):
        app.set_setting("port", 1)


def test_display_change_reaches_an_open_game(world):
    app = make(world)
    app.set_setting("game_display", "window")
    assert world.sent == []  # 游戏没开:只存
    world.alive.add("game")
    app.set_setting("game_size", "1280x720")
    assert world.sent == ["display"]


def test_start_opens_the_browser_unless_fullscreen_is_ticked(world):
    app = make(world)
    r = app.start_game()
    assert r["ok"] is True and r["message"] and world.sent == [f"browser {READY['game_url']}"] and world.spawned == []


def test_fullscreen_start_opens_the_game_program_fullscreen_or_brings_it_forward(world):
    app = make(world)
    app.set_setting("fullscreen_start", True)
    app.set_setting("game_display", "window")  # 上次在游戏里改成了窗口
    assert app.start_game()["ok"] is True and world.spawned == ["game.py"]
    assert S.load(world.lay.settings_file).game_display == "fullscreen"
    world.alive.add("game")
    app.start_game()
    assert world.spawned == ["game.py"] and world.sent == ["show"]


def test_back_to_game_brings_the_window_forward_even_without_the_tick(world):
    app = make(world)
    world.alive.add("game")
    app.start_game()
    assert world.sent == ["show"] and world.spawned == []


def test_start_before_ready_says_wait(world):
    r = make(world, snap={**READY, "phase": "starting"}).start_game()
    assert r["ok"] is False and world.spawned == []


def test_after_start_choices_and_the_gear_opens_the_other_way(world):
    app = make(world)
    app.set_setting("after_start", "minimize")
    app.start_game()
    assert world.sent == [f"browser {READY['game_url']}"] and app._main.minimized and world.spawned == []
    app.set_setting("after_start", "stay")
    app.open_other()  # 齿轮:没勾全屏启动,反过来开全屏的游戏窗口
    assert world.spawned == ["game.py"]
    app.set_setting("fullscreen_start", True)
    app.open_other()  # 勾着:反过来开浏览器
    assert world.sent[-1] == f"browser {READY['game_url']}" and world.spawned == ["game.py"]


def test_qr_for_wifi_or_tailscale(world):
    app = make(world)
    assert app.qr()["url"] == READY["lan_url"] and "<svg" in app.qr()["svg"]
    assert app.qr("tailscale")["url"] == READY["tailscale_url"]
    assert make(world, snap={**READY, "phase": "starting"}).qr("tailscale") == {"url": None, "svg": ""}
