import pytest

import layout


def _touch(p):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"")


def test_detects_the_portable_package(tmp_path):
    _touch(tmp_path / "python" / "python.exe")
    (tmp_path / "launcher").mkdir()
    lay = layout.detect(tmp_path / "launcher")
    assert lay.kind == "portable" and lay.root == tmp_path.resolve()
    assert lay.data == tmp_path.resolve() / "AnimaBackend" / "data"
    assert lay.settings_file == lay.data / "launcher.json" and lay.logs == lay.data / "logs"


def test_detects_the_source_folder(tmp_path):
    lau = tmp_path / "packaging" / "windows" / "payload" / "launcher"
    lau.mkdir(parents=True)
    _touch(tmp_path / "AnimaBackend" / ".venv" / "Scripts" / "python.exe")
    (tmp_path / "frontend").mkdir()
    lay = layout.detect(lau)
    assert lay.kind == "repo" and lay.root == tmp_path.resolve()
    assert lay.python == tmp_path.resolve() / "AnimaBackend" / ".venv" / "Scripts" / "python.exe"
    assert lay.frontend == tmp_path.resolve() / "frontend"


def test_unknown_place_raises(tmp_path):
    (tmp_path / "x" / "launcher").mkdir(parents=True)
    with pytest.raises(RuntimeError):
        layout.detect(tmp_path / "x" / "launcher")
