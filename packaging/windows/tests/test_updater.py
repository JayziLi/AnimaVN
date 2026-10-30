import hashlib
import shutil

import pytest

import update


def _manifest(version, runtime="rt-1"):
    return {"version": version, "runtime": runtime, "update": {}, "full": {}}


# ---- 要不要更新 ----

def test_same_version_is_latest():
    assert update.decide({"version": "2026.10.17", "runtime": "rt-1"}, _manifest("2026.10.17")) == "latest"


def test_older_remote_is_latest():
    # 魔搭和 GitHub 有一边还没传完新版时,别把人「更新」回旧版
    assert update.decide({"version": "2026.10.17.2", "runtime": "rt-1"}, _manifest("2026.10.17")) == "latest"


def test_newer_code_same_runtime_is_small_update():
    assert update.decide({"version": "2026.10.17", "runtime": "rt-1"}, _manifest("2026.10.20")) == "update"


def test_runtime_change_needs_full_package():
    assert update.decide({"version": "2026.10.17", "runtime": "rt-1"}, _manifest("2026.10.20", "rt-2")) == "full"


def test_two_digit_day_sorts_after_one_digit():
    assert update.decide({"version": "2026.10.9", "runtime": "rt-1"}, _manifest("2026.10.17")) == "update"


# ---- 从哪下 ----

SOURCES = [
    {"name": "魔搭", "base": "https://ms.example/AnimaVN/", "page": "https://ms.example/page"},
    {"name": "GitHub", "base": "https://gh.example/download/", "page": "https://gh.example/page"},
]


def test_manifest_falls_back_to_next_source():
    asked = []

    def get(url):
        asked.append(url)
        if url.startswith("https://ms.example"):
            raise OSError("连不上")
        return b'{"version": "2026.10.20", "runtime": "rt-1"}'

    source, manifest = update.fetch_manifest(SOURCES, get)
    assert source["name"] == "GitHub"
    assert manifest["version"] == "2026.10.20"
    assert asked == ["https://ms.example/AnimaVN/latest.json", "https://gh.example/download/latest.json"]


def test_manifest_error_lists_every_source():
    def get(url):
        raise OSError("timed out")

    with pytest.raises(update.UpdateError) as e:
        update.fetch_manifest(SOURCES, get)
    assert "魔搭" in str(e.value) and "GitHub" in str(e.value)


# ---- 下完的文件对不对 ----

def test_check_file_accepts_right_hash(tmp_path):
    f = tmp_path / "a.zip"
    f.write_bytes(b"hello")
    update.check_file(f, 5, hashlib.sha256(b"hello").hexdigest())


def test_check_file_rejects_wrong_hash(tmp_path):
    f = tmp_path / "a.zip"
    f.write_bytes(b"hellO")
    with pytest.raises(update.UpdateError):
        update.check_file(f, 5, hashlib.sha256(b"hello").hexdigest())


def test_check_file_rejects_short_download(tmp_path):
    f = tmp_path / "a.zip"
    f.write_bytes(b"hell")
    with pytest.raises(update.UpdateError):
        update.check_file(f, 5, hashlib.sha256(b"hell").hexdigest())


# ---- 换代码 ----

def _game(root, tag):
    (root / "AnimaBackend" / "app").mkdir(parents=True)
    (root / "AnimaBackend" / "app" / "main.py").write_text(tag)
    (root / "web").mkdir()
    (root / "web" / "debug.html").write_text(tag)
    (root / "launcher").mkdir()
    (root / "launcher" / "version.json").write_text(tag)
    (root / "AnimaVN.bat").write_text(tag)
    return root


ITEMS = ["AnimaBackend/app", "web", "launcher", "AnimaVN.bat"]
MARKER = {
    "AnimaBackend/app": "AnimaBackend/app/main.py",
    "web": "web/debug.html",
    "launcher": "launcher/version.json",
    "AnimaVN.bat": "AnimaVN.bat",
}


def test_apply_update_replaces_code_and_keeps_saves(tmp_path):
    root = _game(tmp_path / "AnimaVN", "old")
    (root / "AnimaBackend" / "app" / "removed_in_new.py").write_text("old")
    data = root / "AnimaBackend" / "data"
    data.mkdir()
    (data / "animabackend.db").write_text("存档")
    new = _game(tmp_path / "new" / "AnimaVN", "new")

    update.apply_update(root, new, ITEMS)

    assert (root / "AnimaBackend" / "app" / "main.py").read_text() == "new"
    assert not (root / "AnimaBackend" / "app" / "removed_in_new.py").exists()  # 旧版删掉的文件别留着
    assert (root / "web" / "debug.html").read_text() == "new"
    assert (root / "AnimaVN.bat").read_text() == "new"
    assert (data / "animabackend.db").read_text() == "存档"
    assert not (root / update.OLD_DIR).exists()


def test_apply_update_rolls_back_when_a_move_fails(tmp_path):
    root = _game(tmp_path / "AnimaVN", "old")
    new = _game(tmp_path / "new" / "AnimaVN", "new")
    calls = []

    def flaky_move(src, dst):
        calls.append(src)
        if len(calls) == 4:  # 换到第二样(web)放新版时出错
            raise PermissionError("文件被占用")
        return shutil.move(src, dst)

    with pytest.raises(update.UpdateError):
        update.apply_update(root, new, ITEMS, move=flaky_move)

    for item in ITEMS:
        assert (root / MARKER[item]).read_text() == "old", item
    assert not (root / update.OLD_DIR).exists()


def test_apply_update_refuses_incomplete_package(tmp_path):
    root = _game(tmp_path / "AnimaVN", "old")
    new = tmp_path / "new" / "AnimaVN"
    (new / "web").mkdir(parents=True)

    with pytest.raises(update.UpdateError):
        update.apply_update(root, new, ITEMS)
    assert (root / "AnimaBackend" / "app" / "main.py").read_text() == "old"


def test_update_refuses_while_the_launchers_background_still_runs(tmp_path, monkeypatch):
    # 启动器关了、游戏还开着:后台(host.py)拿着 run/host.lock,后端在跑,不能换文件
    import common

    data = tmp_path / "AnimaBackend" / "data"
    monkeypatch.setattr(common, "ROOT", tmp_path)
    monkeypatch.setattr(common, "DATA", data)
    monkeypatch.setattr(common, "LOCK", data / "launcher.lock")
    monkeypatch.setattr(common, "VERSION_FILE", tmp_path / "version.json")
    (tmp_path / "version.json").write_text('{"version": "2026.10.17", "sources": []}', "utf-8")
    host = common.try_lock(data / "run" / "host.lock")
    try:
        assert update.main() == 1
    finally:
        common.release(host)
    # 放开了以后更新器自己拿得到两把锁(这里没有下载源,走到查新版那一步就停)
    assert common.try_lock(data / "launcher.lock") is not None
