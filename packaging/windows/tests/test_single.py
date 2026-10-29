import threading

import single


def test_second_launch_wakes_the_first(tmp_path):
    shown = threading.Event()
    single.serve(tmp_path / "launcher.ipc", {"show": shown.set})
    assert single.poke(tmp_path / "launcher.ipc") is True
    assert shown.wait(5)


def test_commands_go_to_their_own_handler(tmp_path):
    got = []
    done = threading.Event()
    single.serve(tmp_path / "game.ipc", {"show": lambda: got.append("show"),
                                         "display": lambda: (got.append("display"), done.set())})
    assert single.send(tmp_path / "game.ipc", "nope") is True  # 不认识的口令不理,也不断
    assert single.send(tmp_path / "game.ipc", "display") is True
    assert done.wait(5) and got == ["display"]


def test_poke_without_a_running_launcher_is_false(tmp_path):
    assert single.poke(tmp_path / "launcher.ipc") is False
    (tmp_path / "launcher.ipc").write_text("1", "utf-8")  # 留下的旧端口,没人在听
    assert single.poke(tmp_path / "launcher.ipc") is False
