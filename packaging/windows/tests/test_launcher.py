import importlib
import socket
import zipfile

import pytest

import common
import start


def test_unpack_runtime_extracts_then_removes_the_zip(tmp_path):
    with zipfile.ZipFile(tmp_path / common.RUNTIME_ZIP, "w") as z:
        z.writestr("python/Lib/site-packages/fastapi/__init__.py", "x")
        z.writestr("web/debug.html", "页面")
    assert common.unpack_runtime(tmp_path) is True
    assert (tmp_path / "web" / "debug.html").read_text("utf-8") == "页面"
    assert (tmp_path / "python" / "Lib" / "site-packages" / "fastapi" / "__init__.py").exists()
    assert not (tmp_path / common.RUNTIME_ZIP).exists()


def test_modules_unpacked_after_startup_can_be_imported(tmp_path, monkeypatch):
    # 启动时 site-packages 还不存在,Python 会把这个目录记成「没有」;解完要让它重新找
    site = tmp_path / "python" / "Lib" / "site-packages"
    monkeypatch.syspath_prepend(str(site))
    with pytest.raises(ImportError):
        importlib.import_module("anima_unpacked_probe")
    with zipfile.ZipFile(tmp_path / common.RUNTIME_ZIP, "w") as z:
        z.writestr("python/Lib/site-packages/anima_unpacked_probe.py", "OK = 1")

    common.unpack_runtime(tmp_path)

    assert importlib.import_module("anima_unpacked_probe").OK == 1


def test_unpack_runtime_does_nothing_once_unpacked(tmp_path):
    assert common.unpack_runtime(tmp_path) is False


def test_second_lock_holder_is_refused(tmp_path):
    first = common.try_lock(tmp_path / "launcher.lock")
    assert first is not None
    assert common.try_lock(tmp_path / "launcher.lock") is None
    common.release(first)
    again = common.try_lock(tmp_path / "launcher.lock")
    assert again is not None
    common.release(again)


def test_pick_port_skips_a_busy_port():
    with socket.socket() as busy:
        busy.bind(("0.0.0.0", 0))
        busy.listen()
        taken = busy.getsockname()[1]
        assert start.pick_port(taken, tries=5) > taken


def test_pick_port_prefers_the_first_free_one():
    with socket.socket() as probe:
        probe.bind(("0.0.0.0", 0))
        port = probe.getsockname()[1]
    assert start.pick_port(port, tries=5) == port


import server  # noqa: E402


def test_server_args_default_to_lan_on_8000():
    a = server.parse_args([])
    assert (a.host, a.port) == ("0.0.0.0", 8000)
    a = server.parse_args(["--host", "127.0.0.1", "--port", "8003"])
    assert (a.host, a.port) == ("127.0.0.1", 8003)


def test_unpack_only_unpacks_then_lets_the_bat_open_the_launcher(tmp_path, monkeypatch):
    # AnimaVN.bat 先解开 runtime.zip(启动器的窗口库在里面),再开启动器
    monkeypatch.setattr(common, "ROOT", tmp_path)
    monkeypatch.setattr(common, "LOCK", tmp_path / "AnimaBackend" / "data" / "launcher.lock")
    with zipfile.ZipFile(tmp_path / common.RUNTIME_ZIP, "w") as z:
        z.writestr("web/debug.html", "页面")
    assert start.main(["--unpack-only"]) == 0
    assert (tmp_path / "web" / "debug.html").exists()
    assert not (tmp_path / common.RUNTIME_ZIP).exists()
    # 解过了:不拿锁,直接放行(启动器开着、锁被它拿着时再双击也一样)
    held = common.try_lock(common.LOCK)
    try:
        assert start.main(["--unpack-only"]) == 0
    finally:
        common.release(held)


def test_unpack_only_waits_for_another_window_that_is_unpacking(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "ROOT", tmp_path)
    monkeypatch.setattr(common, "LOCK", tmp_path / "AnimaBackend" / "data" / "launcher.lock")
    with zipfile.ZipFile(tmp_path / common.RUNTIME_ZIP, "w") as z:
        z.writestr("web/debug.html", "页面")
    held = common.try_lock(common.LOCK)
    try:
        assert start.main(["--unpack-only"]) == 1
    finally:
        common.release(held)
    assert (tmp_path / common.RUNTIME_ZIP).exists()
