import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build  # noqa: E402


def _site(tmp_path):
    site = tmp_path / "site-packages"
    pkg = site / "fakesdk"
    (pkg / "_decoders").mkdir(parents=True)  # 没有 __init__.py 的子目录(anthropic._decoders 就是这样)
    (pkg / "__init__.py").write_text("from ._decoders.jsonl import VALUE\n")
    (pkg / "_decoders" / "jsonl.py").write_text("VALUE = 42\n")
    (pkg / "lib").mkdir()
    (pkg / "lib" / ".keep").write_text("")
    native = site / "nativepkg"
    native.mkdir()
    (native / "__init__.py").write_text("")
    (native / "_speedups.pyd").write_bytes(b"MZ")
    (site / "fakesdk-1.0.dist-info").mkdir()
    (site / "fakesdk-1.0.dist-info" / "METADATA").write_text("Name: fakesdk\nVersion: 1.0\n")
    return site


def test_pure_packages_move_into_the_zip(tmp_path):
    site = _site(tmp_path)
    zipped = build.zip_pure_packages(site, tmp_path / "site-packages.zip")
    assert zipped == ["fakesdk"]
    assert not (site / "fakesdk").exists()
    assert (site / "nativepkg").exists()  # 带 .pyd 的留在文件夹里
    assert (site / "fakesdk-1.0.dist-info").exists()  # 版本号还在文件夹里找


def test_subfolder_without_init_imports_from_the_zip(tmp_path):
    site = _site(tmp_path)
    archive = tmp_path / "site-packages.zip"
    build.zip_pure_packages(site, archive)
    out = subprocess.run(
        [sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(archive)!r}); import fakesdk; print(fakesdk.VALUE)"],
        capture_output=True, text=True,
    )
    assert out.stdout.strip() == "42", out.stderr
