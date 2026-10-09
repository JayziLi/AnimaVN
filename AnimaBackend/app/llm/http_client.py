import httpx

from app.tts.http import _ssl_context


def make_http_client() -> httpx.AsyncClient:
    """Honors HTTP(S)_PROXY for remote hosts, but never proxies loopback
    addresses — otherwise local services (Ollama, LM Studio) break when a
    system proxy like Clash is running.

    A client is built per request, and httpx reloads the CA bundle for every
    transport/client it builds (0.3–4 s on this machine, synchronously, on the
    event loop) — so all of them share one cached SSL context, like TTS does.
    """
    verify = _ssl_context()
    no_proxy = httpx.AsyncHTTPTransport(verify=verify)
    return httpx.AsyncClient(
        verify=verify,
        mounts={
            "all://127.0.0.1": no_proxy,
            "all://localhost": no_proxy,
            "all://[::1]": no_proxy,
        },
    )
