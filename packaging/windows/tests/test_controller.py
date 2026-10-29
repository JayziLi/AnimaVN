import itertools
import json

import pytest

import controller
from layout import Layout

HEALTH = {"/api/health": "backend", "/debug.html": "web"}


class FakeProc:
    made: list["FakeProc"] = []
    codes: dict[str, int] = {}  # 跑完就退出的(build)退出码
    dead: set[str] = set()  # 一开就死的
    lines: list[str] = []

    def __init__(self, name, cmd, cwd, env=None, visible=False, log_file=None):
        self.name, self.cmd, self.visible = name, cmd, visible
        self.started = self.stopped = False
        FakeProc.made.append(self)

    def start(self):
        self.started = True

    def wait(self, timeout=None):
        return FakeProc.codes.get(self.name, 0)

    def alive(self):
        return self.started and not self.stopped and self.name not in FakeProc.dead

    def stop(self):
        self.stopped = True

    def tail(self, n=500):
        return [f"{self.name} 开着", *FakeProc.lines]


@pytest.fixture(autouse=True)
def _reset():
    FakeProc.made, FakeProc.codes, FakeProc.dead, FakeProc.lines = [], {}, set(), []


def make(tmp_path, kind="repo", already=(), busy=(), settings=None, clock=None):
    if settings:
        (tmp_path / "AnimaBackend" / "data").mkdir(parents=True, exist_ok=True)
        (tmp_path / "AnimaBackend" / "data" / "launcher.json").write_text(json.dumps(settings), "utf-8")

    def answers(url):
        if any(url.startswith(a) for a in already):
            return True
        name = next((n for k, n in HEALTH.items() if url.endswith(k)), None)
        return any(p.name == name and p.alive() for p in FakeProc.made)

    lay = Layout(kind, tmp_path, tmp_path / "python.exe", tmp_path / "launcher")
    return controller.Controller(lay, spawn=FakeProc, answers=answers, port_free=lambda p: p not in busy,
                               pick_port=lambda p: next(x for x in itertools.count(p) if x not in busy),
                               lan_ip=lambda: "192.168.1.5", tailscale_ip=lambda: "100.101.1.2", sleep=lambda s: None,
                               clock=clock or itertools.count(0, 0.5).__next__)


def test_source_build_mode_builds_starts_both_and_is_ready(tmp_path):
    l = make(tmp_path)
    l.boot()
    assert l.phase == "ready", l.message
    assert [p.name for p in FakeProc.made] == ["build", "backend", "web"]
    assert l.game_url() == "http://localhost:5180/debug.html?play=1"
    assert l.lan_url() == "http://192.168.1.5:5180/debug.html?play=1"
    assert l.tailscale_url() == "http://100.101.1.2:5180/debug.html?play=1"
    assert l.base() == "http://127.0.0.1:8000"


def test_a_backend_already_on_8000_is_reused(tmp_path):
    l = make(tmp_path, already={"http://127.0.0.1:8000"})
    l.boot()
    assert l.phase == "ready" and "backend" in l.reused
    assert [p.name for p in FakeProc.made] == ["build", "web"]


def test_busy_port_without_a_backend_fails_with_a_hint(tmp_path):
    l = make(tmp_path, busy={8000})
    l.boot()
    assert l.phase == "failed" and "8000" in l.message and FakeProc.made == []


def test_failed_build_stops_there(tmp_path):
    FakeProc.codes["build"] = 1
    l = make(tmp_path)
    l.boot()
    assert l.phase == "failed" and "打包游戏页面" in l.message
    assert [p.name for p in FakeProc.made] == ["build"]


def test_backend_that_dies_is_reported(tmp_path):
    FakeProc.dead.add("backend")
    l = make(tmp_path)
    l.boot()
    assert l.phase == "failed" and "后端没起来" in l.message


def test_waiting_too_long_fails(tmp_path):
    l = make(tmp_path, clock=itertools.count(0, 50).__next__)  # 每问一次时间过去 50 秒
    l._answers = lambda url: False
    l.boot()
    assert l.phase == "failed" and "等了很久" in l.message


def test_portable_picks_a_free_port(tmp_path):
    l = make(tmp_path, kind="portable", busy={8000})
    l.boot()
    assert l.phase == "ready" and l.base() == "http://127.0.0.1:8001"
    assert [p.name for p in FakeProc.made] == ["backend"]
    assert l.game_url() == "http://localhost:8001/debug.html?play=1"


def test_terminal_setting_shows_only_the_backend_window(tmp_path):
    l = make(tmp_path, settings={"terminal": True})
    l.boot()
    shown = {p.name: p.visible for p in FakeProc.made}
    assert shown == {"build": False, "backend": True, "web": False}


def test_settings_are_read_again_on_restart(tmp_path):
    l = make(tmp_path)
    l.boot()
    assert l.snapshot()["booted"]["lan"] is True
    (tmp_path / "AnimaBackend" / "data").mkdir(parents=True, exist_ok=True)
    (tmp_path / "AnimaBackend" / "data" / "launcher.json").write_text(json.dumps({"lan": False}), "utf-8")
    l.restart()
    snap = l.snapshot()
    assert snap["booted"]["lan"] is False and snap["lan_url"] is None
    assert "--host" not in next(p for p in FakeProc.made[3:] if p.name == "web").cmd


def test_stop_all_stops_what_we_started(tmp_path):
    l = make(tmp_path)
    l.boot()
    l.stop_all()
    assert l.phase == "stopped" and all(p.stopped for p in FakeProc.made if p.name != "build")


def test_snapshot_lists_logs_and_hints(tmp_path):
    FakeProc.lines = ["POST /api/debug/stream 401 Unauthorized"]
    l = make(tmp_path)
    l.boot()
    snap = l.snapshot()
    assert [x["name"] for x in snap["logs"]] == ["build", "backend", "web"]
    assert snap["logs"][1]["label"] == "后端" and snap["kind"] == "repo"
    assert snap["hints"] and "API key" in snap["hints"][0]
    assert snap["base"] == "http://127.0.0.1:8000" and snap["game_url"].endswith("?play=1")
    assert l.logs("backend")[0] == "backend 开着"
