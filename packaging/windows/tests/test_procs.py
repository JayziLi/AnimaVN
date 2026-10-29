import sys
import time

import procs

PY = sys.executable


def test_output_is_collected_without_colors_and_logged(tmp_path):
    log = tmp_path / "logs" / "t.log"
    p = procs.Proc("t", [PY, "-c", "print('你好'); print('\\x1b[32mgreen\\x1b[0m')"], tmp_path, log_file=log)
    p.start()
    assert p.wait(30) == 0
    text = "\n".join(p.tail())
    assert "你好" in text and "green" in text and "\x1b" not in text
    assert "你好" in log.read_text("utf-8")


def test_exit_code_comes_back(tmp_path):
    p = procs.Proc("t", [PY, "-c", "import sys; print('坏了'); sys.exit(3)"], tmp_path)
    p.start()
    assert p.wait(30) == 3
    assert any("坏了" in line for line in p.tail())


def test_stop_ends_the_process_and_its_children(tmp_path):
    code = "import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); time.sleep(60)"
    p = procs.Proc("t", [PY, "-c", code], tmp_path)
    p.start()
    time.sleep(1)
    assert p.alive()
    p.stop()
    assert not p.alive()


def test_big_log_file_is_rotated(tmp_path):
    log = tmp_path / "t.log"
    log.write_text("x" * 2_100_000, "utf-8")
    p = procs.Proc("t", [PY, "-c", "print(1)"], tmp_path, log_file=log)
    p.start()
    p.wait(30)
    assert log.stat().st_size < 10_000 and (tmp_path / "t.old.log").exists()
