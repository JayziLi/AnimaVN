import diagnose


def test_known_errors_are_explained_newest_first():
    lines = [
        "21:00:00  INFO started",
        "21:01:00  POST /api/debug/stream 401 · Authentication Fails",
        "21:02:00  OSError: [WinError 10048] 通常每个套接字地址只允许使用一次",
    ]
    out = diagnose.hints(lines)
    assert out[0].startswith("端口被别的程序占着") and "API key" in out[1]


def test_each_problem_is_said_once():
    assert len(diagnose.hints(["401 Unauthorized"] * 5)) == 1


def test_missing_module_names_the_module():
    assert "qrcode" in diagnose.hints(["ModuleNotFoundError: No module named 'qrcode'"])[0]


def test_unknown_lines_say_nothing():
    assert diagnose.hints(["GET /api/health 200", "一切正常"]) == []
