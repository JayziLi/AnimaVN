import backend_api
import net


def test_last_play_picks_the_newest_chat_that_has_a_card():
    chats = [{"id": "c0", "card_id": None, "card_name": None, "name": "空"},
             {"id": "c1", "card_id": "k1", "card_name": "星绘", "name": "夜路"}]

    def get_json(url):
        assert url == "http://b/api/debug/chats"
        return chats

    def get_text(url):
        assert url == "http://b/api/tavern/cards/k1/avatar"
        return "data:image/png;base64,AAA"

    assert backend_api.last_play("http://b", get_json, get_text) == {
        "card_id": "k1", "card_name": "星绘", "chat_name": "夜路", "avatar": "data:image/png;base64,AAA"}


def test_last_play_without_avatar_or_without_backend():
    def no_avatar(url):
        raise net.BackendError("这张卡没有头像")

    got = backend_api.last_play("http://b", lambda url: [{"card_id": "k", "card_name": "A", "name": "x"}], no_avatar)
    assert got["avatar"] == ""

    def down(url):
        raise net.BackendError("连不上")

    assert backend_api.last_play("http://b", down, down) is None
    assert backend_api.last_play("http://b", lambda url: [], down) is None


def test_voice_servers_tests_each_connection():
    conns = [{"id": "a", "name": "台式机", "api_type": "gpt_sovits", "base_url": "http://x:9880", "profile_count": 3},
             {"id": "b", "name": "IndexTTS", "api_type": "indextts", "base_url": "http://x:9890", "profile_count": 0}]

    def post_json(url, body=None, timeout=10.0):
        if "/a/" in url:
            return {"ms": 42}
        raise net.BackendError("连不上语音服务")

    out = backend_api.voice_servers("http://b", lambda url: conns, post_json)
    assert [(r["kind"], r["ok"], r["ms"], r["error"]) for r in out] == [
        ("GPT-SoVITS", True, 42, ""), ("IndexTTS-2.5", False, None, "连不上语音服务")]
    assert out[0]["voices"] == 3 and out[0]["url"] == "http://x:9880"


def test_voice_servers_without_backend_is_empty():
    def down(url):
        raise net.BackendError("连不上")

    assert backend_api.voice_servers("http://b", down, down) == []
