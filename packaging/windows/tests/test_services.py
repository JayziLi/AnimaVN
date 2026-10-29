import layout
import services
from settings import Settings


def _lay(kind, root):
    if kind == "portable":
        return layout.Layout("portable", root, root / "python" / "python.exe", root / "launcher")
    return layout.Layout("repo", root, root / "AnimaBackend" / ".venv" / "Scripts" / "python.exe",
                         root / "packaging" / "windows" / "payload" / "launcher")


def test_portable_runs_one_server_on_the_picked_port(tmp_path):
    plan = services.make_plan(_lay("portable", tmp_path), Settings(), 8003)
    [backend] = plan.services
    assert plan.prepare == []
    assert backend.cmd[1].endswith("server.py") and backend.cmd[-4:] == ["--host", "0.0.0.0", "--port", "8003"]
    assert backend.health == "http://127.0.0.1:8003/api/health"
    assert plan.game_url() == "http://localhost:8003/debug.html?play=1"
    assert plan.lan_url("192.168.1.5") == "http://192.168.1.5:8003/debug.html?play=1"


def test_source_build_mode_builds_then_previews(tmp_path):
    plan = services.make_plan(_lay("repo", tmp_path), Settings(dev_mode="build"), 8000)
    assert [s.name for s in plan.prepare] == ["build"]
    assert [s.name for s in plan.services] == ["backend", "web"]
    backend, web = plan.services
    assert backend.cmd[1:4] == ["-m", "uvicorn", "app.main:app"] and backend.cwd == tmp_path / "AnimaBackend"
    assert "preview" in web.cmd and "--host" in web.cmd and web.health == "http://localhost:5180/debug.html"
    assert plan.game_url() == "http://localhost:5180/debug.html?play=1"
    assert plan.prepare[0].env == {} and web.env == {}


def test_source_dev_mode_runs_the_dev_server(tmp_path):
    plan = services.make_plan(_lay("repo", tmp_path), Settings(dev_mode="dev"), 8000)
    assert plan.prepare == [] and plan.page_port == 5173 and "dev" in plan.services[1].cmd


def test_lan_off_keeps_everything_on_this_computer(tmp_path):
    plan = services.make_plan(_lay("repo", tmp_path), Settings(lan=False), 8000)
    assert "127.0.0.1" in plan.services[0].cmd and "--host" not in plan.services[1].cmd
    assert plan.lan_url("192.168.1.5") is None


def test_backend_on_another_port_tells_the_page(tmp_path):
    plan = services.make_plan(_lay("repo", tmp_path), Settings(port=8016), 8016)
    assert plan.prepare[0].env == {"VITE_API_PORT": "8016"} and plan.services[1].env == {"VITE_API_PORT": "8016"}
