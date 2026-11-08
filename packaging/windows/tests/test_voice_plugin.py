import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build  # noqa: E402

REPO = Path(__file__).resolve().parents[3]


def test_the_real_plugin_folder_has_everything_the_package_lists():
    folder = REPO / "tools" / "voice-helper"
    for name in build.VOICE_PLUGIN_FILES:
        assert (folder / name).is_file(), name
    assert (folder / "install" / "install.ps1").is_file()


def test_only_listed_files_go_in_and_the_bat_uses_crlf(tmp_path):
    src = tmp_path / "src"
    folder = src / "tools" / "voice-helper"
    (folder / "install").mkdir(parents=True)
    for name in build.VOICE_PLUGIN_FILES:
        (folder / name).write_text("x")
    (folder / "restore-gsv-script-20261017.bat").write_text("mine")
    (folder / "install" / "install.ps1").write_text("y")
    (folder / "install" / "go.bat").write_bytes(b"@echo off\npause\n")
    dest = tmp_path / "stage" / build.VOICE_PLUGIN
    build.voice_plugin(src, dest)
    assert sorted(p.name for p in dest.iterdir()) == sorted([*build.VOICE_PLUGIN_FILES, "install"])
    assert (dest / "install" / "go.bat").read_bytes() == b"@echo off\r\npause\r\n"
    assert (dest / "install" / "install.ps1").read_text() == "y"
