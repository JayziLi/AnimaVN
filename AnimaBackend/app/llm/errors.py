from http import HTTPStatus


class LLMError(Exception):
    """A provider call failed for a reason the user can act on (bad key, bad URL, ...).

    `message` is user-facing and shown verbatim in the UI.

    `explained` marks a message that says more than the provider's raw error
    does (e.g. the raw one is an HTML page), so callers that normally prefer
    the raw text show this instead.
    """

    def __init__(self, message: str, explained: bool = False):
        super().__init__(message)
        self.message = message
        self.explained = explained


def _upstream_text(body: object) -> str | None:
    """从模型服务返回的错误体里取它自己写的那句话。

    OpenAI 系是 {"error": {"message": ...}}(SDK 已剥掉外层 error),Anthropic 是
    {"type": "error", "error": {"message": ...}},有些中转站直接给 {"error": "..."} 或
    {"message": "..."} / {"detail": "..."};不是 JSON 的就用纯文本(网页不要)。
    """
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, str):
            return inner.strip() or None
        if isinstance(inner, dict):
            for key in ("message", "detail", "msg"):
                value = inner.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        for key in ("message", "detail"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
    if isinstance(body, str):
        text = body.strip()
        if text and not text.startswith("<"):
            return text[:300]
    return None


def status_message(status: int, body: object) -> str:
    """「429 Too Many Requests: Rate limit exceeded」——状态码 + 标准原因短语 + 上游原话。

    上游没说话就只剩前两段;不加任何建议。
    """
    try:
        head = f"{status} {HTTPStatus(status).phrase}"
    except ValueError:
        head = str(status)
    text = _upstream_text(body)
    return f"{head}: {text}" if text else head
