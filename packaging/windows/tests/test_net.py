import socket

import pytest

import net


def test_answers_only_when_something_answers(fake_backend):
    assert net.answers(fake_backend + "/ok") is True
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        closed = s.getsockname()[1]
    assert net.answers(f"http://127.0.0.1:{closed}/") is False


def test_get_and_post_json(fake_backend):
    assert net.get_json(fake_backend + "/ok") == {"a": 1}
    assert net.get_text(fake_backend + "/text") == "data:image/png;base64,AAA"
    assert net.post_json(fake_backend + "/x", {"b": 2}) == {"got": {"b": 2}}


def test_backend_error_carries_the_detail(fake_backend):
    with pytest.raises(net.BackendError, match="这张卡没有头像"):
        net.get_json(fake_backend + "/nope")


def test_unreachable_backend_is_a_backend_error():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        closed = s.getsockname()[1]
    with pytest.raises(net.BackendError, match="连不上"):
        net.get_json(f"http://127.0.0.1:{closed}/ok", timeout=2)


def test_pick_port_skips_a_busy_one():
    with socket.socket() as busy:
        busy.bind(("0.0.0.0", 0))
        busy.listen()
        taken = busy.getsockname()[1]
        assert net.port_free(taken) is False
        assert net.pick_port(taken, tries=5) > taken


def test_qr_svg_is_an_svg_path():
    out = net.qr_svg("http://192.168.1.23:8000/debug.html")
    assert out.startswith("<svg") and 'd="M' in out


def test_tailscale_ip_picks_the_100_64_range():
    assert net.tailscale_ip(["192.168.2.180", "100.101.102.103", "192.168.1.20"]) == "100.101.102.103"
    assert net.tailscale_ip(["100.63.1.1", "100.128.0.1", "10.0.0.2"]) is None
