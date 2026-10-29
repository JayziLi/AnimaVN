"""控制台里认得的几种常见报错,翻成大白话(疑难解答)。只认有把握的,认不出就不说。"""

from __future__ import annotations

import re

RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b401\b.*(authentication|unauthorized|api.?key)|invalid.?api.?key", re.I),
     "AI 接口说 API key 不对（401）。到游戏里「模型」页重新填一下 key，或者换一个接口。"),
    (re.compile(r"\b402\b|insufficient.?(balance|quota)|余额不足", re.I),
     "AI 接口说余额不够了。到接口那边充值，或者在游戏「模型」页换一个接口。"),
    (re.compile(r"address already in use|10048|only one usage of each socket address|每个套接字地址只允许使用一次", re.I),
     "端口被别的程序占着。关掉以前开的 start.bat / play.bat 黑窗口，或者到设置里换一个端口。"),
    (re.compile(r"proxyerror|cannot connect to proxy|unable to connect to proxy", re.I),
     "请求走了代理，但代理没开。把代理软件打开，或者关掉系统里的代理设置。"),
    (re.compile(r"No module named '([\w.]+)'"),
     "缺了 Python 依赖 {0}。在 AnimaBackend 文件夹里运行 .venv\\Scripts\\pip install -e .[launcher] 补上。"),
    (re.compile(r"'(npx|npm)' 不是内部或外部命令|'(npx|npm)' is not recognized", re.I),
     "这台电脑没装 Node.js（源码文件夹的游戏页面要用）。装好 Node.js 以后再点「重试」。"),
]


def hints(lines: list[str], limit: int = 3) -> list[str]:
    """从新到旧看日志,每种问题只说一次,最多 limit 条"""
    out: list[str] = []
    for line in reversed(lines):
        for pat, text in RULES:
            m = pat.search(line)
            if m:
                msg = text.format(*[g for g in m.groups() if g])
                if msg not in out:
                    out.append(msg)
        if len(out) >= limit:
            break
    return out[:limit]
