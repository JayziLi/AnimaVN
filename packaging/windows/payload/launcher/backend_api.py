"""启动器问后端要的东西:接着上次是哪段对话、语音服务器通没通。

后端没起来、出错都不抛:接着上次返回 None,语音服务器返回空列表(界面照样能画)。
"""

from __future__ import annotations

import net

KIND = {"gpt_sovits": "GPT-SoVITS", "indextts": "IndexTTS-2.5"}  # 游戏里「插件 → 语音服务」的叫法


def last_play(base: str, get_json=net.get_json, get_text=net.get_text) -> dict | None:
    """最近更新的那段对话(后端按更新时间倒序给)是哪张卡;头像是 data URL,没有就空串"""
    try:
        chats = get_json(f"{base}/api/debug/chats")
    except net.BackendError:
        return None
    chat = next((c for c in chats if c.get("card_id")), None)
    if chat is None:
        return None
    try:
        avatar = get_text(f"{base}/api/tavern/cards/{chat['card_id']}/avatar")
    except net.BackendError:
        avatar = ""  # 这张卡没头像(404)
    return {"card_id": chat["card_id"], "card_name": chat.get("card_name") or "", "chat_name": chat.get("name") or "",
            "avatar": avatar if avatar.startswith("data:image/") else ""}


def voice_servers(base: str, get_json=net.get_json, post_json=net.post_json) -> list[dict]:
    """游戏里接的每台语音服务器,挨个测一下通没通(后端的「测试」按钮同一个接口)"""
    try:
        conns = get_json(f"{base}/api/tts/connections")
    except net.BackendError:
        return []
    out = []
    for c in conns:
        row = {"id": c["id"], "name": c.get("name") or "", "kind": KIND.get(c.get("api_type"), c.get("api_type") or ""),
               "url": c.get("base_url") or "", "voices": c.get("profile_count", 0), "ok": False, "ms": None, "error": ""}
        try:
            row["ms"] = post_json(f"{base}/api/tts/connections/{c['id']}/test", timeout=8)["ms"]
            row["ok"] = True
        except net.BackendError as e:
            row["error"] = str(e)
        out.append(row)
    return out
