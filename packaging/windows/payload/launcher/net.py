"""本机 / 局域网的小工具:找空端口、局域网地址、问本机的后端(不走代理)、二维码。"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request

# 开着代理(Clash 之类)的电脑上,问 127.0.0.1 也别走代理
NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def port_free(port: int, host: str = "0.0.0.0") -> bool:
    with socket.socket() as s:
        try:
            s.bind((host, port))
        except OSError:
            return False
    return True


def pick_port(start: int = 8000, tries: int = 50) -> int:
    for port in range(start, start + tries):
        if port_free(port):
            return port
    raise RuntimeError(f"{start}–{start + tries - 1} 这些端口都被别的程序占了，关掉一些程序再试")


def lan_ip() -> str | None:
    """这台电脑在局域网里的地址,给手机用。不会真的发包,只是让系统挑出走局域网的那块网卡。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
    except OSError:
        return None
    return None if ip.startswith("127.") else ip


def tailscale_ip(addrs=None) -> str | None:
    """Tailscale 给这台电脑分的地址(100.64.0.0/10)。公寓、宿舍、酒店的 Wi-Fi 常把设备互相隔开,
    同一个 Wi-Fi 下手机也连不到电脑;手机装 Tailscale、登同一个账号,走这个地址就行(用户 10-23 碰到)"""
    if addrs is None:
        try:
            addrs = [a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
        except OSError:
            return None
    for ip in addrs:
        a, b = (int(x) for x in ip.split(".")[:2])
        if a == 100 and 64 <= b <= 127:
            return ip
    return None


def answers(url: str, timeout: float = 2.0) -> bool:
    try:
        with NO_PROXY.open(url, timeout=timeout) as r:
            return 200 <= r.status < 400
    except Exception:
        return False


class BackendError(Exception):
    """后端回了错误(message = 它给的 detail),或者根本连不上"""


def _call(req, timeout: float) -> bytes:
    try:
        with NO_PROXY.open(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            detail = json.loads(body).get("detail")
        except (ValueError, AttributeError):
            detail = None
        raise BackendError(str(detail or f"{e.code} {e.reason}")) from None
    except (urllib.error.URLError, OSError) as e:
        raise BackendError(f"连不上：{getattr(e, 'reason', e)}") from None


def get_json(url: str, timeout: float = 5.0):
    return json.loads(_call(url, timeout))


def get_text(url: str, timeout: float = 5.0) -> str:
    return _call(url, timeout).decode("utf-8")


def post_json(url: str, body=None, timeout: float = 10.0):
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    return json.loads(_call(req, timeout) or b"null")


def qr_svg(text: str) -> str:
    """二维码 svg(深色方块、透明底),手机扫码玩用"""
    import qrcode

    q = qrcode.QRCode(border=0, error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(text)
    q.make(fit=True)
    m = q.get_matrix()
    d = "".join(f"M{x} {y}h1v1h-1z" for y, row in enumerate(m) for x, on in enumerate(row) if on)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {len(m)} {len(m)}" shape-rendering="crispEdges">'
            f'<path fill="#1e1e26" d="{d}"/></svg>')
