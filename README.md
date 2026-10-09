<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/wordmark-light.png">
  <img src="docs/images/wordmark-dark.png" alt="AnimaVN" width="420">
</picture>

**把酒馆角色卡变成一部会说话的视觉小说**

AI 写剧情，立绘、背景、BGM 跟着剧情换，角色用自己的声音念台词。<br>
SillyTavern 的角色卡、世界书、预设直接导入，不用改。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)
![Node 22+](https://img.shields.io/badge/node-22.12%2B-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-SQLite-009688?logo=fastapi&logoColor=white)
![SillyTavern 卡](https://img.shields.io/badge/SillyTavern-%E8%A7%92%E8%89%B2%E5%8D%A1%20%2F%20%E4%B8%96%E7%95%8C%E4%B9%A6%20%2F%20%E9%A2%84%E8%AE%BE-8A2BE2)

[在线试玩](https://animavn.com) ·
[快速开始](#-快速开始) ·
[酒馆兼容](#-酒馆角色卡直接用) ·
[语音部署](#-语音配音部署gpt-sovits) ·
[常见问题](#-常见问题)

<img src="docs/images/title.webp" alt="AnimaVN 标题画面" width="100%">

</div>

## 这是什么

AnimaVN 是一个跑在浏览器里的 AI 视觉小说。你拿一张角色卡进来，和她自由聊天，回复不是一大段文字，而是像 galgame 一样一句一句演出来：

- 立绘站在中间，**每句台词换对应的表情**
- AI 觉得该换地方了就换**背景**，气氛变了就换 **BGM**
- 角色用 **GPT-SoVITS 训练的声音念台词**，可以日语配音 + 中文字幕
- 底部对话框点一下下一句，**读到一半随时插话**，存档、读档、回看历史都有
- 装好就自带一个角色 **DeepSeek娘**（16 个表情立绘、世界书都配好了），填上 API 就能玩

它的提示词部分照着 SillyTavern（酒馆）做：**酒馆的角色卡、卡里的世界书、Chat Completion 预设、宏、人设、聊天记录都能直接导入**，组出来的请求和酒馆 1.18 逐条对过答案。你在酒馆里调好的卡和预设，拿过来就能当视觉小说玩。

> 不想装？先去 **[animavn.com](https://animavn.com)** 在线试玩（试玩版，注册后每天有免费额度，也可以填自己的 API）。

<table>
  <tr>
    <td width="50%"><img src="docs/images/vn-dialogue.webp" alt="对话画面"><br><sub>对话画面：DeepSeek娘在介绍 AnimaVN，上面一行是日语配音的原文</sub></td>
    <td width="50%"><img src="docs/images/character-select.webp" alt="角色选择"><br><sub>选角色：按标签筛选，右上角「导入」直接吃酒馆卡</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/backlog.webp" alt="历史"><br><sub>历史：每句都能重播语音、切换「重来」出的版本</sub></td>
    <td><img src="docs/images/saves.webp" alt="存档"><br><sub>存档：每段对话一格，缩略图是结尾那一幕</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/console.webp" alt="调试台"><br><sub>调试台：左边预设块、中间带标签的原文、右边角色卡，和酒馆一个思路</sub></td>
    <td><img src="docs/images/worldbook.webp" alt="世界书"><br><sub>卡内世界书：每条右边写着下次会不会触发、为什么</sub></td>
  </tr>
</table>

### 🎭 角色展示

DeepSeek娘之外，导入你自己的卡就能玩。下面是作者本机导入的几张卡（这些卡和素材不随仓库分发）：

<table>
  <tr>
    <td width="50%"><img src="docs/images/chars-wikira.webp" alt="Wikira"><br><sub>Wikira：作者的原创角色，日语配音，右上角是语音延迟</sub></td>
    <td width="50%"><img src="docs/images/chars-keqing.webp" alt="刻晴"><br><sub>刻晴（原神）：璃月的夜景和 BGM 跟着剧情换</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/chars-alice.webp" alt="天童爱丽丝"><br><sub>天童爱丽丝（蔚蓝档案）：对话框上方是模型的思考用时，点开能看内容</sub></td>
    <td><img src="docs/images/chars-aemeath.webp" alt="爱弥斯"><br><sub>爱弥斯（鸣潮）：长台词自动换行，日语原文和中文字幕一起显示</sub></td>
  </tr>
</table>

<details>
<summary><b>更多截图</b>（提示词检查器、语音设置、设置、刚装好的样子、手机）</summary>

<br>

| | |
|---|---|
| ![完整提示词](docs/images/prompt-inspector.webp) 完整提示词：发给模型的每一条消息、来源、token 数 | ![设置](docs/images/settings.webp) 设置：文字速度、字幕、自动播放、透明度、字号 |
| ![语音插件](docs/images/voice-plugin.webp) 语音：主声音、试音台、语音服务地址 | ![声音档案](docs/images/voice-profile.webp) 声音档案：权重路径 + 每种情绪一段参考音频 |
| ![新装后的选角色页](docs/images/first-run.webp) 刚装好时的选角色页：只有自带的 DeepSeek娘 | <img src="docs/images/mobile-vn.webp" width="49%"> <img src="docs/images/mobile-select.webp" width="49%"><br>手机竖屏 |

</details>

---

## 目录

- [角色展示](#-角色展示)
- [功能一览](#-功能一览)
- [酒馆角色卡直接用](#-酒馆角色卡直接用)
- [快速开始](#-快速开始)
- [第一次进游戏](#-第一次进游戏)
- [语音配音部署（GPT-SoVITS）](#-语音配音部署gpt-sovits)
- [手机上玩](#-手机上玩)
- [部署到服务器（Docker）](#-部署到服务器docker)
- [项目结构](#-项目结构)
- [常见问题](#-常见问题)
- [致谢与授权](#-致谢与授权)

---

## ✨ 功能一览

### 视觉小说

| 功能 | 说明 |
|---|---|
| 逐句演出 | AI 的回复切成一句一句，点击 / 空格 / 回车下一句，按住 Ctrl 跳过，A 键自动播放 |
| 随时插话 | 读到第 N 句就可以打字。这条回复截到第 N 句继续，完整版作为分支留着 |
| 立绘表情 | AI 在每句台词前写 `<sprite:微笑>`。名字对不上时，后端用一个 25 MB 的本地小模型（bge-small-zh，CPU 就能跑）挑最像的那张 |
| 立绘自动对齐 | 上传立绘时自动找脸，不同来源的图脸一样大、头在同一高度 |
| 切换特效 | 每张立绘可以单独配动作（跳一下、抖一下……）、头顶气泡和音效 |
| 场景包 | 一组背景 + BGM。AI 写 `<bg:客厅夜>`、`<bgm:日常>` 切换，背景可以带默认曲子 |
| CG | 事件插图，像背景一样切换，可以带差分 |
| 日语配音 + 中文字幕 | AI 一行日语、一行中文交替写，念日语、显示中文（也可以日中双语都显示） |
| 玩家台词 | AI 替你写的台词会弹成 galgame 式的选项，点了才算你说的 |
| 存档 / 分支 | 每段对话就是一个存档，实时保存。在任意一句「在这里存档」= 从这里分叉 |
| 历史 | 回看、重播语音、切换「重来」出的几个版本、看带标签的原文 |
| 设置 | 文字速度、自动播放间隔和倍速、对话框透明度、字号、字体、对话框皮肤、主题色、BGM 在说话时压低 |
| 标题画面 | 选好角色后标题画面换成她的立绘和上次那一幕，几种封面样式可选 |

### 提示词调试台

视觉小说的「后台」，写卡、调预设的人会喜欢：

- 三栏布局：**左边预设块**（拖动排序、开关、改内容）、**中间对话**（带标签的原文、swipe、分叉、编辑）、**右边角色卡编辑**
- **上下文预算条**：预设、角色卡、世界书、历史各占多少 token，超了从哪截
- **完整提示词**：发给模型的每一条消息、来自哪个块、多少 token；被跳过的块和原因；每条世界书触发 / 没触发的原因
- **思考过程**：模型的 reasoning 单独显示，视觉小说里显示「正在思考 N 秒」

### 模型连接

- **OpenAI 兼容接口**：DeepSeek、Kimi、GLM、OpenRouter、各种中转站、本地 Ollama / LM Studio / vLLM 都走这个
- **Anthropic（Claude）**：原生接口，自动加 prompt cache
- 流式输出；思考内容（`reasoning_content`、Claude thinking、正文里的 `<think>`）单独拆出来；每个连接可以设思考强度
- 自带一个 Mock 连接，不填 key 也能把界面跑起来

### 可选：Jev 标注

默认由写剧情的模型自己写立绘 / 场景 / 音乐标签。也可以在插件页把某一类切到「Jev 标注」：主模型只管写剧情，每切出一句，交给一个专门做判断的小模型（[TypeSafe](https://typesafe.ai) 的 Jev）判断谁在说话、什么表情、要不要换场景和音乐。每次约 0.2 秒，每条回复约 0.001 美元。不填 Jev 的 key 就照常用 AI 写标签。

---

## 🍺 酒馆角色卡直接用

**你在酒馆里用的东西，基本都能直接拿过来。**

| 酒馆里的东西 | AnimaVN | 说明 |
|---|:---:|---|
| 角色卡 PNG（`chara` / `ccv3`） | ✅ | 点「导入」选文件就行 |
| 角色卡 JSON（V1 / V2 / V3） | ✅ | |
| 卡里的所有字段 | ✅ | `extensions`、第三方扩展字段原样保存；导入再导出，38 张 Chub 样本卡逐字相同 |
| 卡内世界书（`character_book`） | ✅ | 照酒馆 1.18 的 `checkWorldInfo` 移植：主 / 次关键词和四种逻辑、`/正则/`、全词匹配、递归、概率、互斥分组、延迟、预算、8 种插入位置（含指定深度、`{{outlet}}`） |
| 多个开场白（`alternate_greetings`） | ✅ | 开新故事时可以挑 |
| 角色备注（`depth_prompt`）、主提示词 / 历史后指令覆盖 | ✅ | `{{original}}` 也能用 |
| Chat Completion 预设 JSON | ✅ | `prompts` + `prompt_order`、标记块、绝对深度注入、`injection_trigger`、格式串、合并系统消息 |
| 宏 | ✅ | 内置 89 个：`{{char}}` `{{user}}` `{{random}}` `{{pick}}` `{{roll}}` `{{getvar}}` `{{setvar}}` `{{if}}…{{else}}…{{/if}}`、时间、聊天……拿 6000 多段真实文本和酒馆逐字对过 |
| 人设（Persona） | ✅ | 可以建多个，可以绑到卡上 |
| 聊天记录 `.jsonl` | ✅ | 导入 / 导出，分支关系也能还原 |
| 组出来的请求 | ✅ | 真跑酒馆 1.18 抓它发出的请求，5 个预设 × 5 张卡，25 组逐条一致 |
| 卡里的正则脚本 | ⏳ | 会保存、导出时带着，暂时不执行 |
| 预设里的温度等采样参数 | ⏳ | 能看到，暂时不发给模型 |
| 世界书的 sticky / cooldown | ⏳ | 按普通条目处理，界面会提示 |
| 全局世界书、独立世界书文件 | ❌ | 只支持卡内世界书 |
| CHARX、Risu 格式的卡 | ❌ | |
| Text Completion 预设、群聊、代写 | ❌ | |

导出角色卡目前只能导出 JSON（V2 格式），不能写回 PNG。

**怎么导：**

- 角色卡：视觉小说的「角色」页右上角 **＋ 导入**，或者调试台右栏的导入按钮。PNG、JSON 都行
- 预设：调试台左栏的 **导入预设**。勾上「绑定到当前角色卡」，以后选这张卡自动切到这个预设
- 聊天记录：调试台左下角 **对话历史** → 导入 jsonl（可以多选）

立绘、场景、语音这些是 AnimaVN 自己加的，酒馆卡里没有。导入卡以后在插件页给它挂上（见下面[第 5 步](#5-给导入的卡配立绘和场景)），不挂也能玩，只是画面不动。

---

## 🚀 快速开始

### 需要准备

| | 要求 |
|---|---|
| 系统 | Windows 10 / 11（`start.bat` 一键启动）。macOS、Linux 手动起两条命令也能跑 |
| Python | **3.11 或更新**（[下载](https://www.python.org/downloads/)，安装时勾上 *Add python.exe to PATH*） |
| Node.js | **22.12 或更新**（[下载](https://nodejs.org/)，选 LTS） |
| 模型 API | 任意一个：DeepSeek、Claude、OpenAI、OpenRouter、中转站，或者本地 Ollama |
| 语音（可选） | 一台有 NVIDIA 显卡的电脑跑 GPT-SoVITS，可以就是这台。见[语音部署](#-语音配音部署gpt-sovits) |

### Windows：装一次，以后双击

**1. 下载代码**

装了 Git 的话：

```powershell
git clone https://github.com/JayziLi/AnimaVN-public.git AnimaVN
cd AnimaVN
```

没装 Git：在 GitHub 页面点绿色的 **Code → Download ZIP**，解压，在解压出来的文件夹里打开 PowerShell（地址栏输入 `powershell` 回车）。

**2. 装后端**

```powershell
cd AnimaBackend
python -m venv .venv
.venv\Scripts\python -m pip install -e .
.venv\Scripts\python scripts\download_emotion_model.py
cd ..
```

最后一行下载立绘表情匹配用的小模型（约 25 MB，Hugging Face 不通会自动换镜像）。不下也能玩，只是 AI 写的表情名对不上立绘时不会自动找最像的那张。

**3. 装前端**

```powershell
cd frontend
npm install
cd ..
```

**4. 启动**

双击仓库根目录的 **`start.bat`**。它会开两个窗口（后端、前端），等两边都起来后自动打开浏览器：

```
http://localhost:5173/debug.html
```

以后每次玩，直接双击 `start.bat` 就行。关掉那两个黑窗口就是退出。

### macOS / Linux

```bash
git clone https://github.com/JayziLi/AnimaVN-public.git AnimaVN
cd AnimaVN/AnimaBackend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python scripts/download_emotion_model.py
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另开一个终端：

```bash
cd AnimaVN/frontend
npm install
npm run dev
```

然后打开 <http://localhost:5173/debug.html>。

### 升级

```powershell
git pull
cd AnimaBackend; .venv\Scripts\python -m pip install -e .; cd ..
cd frontend; npm install; cd ..
```

启动后看一眼后端窗口：如果有「数据库缺列」的提示，按它说的跑一下 `AnimaBackend\scripts\migrate_*.py`（都可以重复跑），再重启。

> 你的角色卡、预设、存档、立绘全在 `AnimaBackend/data/animabackend.db` 这一个文件里。升级前复制一份，最保险。

---

## 🎮 第一次进游戏

### 1. 填模型 API

打开后在右上角点 **API 设置** → 新建连接：

- **类型**：DeepSeek、OpenRouter、中转站、Ollama 都选「OpenAI 兼容」；Claude 官方接口选「Anthropic」
- **地址**：OpenAI 兼容的地址一般以 `/v1` 结尾，比如 `https://api.deepseek.com/v1`；Ollama 是 `http://127.0.0.1:11434/v1`
- **Key**、**模型名**：填好后点刷新可以拉模型列表，点测试看通不通

### 2. 先和 DeepSeek娘玩一局

点顶栏 **视觉小说** 进标题画面 → **角色**，库里已经有一张自带的 **DeepSeek娘**：住在你家的鲸鱼女仆，本体就是 DeepSeek，爱吃白饭、爱摸鱼、爱「深度思考」。立绘（16 个表情）、世界书、开场白都配好了，点 **开始** 就能玩。

<img src="docs/images/first-run.webp" alt="刚装好时的选角色页" width="720">

### 3. 导入你的酒馆卡

在 **角色** 页右上角点 **＋ 导入**，选你的酒馆卡（PNG / JSON）。

### 4. 选预设

自带的「默认预设」就能跑，世界书和立绘指令都已经放进去了。你有常用的酒馆预设，在调试台左栏 **导入预设**，勾上「绑定到当前角色卡」；导入的预设里没有立绘指令，要在下一步的插件页点一下「加入当前预设」。

### 5. 给导入的卡配立绘和场景

在游戏里按 **Esc** 打开菜单 → **插件**：

- **立绘**：新建立绘包 → **批量上传图片**，**文件名就是表情名**（`微笑.png`、`害羞.png`……），一张卡可以挂好几个包（比如不同衣服），游戏里随时换
- **背景 / BGM**：新建场景包，同样批量上传，文件名就是场景名 / 曲名。横图 16:9 效果最好
- 每一页上面都有 **加入当前预设**：点一下，预设里会多一个标着「插件」的块，AI 就知道有哪些表情、场景可以用

手上没素材？点 **载入示例立绘包** / **载入示例场景包**，先用自带的示例（MIT / CC BY 授权）看看效果。

### 6. 开始

回标题画面点 **新的故事**，挑一个开场白，开始。

操作：点击 / 空格 / 回车下一句 · 按住 Ctrl 跳过 · A 自动播放 · Esc 菜单 · 底部输入框随时插话。

---

## 🎙 语音配音部署（GPT-SoVITS）

语音是可选的。不开语音，其它功能都照常用。

### 它是怎么工作的

```
浏览器 ──> AnimaVN 后端 ──HTTP──> GPT-SoVITS api_v2（9880 端口，在有显卡的电脑上）
                │                         │
                └─ 合成结果缓存在本地库      └─ 模型权重、参考音频都放在这台电脑上
```

- 每句台词的**情绪 = 这句的立绘表情名**。声音里有同名（或别名）的情绪，就用那段参考音频的语气念；对不上就用排第一的
- 旁白和你自己的话不念
- 当前句优先合成，后面的句子排队提前合成；合成过的存进缓存（默认上限 500 MB），回看、重播不重新合成
- 连续失败 3 次会暂停语音，每 15 秒探测一次，语音服务回来了自动恢复

作者自己用 RTX 5090：v4 模型 64 步每句约 1.2 秒，v2ProPlus 每句 0.6–1.0 秒，打游戏占着显卡时会慢很多。显卡差一些的，v3 / v4 可以把采样步数降到 32。

### 第 1 步：装 GPT-SoVITS

到 [GPT-SoVITS 的 Releases](https://github.com/RVC-Boss/GPT-SoVITS/releases) 下载 **Windows 整合包**（自带 Python 环境，解压即用）。RTX 50 系显卡要下带 `nvidia50` 的那个。

解压到一个**路径里没有中文和空格**的地方，比如 `D:\GPT-SoVITS`。

### 第 2 步：准备声音模型

一个声音 = 一个 GPT 权重（`.ckpt`）+ 一个 SoVITS 权重（`.pth`）。

- **用现成的**：社区有不少角色的现成模型（比如 ModelScope 上的 GPT-SoVITS 模型合集）。注意这类模型大多是 CC BY-NC 之类的授权，语音版权归原作，**只能自己玩，不能商用、不能再分发**
- **自己练**：准备 30–60 分钟干净的角色原声，用整合包自带的训练界面（`go-webui.bat`）练。按整合包的教程走就行

### 第 3 步：准备参考音频

GPT-SoVITS 念每一句时要一段「参考音频」，念出来的语气跟着它走。**每种情绪准备一段**：

- 长度 **3–10 秒**（5–10 秒最好，太短会有电子音）
- 文件名写成 **`【情绪】原文.wav`**，原文要和音频里说的**一字不差**
- 情绪名尽量和立绘表情名一样（立绘叫「害羞」，参考也叫「害羞」），这样语气能跟着表情走

建议这样放（路径随意，后面要填）：

```
D:\AnimaVoice\
  models\角色名\        角色名-e10.ckpt、角色名_e8_s696_l32.pth
  refs\角色名\         【微笑】おかえり、今日はどうだった？.wav
                       【害羞】べ、別に待ってたわけじゃないから….wav
                       【生气】もう、知らない！.wav
```

### 第 4 步：启动语音服务

在整合包目录里打开命令行：

```powershell
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS\configs\tts_infer.yaml
```

看到 `Uvicorn running on http://127.0.0.1:9880` 就起来了。浏览器打开 <http://127.0.0.1:9880/docs> 能看到接口页面就对了。可以把这行存成 `start-api.bat`，以后双击启动。

> 第一次合成会比较慢（几十秒，显卡在初始化），之后就快了。AnimaVN 的语音页有「预热」按钮，进游戏前点一下。

**语音服务和 AnimaVN 不在同一台电脑上时**，两种连法，选一种：

- **Tailscale（推荐）**：两台都装 [Tailscale](https://tailscale.com/)、登同一个账号，在显卡那台运行
  `tailscale serve --bg --tcp=9880 tcp://127.0.0.1:9880`，AnimaVN 里地址填 `http://显卡那台的名字.你的tailnet.ts.net:9880`。只有你自己的设备能连，出门用手机流量也能连
- **SSH 隧道**：在跑 AnimaVN 的电脑上 `ssh -N -L 9880:127.0.0.1:9880 用户名@显卡那台的IP`，地址就填 `http://127.0.0.1:9880`

不建议直接用 `-a 0.0.0.0` 把 9880 开到局域网，要开的话记得配防火墙。另外 AnimaVN 后端发往局域网和 Tailscale 地址的请求会自动绕开系统代理，开着 Clash 也没关系（Clash 的 TUN 模式要把 `100.64.0.0/10` 设成直连）。

### 第 5 步：在 AnimaVN 里配上

游戏里 Esc → **插件** → **语音**：

1. **语音服务**：点 **＋ GPT-SoVITS**，地址填 `http://127.0.0.1:9880`（或上面的 Tailscale 地址）。采样步数只对 v3 / v4 模型有用，默认 64，32 更快
2. **新建声音**，两种填法：
   - **手动**：填 GPT 权重和 SoVITS 权重的路径（**是显卡那台电脑上的路径**，比如 `D:/AnimaVoice/models/角色名/角色名-e10.ckpt`）、语言（日语 `ja` / 中文 `zh`），再一行行加情绪：情绪名、别名、参考音频路径、原文
   - **导入 refs.json**：把下面这样一份 JSON 整个贴进去，一次填好。文件名是 `【情绪】原文.wav` 的话，`emotion` 和 `text` 可以省略

     ```json
     {
       "character": "角色名(日语)",
       "gpt_weights": "D:/AnimaVoice/models/角色名/角色名-e10.ckpt",
       "sovits_weights": "D:/AnimaVoice/models/角色名/角色名_e8_s696_l32.pth",
       "refs": [
         { "file": "D:/AnimaVoice/refs/角色名/【微笑】おかえり、今日はどうだった？.wav" },
         { "file": "D:/AnimaVoice/refs/角色名/【害羞】べ、別に待ってたわけじゃないから….wav" },
         { "file": "D:/AnimaVoice/refs/角色名/hello.wav", "emotion": "平静", "text": "参考音频里说的原文" }
       ]
     }
     ```

     排第一的情绪是默认情绪。同名的声音再导入一次会合并（更新路径、补新情绪），不会重复
3. 在页面上面把这个声音设成当前卡的 **主声音**。卡里还有别的角色说话的话，把他们的声音也勾上：台词前写了「名字：」就用对应的声音
4. 用 **试音台** 试听，「每种情绪各念一遍」能一次听完所有情绪

**日语配音 + 中文字幕**：声音的语言设成 `ja`，再到插件的 **外语** 页点「加入当前预设」。AI 会一行日语一行中文地写，念日语、显示中文。

<details>
<summary><b>进阶：合成参数、多参考、IndexTTS</b></summary>

<br>

- **合成参数**（试音台下面「参数」展开）：温度、top_p、top_k、重复惩罚、断句方式（默认按标点 `cut5`）、句间停顿、并行推理、种子、语速。试的时候不影响游戏，点「保存」才生效
- **辅助参考**：一个情绪除了主参考，还能挂最多 8 段同情绪的其它原声，音色取平均会更稳（语气还是跟主参考走）。只对 v2 / v2Pro / v2ProPlus 模型有效
- **按立绘补齐**：声音页可以按当前卡的立绘表情名一键补出情绪行，再挨个填参考
- **IndexTTS-2.5**：也接了，但官方没有 HTTP 接口，要自己包一个小服务（接口约定见 [`docs/superpowers/specs/2026-09-24-indextts-engine-design.md`](docs/superpowers/specs/2026-09-24-indextts-engine-design.md)）。作者试听下来日语不如 GPT-SoVITS，目前主要用 GPT-SoVITS

</details>

<details>
<summary><b>语音排错</b></summary>

<br>

| 现象 | 原因 / 办法 |
|---|---|
| 右上角显示「语音断了」 | 语音服务没开，或者地址不通。浏览器打开 `地址/docs` 看看 |
| `xxx.wav not exists` | 参考音频路径不对。路径是**显卡那台电脑上的**，斜杠用 `/` 或 `\` 都行 |
| `参考音频在3~10秒范围外` | 参考音频太长或太短，剪到 3–10 秒 |
| 念出来有电子音 | 参考太短（3 秒左右）。换 5–10 秒的；v3 / v4 步数别太低 |
| 第一句要等几十秒 | 第一次合成在初始化显卡，正常。进游戏前在语音页点「预热」 |
| 换角色后第一句慢 | 切换模型权重要 2 秒左右，之后就快了 |
| 每句都很慢 | 看显卡是不是被游戏或别的程序（比如 ComfyUI）占满了 |
| 只有某个情绪念错语气 | 检查那一行的原文和音频是否一字不差 |

</details>

---

## 📱 手机上玩

电脑上 `start.bat` 跑着，手机连**同一个 Wi-Fi**，浏览器打开 `http://电脑的局域网IP:5173/debug.html` 就行（电脑的 IP 在命令行 `ipconfig` 里看，一般是 `192.168.x.x`）。第一次 Windows 防火墙可能会问要不要放行 Node / Python，选「专用网络」。

- 横屏、竖屏都能玩，手机上自动用压缩过的图，省流量
- iPhone 用 Safari「分享 → 添加到主屏幕」，安卓用浏览器「添加到主屏幕」，从桌面打开就是全屏、没有地址栏
- 出门想连家里的电脑：电脑和手机都装 Tailscale，地址换成电脑的 Tailscale IP

---

## 🐳 部署到服务器（Docker）

想放在云服务器上随时访问：

```bash
docker run --rm httpd:alpine htpasswd -Bbn 用户名 密码 > deploy/htpasswd
chmod 644 deploy/htpasswd
docker compose up -d --build
```

nginx 提供页面并反代 `/api`，整站一道密码，数据存在 Docker 卷里。语音服务不在 compose 里，要单独在显卡机器上跑。详细步骤、升级和已知限制见 [`deploy/README.md`](deploy/README.md)。

---

## 🗂 项目结构

```
AnimaVN/
├─ start.bat                 Windows 一键启动
├─ AnimaBackend/             后端：Python + FastAPI + SQLAlchemy + SQLite
│  ├─ app/
│  │  ├─ api/                接口：角色卡、预设、对话、立绘包、场景包、声音……
│  │  ├─ llm/                模型连接：OpenAI 兼容、Anthropic、Mock；流式、思考内容
│  │  ├─ tts/                语音引擎：GPT-SoVITS、IndexTTS；缓存
│  │  ├─ emotion/            立绘表情兜底匹配（bge-small-zh ONNX，CPU）
│  │  └─ annotate/           Jev 标注
│  ├─ scripts/               下载情绪模型、数据库迁移、导出 / 导入用户数据
│  ├─ tests/                 pytest（内存库 + Mock 模型，不碰真数据）
│  └─ data/                  animabackend.db（你的所有数据，不进 git）
├─ frontend/                 前端：React + TypeScript + Vite
│  ├─ debug.html             唯一入口：调试台 + 视觉小说
│  └─ src/debug/
│     ├─ lib/                酒馆兼容层：卡解析、预设、宏引擎、世界书、提示词组装
│     ├─ plugins/            立绘、场景、BGM、CG、语音、外语、玩家台词
│     ├─ vn/                 视觉小说界面：标题、对话、存档、历史、设置
│     └─ components/         调试台界面
├─ deploy/                   Docker + nginx
└─ docs/                     设计文档（docs/superpowers/specs）、截图
```

提示词在**浏览器里组装**（和酒馆一样），后端只负责转发给模型、存数据、合成语音。

### 开发和测试

```bash
# 后端测试
cd AnimaBackend
.venv/Scripts/python -m pip install -e ".[test]"
.venv/Scripts/python -m pytest

# 前端测试 / 打包
cd frontend
npm test
npm run build
```

后端测试的约定见 [`AnimaBackend/TESTING.md`](AnimaBackend/TESTING.md)。每个功能的设计和取舍记在 [`docs/superpowers/specs/`](docs/superpowers/specs/)。

---

## ❓ 常见问题

<details>
<summary><b>打开页面是空的 / 一直转圈</b></summary>

看后端那个黑窗口有没有报错，浏览器打开 <http://localhost:8000/api/health> 应该返回 `{"status":"ok"}`。用 `start.bat` 的话它会等两边都起来再开浏览器，90 秒还没起来会提示。

</details>

<details>
<summary><b>连接测试报错 / 返回一个网页</b></summary>

OpenAI 兼容的地址大多要以 `/v1` 结尾。另外检查电脑上有没有设 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量指向一个没开的代理。

</details>

<details>
<summary><b>立绘一直不变</b></summary>

1. 插件页「立绘」里这张卡挂了立绘包吗？
2. 预设里有「立绘指令 · 插件」这个块、并且开着吗？没有就在插件页点「加入当前预设」
3. 在调试台看 AI 的原文，台词前有没有 `<sprite:…>`。有些模型不听话，换个模型或者把立绘切到「Jev 标注」

</details>

<details>
<summary><b>我的卡在酒馆里正常，这里表现不一样</b></summary>

先在调试台点「查看完整提示词」，看看哪些块被跳过、哪些世界书没触发、原因是什么。上面[兼容表](#-酒馆角色卡直接用)里 ⏳ / ❌ 的功能（正则脚本、采样参数、全局世界书……）目前还没做，卡如果依赖它们会不一样。欢迎带着卡开 issue。

</details>

<details>
<summary><b>数据存在哪？怎么备份？</b></summary>

全在 `AnimaBackend/data/animabackend.db`，复制这个文件就是完整备份。也可以用 `AnimaBackend/scripts/export_userdata.py` 导出成一堆纯文本 + 图片音频文件（API key 会被清空），用 `import_userdata.py` 导回去。

</details>

<details>
<summary><b>没有显卡能用语音吗？</b></summary>

GPT-SoVITS 需要 NVIDIA 显卡才快。没有的话先不开语音，其它功能都正常；或者借一台有显卡的电脑跑语音服务，用 Tailscale 连过来。

</details>

---

## 🙏 致谢与授权

- [SillyTavern](https://github.com/SillyTavern/SillyTavern)：角色卡、世界书、预设、宏的规则都照它做，兼容性拿它的真实请求对答案
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)：语音合成
- [LingChat](https://github.com/SlimeBoyOwO/LingChat)：「每句台词前标情绪」的思路参考了它
- [bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)（BAAI，MIT；ONNX 版来自 [Xenova](https://huggingface.co/Xenova/bge-small-zh-v1.5)）：立绘表情兜底匹配
- [lbpcascade_animeface](https://github.com/nagadomi/lbpcascade_animeface)（MIT）：立绘找脸对齐
- 自带角色 DeepSeek娘：形象原型是上善的原创角色[《溟月》](https://www.pixiv.net/users/62155430)，女仆鲸鱼娘设计来自 [ZipZipPipe](https://www.pixiv.net/artworks/148186519)，16 个表情差分由 AnimaVN 在原图上改画。立绘按 **CC BY-NC-SA 4.0**（署名、非商用、相同方式共享）发布，详见 [`AnimaBackend/app/seed_data/deepseek-chan/CREDITS.txt`](AnimaBackend/app/seed_data/deepseek-chan/CREDITS.txt)
- 示例素材：Ren'Py 示例游戏 *The Question* 的立绘和背景（MIT），Kevin MacLeod 的曲子（CC BY 4.0），详见 [`frontend/public/vn/CREDITS.txt`](frontend/public/vn/CREDITS.txt)

**关于截图**：DeepSeek娘的立绘见上面的授权；Wikira 是作者的原创角色；截图里的背景、刻晴、爱丽丝、爱弥斯等角色来自各自的游戏，版权归原作者，只用来展示界面，不随仓库分发。仓库里除了 DeepSeek娘和上面的示例素材，**不带别的角色卡、立绘或声音模型**，请用你自己有权使用的素材。

代码以 [MIT](LICENSE) 协议开源；DeepSeek娘的立绘不在 MIT 范围内，按 CC BY-NC-SA 4.0。
