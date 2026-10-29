---
name: install-animavn
description: 在用户电脑上安装、启动、升级 AnimaVN（用 AI 玩视觉小说的开源游戏，能直接导入酒馆 SillyTavern 角色卡，github.com/JayziLi/AnimaVN）。用户说「安装 / 装一下 / 跑起来 / 升级 AnimaVN」「install AnimaVN」，或者给了这个仓库的链接让你装的时候用。
---

# 安装 AnimaVN

做到这一步算完：用户的浏览器打开了 AnimaVN 的游戏页面。

- 用用户的语言跟用户说话
- 只在写了「问用户」的地方停下来问，其余按默认做

## 先选装法

自己看是什么系统。

- **Windows**：问用户只想玩，还是要改代码。只想玩 → A；要改代码 → B
- **macOS / Linux**：直接走 B

## A. 整合包（Windows，不用装 Python 和 Node）

1. 问用户装在哪，默认桌面。别放 `C:\Program Files` 这类要管理员权限的文件夹
2. 读版本信息，先试魔搭（国内快），不通再试 GitHub：
   - `https://www.modelscope.cn/models/JayziLi/AnimaVN/resolve/master/latest.json`
   - `https://github.com/JayziLi/AnimaVN/releases/latest/download/latest.json`
3. 下载整合包：把上面地址里的 `latest.json` 换成 `full.file` 的文件名。约 170 MB，下完用 `full.sha256` 核对
4. 解压，找到 `AnimaVN.bat`，在新窗口里打开：`Start-Process AnimaVN.bat -WorkingDirectory <它所在的文件夹>`。别在你自己的终端里直接跑，它会一直占着
5. 第一次启动要一两分钟，好了会自己打开浏览器。下载的 zip 可以删掉。跳到「装好以后」

已经装过整合包的：关掉游戏的黑窗口，双击 `更新.bat`，存档不动。

## B. 源码

### 1. 检查环境

| 要什么 | 版本 | 查法 |
|---|---|---|
| git | 任意 | `git --version` |
| Python | 3.11 或更新 | `python --version`（macOS / Linux 用 `python3`） |
| Node.js | 22.12 或更新 | `node --version` |

缺了或太旧：告诉用户缺什么，问用户能不能帮装（Windows 用 `winget`，macOS 用 `brew`，Linux 用系统包管理器），不能就给官方下载页。

Windows 上 `python` 打开了微软商店或者没有输出，说明没真装：去 python.org 装，勾上 *Add python.exe to PATH*，装完要新开终端。

### 2. 下载代码

问用户放哪个文件夹，在那里：

```
git clone https://github.com/JayziLi/AnimaVN.git
```

那里已经有 AnimaVN 就别重新 clone，走「升级」。

### 3. 装后端

在 `AnimaVN/AnimaBackend` 里（Windows 写法；macOS / Linux 把开头的 `python` 换成 `python3`，`.venv\Scripts\python` 换成 `.venv/bin/python`）：

```
python -m venv .venv
.venv\Scripts\python -m pip install -e .
.venv\Scripts\python scripts\download_emotion_model.py
```

最后一行下载立绘表情用的小模型（约 25 MB）。失败了也能玩，告诉用户一声就行。

### 4. 装前端

在 `AnimaVN/frontend` 里：`npm install`

### 5. 启动

先访问 `http://127.0.0.1:8000/api/health`。有回应说明这台电脑已经开着一个 AnimaVN，问用户要不要先关掉它，关掉再往下。

- **Windows**：在仓库根目录跑 `play.bat`。它会开两个黑窗口（后端、游戏），两边都起来后打开浏览器。以后每次玩双击它，关掉黑窗口就是退出
- **macOS / Linux**：开两个能一直开着的终端：
  - `cd AnimaBackend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
  - `cd frontend && npx vite build && npx vite preview --port 5180`

  然后打开 `http://localhost:5180/debug.html`。这两条命令也告诉用户，以后自己开

确认 `http://127.0.0.1:8000/api/health` 返回 `{"status":"ok"}`。后端第一次启动会先备份、升级数据库，可能要等一会儿。

### 升级

先关掉后端窗口，在仓库根目录 `git pull`，再把第 3 步的 `pip install -e .` 和第 4 步的 `npm install` 各跑一遍，然后照第 5 步启动。

## 装好以后

告诉用户：

1. 右上角「API 设置」→ 新建连接，填自己的模型 API（DeepSeek、Claude、OpenAI、中转站、本地 Ollama 都行）
2. 顶栏「视觉小说」→「角色」，自带的 DeepSeek娘点「开始」就能玩；酒馆卡（PNG / JSON）在角色页右上角「＋ 导入」
3. 语音、生图是可选的，要的话看 README 里的「语音配音部署」和「AI 生图」

## 别做

- 别动 `AnimaBackend/data`：里面是用户的卡、存档和立绘
- 别问用户要 API key，也别替用户填，让用户在页面上自己填
- 别用 sudo 或管理员权限装 Python 包

## 卡住了

- pip 慢或超时（国内）：加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`
- npm 慢：加 `--registry=https://registry.npmmirror.com`
- git clone 连不上 GitHub：问用户开没开代理；Windows 只想玩的改走 A（魔搭国内能下）
- 能上网却什么都连不上：看看 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量是不是指向一个没开的代理
- 8000 或 5180 端口被别的程序占了：告诉用户是哪个程序，问要不要关掉
- 别的报错：把原文给用户看，建议到 https://github.com/JayziLi/AnimaVN/issues 提问
