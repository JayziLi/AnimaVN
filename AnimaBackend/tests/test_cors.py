from fastapi.testclient import TestClient


def allowed(client: TestClient, origin: str) -> bool:
    r = client.get("/api/health", headers={"Origin": origin})
    return r.headers.get("access-control-allow-origin") == origin


def test_phone_can_reach_dev_server_over_lan_or_tailscale(client: TestClient):
    # 手机打开 http://<电脑的地址>:5173,前端就连同一个地址的 :8000,源就是那个地址
    for origin in [
        "http://localhost:5173",
        "http://192.168.1.4:5173",
        "http://10.141.3.7:5173",
        "http://192.168.1.20:5173",
        # Tailscale 分的地址(100.64.0.0/10):带出门时手机走这个
        "http://100.64.0.1:5173",
        "http://100.101.102.103:5173",
        "http://100.127.255.254:5173",
    ]:
        assert allowed(client, origin), origin

    for origin in [
        "http://100.63.0.1:5173",  # 不在 Tailscale 段里
        "http://100.128.0.1:5173",
        "http://8.8.8.8:5173",
        "http://100.101.102.103:3000",  # 只放行前端开发服务器、游玩版的端口
        "http://localhost:3000",
    ]:
        assert not allowed(client, origin), origin


def test_play_build_port_is_allowed_like_the_dev_server(client: TestClient):
    # play.bat 把打包好的前端开在 :5180,和开发服务器(:5173)能同时开着
    for origin in [
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://192.168.1.4:5180",
        "http://100.101.102.103:5180",
    ]:
        assert allowed(client, origin), origin
