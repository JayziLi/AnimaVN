import json

import pytest

import settings as S


def test_missing_file_gives_defaults(tmp_path):
    assert S.load(tmp_path / "launcher.json") == S.Settings()


def test_broken_json_gives_defaults(tmp_path):
    p = tmp_path / "launcher.json"
    p.write_text("{oops", "utf-8")
    assert S.load(p) == S.Settings()


def test_bad_values_fall_back_one_by_one(tmp_path):
    p = tmp_path / "launcher.json"
    p.write_text(json.dumps({"open_in": "browser", "port": "8000", "lan": 1, "dev_mode": "weird", "auto_start": True}), "utf-8")
    s = S.load(p)
    assert s.open_in == "browser" and s.auto_start is True
    assert s.port == 8000 and s.lan is True and s.dev_mode == "build"


def test_save_then_load_round_trips(tmp_path):
    p = tmp_path / "sub" / "launcher.json"
    s = S.Settings(open_in="browser", terminal=True, port=8123)
    S.save(p, s)
    assert S.load(p) == s


def test_game_window_choices():
    s = S.change(S.Settings(), "game_display", "borderless")
    s = S.change(s, "game_size", "2560x1440")
    assert (s.game_display, s.game_size) == ("borderless", "2560x1440")
    with pytest.raises(ValueError):
        S.change(s, "game_size", "1000x1000")
    assert S.Settings().game_display == "fullscreen"


def test_update_reads_the_file_first(tmp_path):
    p = tmp_path / "launcher.json"
    S.save(p, S.Settings(lan=False))  # 别的程序刚改的
    s = S.update(p, "after_start", "close")
    assert s.lan is False and s.after_start == "close" and S.load(p) == s
    with pytest.raises(ValueError):
        S.update(p, "after_start", "explode")
    assert S.load(p).after_start == "close"


def test_change_validates():
    s = S.change(S.Settings(), "open_in", "browser")
    assert s.open_in == "browser"
    with pytest.raises(ValueError):
        S.change(s, "nope", 1)
    with pytest.raises(ValueError):
        S.change(s, "port", 80)
    with pytest.raises(ValueError):
        S.change(s, "lan", "yes")
