# AI 生图：接本地 SD 和中转

2026-11-07。状态：用户 11-07 同意（含「ComfyUI 玩家这期接不进来」的代价）；同日又定了只做个人版、不分瑟瑟和普通。第 1 份（后端骨架）和第 2 份（前端）11-08 做完，这一期只有 NovelAI 能真出图；库副本上实测通过，真库等用户确认后再升级。第 3–6 份（本地 SD、中转、高级提示词、延迟和文档）还没写。

很多玩家反映 AnimaVN 只能用 NovelAI 出图。用户的 5 条要求（原话）：

1. 角色卡 / 链接之间设置隔离，不全局设置，但这个设置也不进 animavn 的角色包
2. 不同模型之间不同选项尽量少，如人物外观什么的共用
3. 可测试是否出图
4. 优化延迟优先
5. 玩家自定义两边模型的高级提示词选项

## 已定和待确认

- **隔离（用户选 A）**：地址和 key 只填一次，放进连接列表，每张卡自己选用哪条。同一张卡换连接时，参数各存一份。新卡第一次打开时抄一份上次用的设置，抄完互不影响。
- **范围（11-07 用户）**：
  - 中转站，支持大多数出图接口
  - NovelAI 官方
  - 本地 SD
- **不碰工作流（11-07 用户）**：「我们不做，让玩家自己打包成接口连接我们的软件」。AnimaVN 只认两种标准接口：A1111 接口和 OpenAI 兼容接口。用别的软件（包括 ComfyUI）的玩家，自己包成这两种之一再接进来。
- **LoRA 按卡快捷切换**（11-07 用户问的）：只在 A1111 接口的连接上有，见第 5 节。
- **待确认**：
  - 「链接」按「画图连接」理解
  - 「两边模型」按「指导模型 + 画图模型」理解。如果指的是 NovelAI 和其他模型，本方案也覆盖。
- **只做个人版（11-07 用户）**：「暂时只做对个人的支持吧」，GitHub 版暂时不再更新公网方面的支持。公网站不开，也不为它预留开关（第 10 节）。
- **界面（11-07 用户看了效果图说「设计的没问题」）**：效果图在 claude.ai/artifact/X8XDzHkK1Wbku1tBVYaFzQ。两处 A / B 用户没挑，按推荐定：加连接弹小窗（B），画面页选连接用下拉（A）。指导模型留在连接页（不放「高级」）；连接卡片小字写「类型 · 地址」，不写模型（模型是每张卡在每条连接下各存一份）。
- **画图大小玩家自定义（11-07 用户）**：尺寸那一行所有连接都一样，预设加自定义宽高，存在这张卡的外层设置里，换连接不变。发出去时各家按自己的规矩对齐，见第 6 节和第 11 节。
- **不分瑟瑟和普通（11-07 用户）**：「只画全年龄」这期不做，不进角色包，新连接也不为它加处理。卡上原来的开关和 NovelAI 换 Curated 模型照现在的代码不动。

## 1. 现状

`app/plugins/imagegen` 的拼提示词和角色外观本来就和 NovelAI 没多大关系，写死的是这几处：

- `api.py` 的 `generate`、`/account`、`/defaults`、`/token`
- `schemas.py` 的 `GenerateIn`
- 前端 `config.ts` 的全局 `ImageGenConfig`，`ImageGenSettings.tsx` 的「画面」「服务」页

另外三处和这次有关：

- `plugin.imagegen` 的按卡设置现在会进角色包：`bundle/collect.py:712` 起，只要键以 `plugin.` 开头就导出。
- `nai.py:118` 是整个进程共用一把锁。NovelAI 同一个账号本来就只能同时画一张（多发会回 429 `Concurrent generation is locked`），个人版一般只有一个账号，所以这把锁不改。它只锁 NovelAI，不挡本地 SD 和中转。
- `llm/http_client.py` 只对本机地址不走代理。局域网、Tailscale 上的出图服务要改用 `tts/http.py:22` 的 `is_direct_host`，不然开着 Clash 时连不上。

## 2. 画图连接

新表 `ImageConnection`，放在 `plugins/imagegen/models.py`，由 `create_all` 建：

| 字段 | 说明 |
|---|---|
| `id`、`name` | |
| `kind` | `novelai` / `sdapi`（A1111 接口）/ `openai`（中转和其他 OpenAI 兼容的） |
| `base_url` | NovelAI 留空用官方地址 |
| `api_key` | 只写不读，接口只回 `has_key` |
| `options` | JSON，每种类型自己的少量选项 |

规则：

- **改地址时 key 要重填。** 本地版没有登录，同一 Wi-Fi 的人也能调接口。如果改地址时保留旧 key，别人就能把 key 骗到自己的服务器上。
- **环境变量 `NOVELAI_TOKEN` 继续优先**：NovelAI 连接的 key 为空时用它。
- **删连接后**，用这条连接的卡下次打开时提示重选；只剩一条连接时自动用那条。

每种类型只多出自己必需的设置：

| 加连接时选 | 玩家填 | 选模型 | 连接选项（都收在「更多」） |
|---|---|---|---|
| 中转站 | 地址、key | 下拉（来自 `/v1/models`），也能手填 | 接口（自动 / 图片 / 聊天 / Gemini）、可用尺寸、额外参数（JSON） |
| NovelAI | token | 下拉（现有列表） | 无 |
| 本地 SD | 地址（可选填 `用户:密码`）；「找一找」会试本机 7860 端口 | 下拉（来自 `/sdapi/v1/sd-models`，拿不到就不显示） | 无 |

## 3. 按卡设置

| 存在哪 | 内容 | 进角色包 |
|---|---|---|
| 卡的 `plugin.imagegen` | 角色名、长相、衣服、性别、不想要的、参考图选择 | 进 |
| 卡的 `imagegen.setup`（新） | 其余所有设置 | 不进（键不带 `plugin.` 前缀） |
| 全局 `imagegen.last`（新） | 上次改动的那份 `imagegen.setup`，只用来给新卡抄，界面上看不到 | 不进 |
| 全局 `plugin.imagegen`（旧） | 只留画风库；旧字段只在升级时读一次 | |

「不想要的」写的是角色长相（比如不要长发），也算外观。「只画全年龄」还留在卡的 `plugin.imagegen` 里，但不随包走（11-07 用户：现在不分瑟瑟和普通）。

`imagegen.setup` 的结构：

```json
{
  "conn": "连接编号",
  "styleId": "fuzi_rella", "artists": "",
  "size": "screen", "res": "wide", "custom": {"w": 1344, "h": 768}, "seed": null,
  "holdLines": 3, "place": "above",
  "auto": {"enabled": true, "cooldown": 3}, "camera": "pov", "player": {},
  "writer": {"connectionId": null, "thinking": "off"},
  "byConn": {
    "连接编号": {
      "model": "",
      "steps": 23, "scale": 7, "sampler": "", "noise": "", "rescale": 0, "variety": false,
      "quality": "standard", "ucPreset": "light", "uc": "", "allowPaid": false,
      "loras": [],
      "promptStyle": "nai", "template": null, "skills": {}
    }
  }
}
```

- 外层是这张卡所有连接共用的，`byConn` 是这张卡在每条连接下各自的一份。版本专属字段照旧用 `@private` 夹住。
- `loras`：`[{name, weight, on, trigger}]`，只有本地 SD 连接用得上（第 5 节）。
- `skills` 只存改过的说明书，没改的用默认。
- `copy_card_prefs`、`delete_card_prefs` 已经会带上新键，不用改。
- `collect.py` 的 `_imagegen_pref` 改成白名单，`canon.py` 也走同一个函数。不然老字段还会被带出去，内容比对也对不上。

**第一次升级**：第一次读 setup、`imagegen.last` 还不存在时做，一个事务做完。

1. 有 `secret.novelai_token` 就建一条 NovelAI 连接，把 token 搬进去、删掉旧的。只有环境变量时也建一条，key 留空。
2. 用旧的全局设置拼一份 setup。
3. 给所有已有的卡各写一份，并把这张卡旧的 `styleId`、`artists`、`autoOff` 搬进它自己那份。
4. 写 `imagegen.last`。

验收：升级前后，同一张卡、同一幅画面发给 NovelAI 的请求体逐字节相同。

**以后的新卡**：抄 `imagegen.last`。导入的老角色包如果带 `styleId` 这些字段，就盖在抄来的那份上，然后从 `plugin.imagegen` 删掉。

## 4. 后端接口

```
plugins/imagegen/backends/
  base.py      Job、Result(bytes, mime, timing)、BackendError(原文)、CharPrompt
  novelai.py   包一层现有 nai.py
  sdapi.py     A1111 接口
  openai.py    中转的三种接口
```

每个后端实现 `check()`、`options()`、`generate(job, on_preview)`，并声明能力：

| | NovelAI | 本地 SD（A1111 接口） | 中转 / OpenAI 兼容 |
|---|---|---|---|
| 分角色提示词 | 有 | 拼成一段 | 拼成一段 |
| 反向提示词 | 有 | 有 | **不发** |
| 种子 | 有 | 有 | 无 |
| LoRA | 无 | 有 | 无 |
| 参考图 | V4.5 | 这期不做 | 有 |
| 过程预览 | 无 | 服务端开了就有 | 无 |

- `assemble.py` 不再 import `nai`。`CharPrompt` 搬到 `base.py`，「只画全年龄时换 Curated 模型」搬进 NovelAI 后端。
- **保护词：** `ADULT_GUARD`、`SFW_GUARD` 由代码加在反向提示词末尾，模板改不掉。
- **保护词有两种情况不起作用：**
  - 中转没有反向参数。也不把这些词塞进正面提示词，那样可能被内容审核直接拒绝。
  - Flux 这类模型不吃反向提示词。
- **只画全年龄：** 这期不管。拼提示词时对它的处理照旧，只有 NovelAI 会换 Curated 模型。

## 5. 本地 SD：A1111 接口 + LoRA

**认哪些软件**：只认 A1111 接口，也就是 `/sdapi/v1/txt2img`。A1111、Forge 开了 API 都是这个接口；Krita 插件作者说 SD.Next 也兼容（转述，没实测）。其他软件 AnimaVN 不直接接，玩家照接口说明自己包一层：

- ComfyUI 没有自带这种接口。11-07 搜了两次，也没找到现成的包装工具。用 ComfyUI 的玩家要自己写，或者等社区做。
- 接口说明写成 `docs/plugins/image-gen-api.md`，只写下面这张表和返回格式，给想自己包的人看。

| 请求 | 用途 | 包装时必须实现吗 |
|---|---|---|
| `POST /sdapi/v1/txt2img` | 出图。发 `prompt`、`negative_prompt`、`width`、`height`、`seed`、`steps`、`cfg_scale`、`sampler_name`，选了才发 `scheduler` 和 `override_settings.sd_model_checkpoint`；固定发 `batch_size: 1`、`send_images: true`、`save_images: false`、`override_settings_restore_afterwards: false`。回 `{"images": ["base64"]}`，PNG / JPEG / WebP 都行 | 必须，最少要认 `prompt` |
| `GET /sdapi/v1/sd-models` | 模型下拉；顺便当「查连接」 | 可选 |
| `GET /sdapi/v1/samplers`、`/schedulers` | 采样器下拉 | 可选 |
| `GET /sdapi/v1/loras`、`POST /sdapi/v1/refresh-loras` | LoRA 列表 | 可选 |
| `GET /sdapi/v1/progress` | 过程预览（`current_image`） | 可选 |

- 可选的请求拿不到（404）时，界面上就不显示对应那一项，照样能画。
- `override_settings_restore_afterwards: false` 让 WebUI 画完不换回原来的模型，下一张不用重新加载。

**LoRA**：

- **列表**：从 `/sdapi/v1/loras` 拉。拿不到就让玩家手填文件名。「刷新」按钮先调 `refresh-loras` 再拉，新放进去的文件也能看到。
- **怎么发**：每张卡在每条连接下存一组 `[{name, weight, on, trigger}]`，权重默认 1，范围 0–2。开着的写成 `<lora:名字:权重>` 接在正面提示词最后；有触发词的接在人数标签后面。A1111、Forge 都认这种写法，玩家自己包的接口认这个写法也能切。
- **模板**：多一个变量 `{LoRA}`，想换位置的玩家自己挪。
- **快捷切换**：画面页一排小标签，比如 `[星绘 · 1.0 ●] [+]`，点一下开、再点一下关。画笔右键「画这一幕」面板里也有同一排。改的就是这张卡的设置。
- **看不到的 LoRA**：玩家在自己的服务里写死的 LoRA，我们看不见，也切不了，只能叠加我们这边选的。

**运行**：

- 出图和查进度是两个请求同时发。画的时候每 0.5 秒查一次进度，有 `current_image` 就推给前端。A1111 的进度预览要服务端设置里开着。
- 报错：返回的 `detail` / `error` 原样显示。连接层的错照 `tts/http.py` 的 `transport_error` 分开报：拒绝连接 = 服务没开；超时 = 机器没开机或不在同一个网络。
- 超时：300 秒。
- 本地 SD 自己排队，这边不加锁。

## 6. 中转

- 接口有三种：
  - OpenAI 图片接口 `/v1/images/generations`，回 `b64_json` 或 `url`
  - OpenAI 聊天接口 `/v1/chat/completions`，带 `modalities: ["image", "text"]`。回的图可能在 `message.images`、`content` 里的 data URL、或 markdown 链接里，三种都解析
  - Gemini 原生 `/v1beta/models/{model}:generateContent`，`generationConfig.responseModalities` 带 `IMAGE`，图在 `inlineData`
- **「自动」怎么选接口**：按模型名先试。带 `gemini` 的先走 Gemini 原生、再试聊天接口，其余走图片接口。接口不存在或不支持时依次试别的，把成功的那种记进连接。
- **参考图**：图片接口走 `/v1/images/edits`，聊天接口走 `image_url`，Gemini 走 `inlineData`。
- **回来的图**：PNG / JPEG / WebP 都收，给的是链接就下载回来再存。
- **尺寸**：玩家在画面页自己定（预设或自定义宽高）。连接的「可用尺寸」填了，就换成最接近的一种，画面页尺寸旁边写「实际 1536×1024」；清空就原样发。新加的中转连接默认填 `1536x1024, 1024x1536, 1024x1024`（gpt-image 只收这几种）。
- **额外参数**：填的 JSON 直接并进请求体。各家模型的差异都走这里，不另加专门选项。
- **种子**：没有，相册里这一项显示空。
- **超时**：180 秒。
- **其他 OpenAI 兼容服务**：本地跑的这类服务也选「中转站」，地址填本机就行。
- **这期不做**：要轮询的异步任务接口（Midjourney 代理那类）。
- **真站实测（11-09，teamorouter）**：`gpt-image-2` 走图片接口，带参考图（`/images/edits`）和不带都通，30–40 秒；`gemini-3.1-flash-image` 走 Gemini 原生（带参考图，35 秒）和聊天接口（15 秒）都通。Gemini 和聊天接口只按长宽比出图，实际回来的尺寸不一定等于吸附后的尺寸（要 1536×1024，回 1264×848）。

## 7. 测试出图

连接页和画面页都有这个按钮，分两步：

1. **查连接**（不花钱）：
   - 本地 SD：`/sdapi/v1/sd-models`，拿不到就退一步，只看端口有没有回应
   - 中转：`/v1/models`
   - NovelAI：`/user/subscription`
2. **画一张**：
   - 画一个固定场景，用这张卡的长相（没选卡就用内置的简单描述），以及这条连接的模型、LoRA 和模板
   - 不经过指导模型，图也不进相册

测试小窗里显示：图、实际发出去的正反提示词、三段用时（排队 / 画 / 传回）。失败时给接口返回的原文。

花费写在按钮上：NovelAI 超出免费范围时写要扣多少 Anlas，中转写「会按你的中转站计费」。按钮不会自动点。

## 8. 延迟

下面是 10 月的旧数字，这次没重测：

- 指导模型：2.4–4.3 秒
- NovelAI：约 3 秒
- 5090 上 ComfyUI + DMD2：1.26 秒（10-06 原型；本地 SD 实际多快取决于玩家用什么模型）
- 中转：没有数据

所以本地出图时，最慢的一步是指导模型。按这个顺序做：

1. **先记用时**：`GeneratedImage.params.timing = {plan, queue, draw, fetch}`，相册里每张图都能看。后面几条都按它决定做不做、做到哪一步。
2. **指导模型卡住就重发**：工作区里已经写好了（`writer.py` 的 `_first_answer`，10 秒重发、60 秒放弃）。
3. **排队**：NovelAI 照旧用现在那把锁（同一个账号本来只能同时画一张）。本地 SD 自己排队，这边不加锁；中转也不加。
4. **复用网络连接**：按连接缓存 `httpx.AsyncClient`，改连接和退出时关掉，省掉重复握手。局域网和 Tailscale 地址走 `is_direct_host`，直连不走代理。
5. **不来回换模型**：A1111 接口带 `override_settings_restore_afterwards: false`。
6. **过程预览**：
   - `/generate` 带一个 `job_id`，前端先开 `GET /jobs/{id}/events`（SSE），收本地 SD 的进度图。
   - 真实时间不会变短，只是玩家不用干等。
7. **指导模型边写边读**：
   - 做法：把 `writer.py:100` 里的 `description`、`title` 挪到 JSON 最后，改用流式，读到 `people` 写完就开始画，标题后补。
   - **能省多少是估的**，大概是写标题和说明那 100 个 token 的时间。中转站如果整段才发下来就没效果（teamorouter 就是这样）。
   - 第 1 条的数据显示省不到 0.5 秒，就不做。

不在这期：回复写完就提前想好画面。要等有了用时数据再说。

## 9. 高级提示词（默认折叠）

**写法**：每张卡在每条连接下选一种，三选一。它决定默认模板，以及标签怎么转换。

| 写法 | 适合的模型 | 怎么转 |
|---|---|---|
| NovelAI | NovelAI | 不转。模板留空时走现有代码，结果逐字节不变 |
| SD 标签 | Illustrious、Pony、SDXL | `1.4::x::` → `(x:1.4)`；权重 ≤ 0 的去掉；`{x}` → `(x:1.05)`；`artist:x` → `x` |
| 自然语言 | Flux、gpt-image、Gemini | 同样转换，再把指导模型字段说明里的「danbooru 标签」换成「英文短句」 |

连接的默认写法：NovelAI 用 NovelAI，本地 SD 用 SD 标签，中转用自然语言。用 Anima 这类画师写成 `@画师` 的模型时，玩家自己改画师串。

**画图模型模板**：正面、反向各一个文本框。只替换下面这些变量，其他字原样保留，NovelAI 的 `{x}` 不受影响。

- **正面变量**：`{人数}` `{画师}` `{场景}` `{构图}` `{画风}` `{人物}` `{质量词}` `{LoRA}`
- **反向变量**：`{反向预设}` `{画风反向}` `{角色反向}`
- **SD 标签默认模板**：`{人数}, {人物}, {画师}, {场景}, {构图}, {画风}, {质量词}, {LoRA}`
- **自然语言默认模板**：`{构图} {人物} {场景} {画风}`
- **`{人物}` 怎么展开**：
  - NovelAI：留空（走分角色提示词）
  - SD 标签：每个人的标签接在一起
  - 自然语言：写成 `名字: 长相, 衣服, 动作`，人和人之间用分号隔开
- **多人场景**：拼成一段以后，SD 模型可能把两个人的长相混在一起。这是模型本身的限制。

**指导模型说明书**：现有的 manual / auto / look / note 四份，改成按卡 × 连接存，带「恢复默认」。字段和 JSON 格式还是写死在代码里，玩家改说明书也改不坏。`SKILL_LOOK` 里写的「给 NovelAI」改成通用说法。

实际发出去的提示词，相册和测试结果里都能看到，不另做预览。

## 10. 只做个人版

这期只进本地版、整合包和公开仓库。公网站不开，也不为它做准备，比如限制连接类型、按账号排队、按玩家隔离连接都不做（11-07 用户：GitHub 版暂时不再更新公网方面的支持）。以后真要上公网，再单独设计。

个人版要防的只有一件事：本地版没有登录，同一个 Wi-Fi 里的人也能调接口。所以 key 只写不读，改地址时 key 要重填（第 2 节）。

## 11. 交互和设置页

设置页改的都是当前这张卡。没选卡时，只有「连接」和「相册」能用。

**第一次点画笔**：还没有连接时弹一句「还没接画图」和一个「去加」按钮，点了直接打开「加一条连接」。这种情况下自动出图不打扰玩家。

**加一条连接**：

1. 先三选一：中转站 / NovelAI / 本地 SD。
2. 只填第 2 节表里那几项，点「连接」，先免费查一次，能拉到模型列表就拉下来。
3. 连上后自动起名，比如「Forge · 5090」「中转 · xxx.com」，可以改。
4. 「画一张试试」写明要不要花钱，不会自动点。

| 页 | 内容 |
|---|---|
| 画面 | 首屏放这几项：连接（下拉）、模型、画风、LoRA（只有本地 SD 有）、尺寸（预设 + 自定义宽高，所有连接都有）、**测试出图**。「更多」里是步数、引导、采样器、种子等，这条连接没有的项不显示 |
| 角色 | 不变，加一栏「你的样子」 |
| 自动出图 | 不变，改为按卡存 |
| 连接（原「服务」） | 连接列表（卡片，小字「类型 · 地址」）、加一条（弹小窗）、查连接、找本机；NovelAI 查额度。改地址或 key 时旁边写「3 张卡在用」，删连接要点两下。下面是指导模型那一组 |
| 高级 | 写法、两个模板、说明书 |

**尺寸怎么发**：NovelAI 照现在，对齐 64 的倍数，超出免费范围提示扣 Anlas；本地 SD 按填的发（对齐 64）；中转按连接的「可用尺寸」换成最接近的一种，没填就原样发。实际发出去的大小写在尺寸旁边。
| 相册 | 每张图加上用时和连接名 |

- **换连接**：星绘从 NovelAI 换到本地 SD 时，下面的选项换成她在本地 SD 下的那一份；没用过就抄上次用的，不弹窗。切回 NovelAI 时，23 步还在。
- **局内**：画笔右键「画这一幕」面板加一行「用：连接 ▾」，本地 SD 连接下再加一排 LoRA 开关。改的是这张卡的设置。
- **出图时**：右下角的细条照旧显示「构思画面 › Drawing」。本地 SD 有预览时，插图位置先出一张模糊的图，再慢慢变清楚。失败时细条显示报错原文。
- **文案**：把写死「NovelAI」的地方都改掉，提示放进小「?」，报错给英文原文。
- **判断能不能画**：卡没选连接、连接被删时，画笔提示去选，自动出图不打扰。`useImageGen.tsx:685`、`VnControls.tsx` 里判断 `has_token` 的地方，都改成判断有没有连接。

接口：

```
GET/POST           /api/imagegen/connections
PUT/DELETE         /api/imagegen/connections/{id}
GET                /api/imagegen/connections/{id}/options   （模型、采样器、LoRA）
POST               /api/imagegen/connections/{id}/check
POST               /api/imagegen/connections/{id}/test
GET/PUT            /api/imagegen/setup?card_id=
POST               /api/imagegen/generate    （加 connection_id、job_id）
GET                /api/imagegen/jobs/{id}/events
```

## 12. 怎么验收

- **老行为不变**：升级前后 NovelAI 请求体逐字节相同，现有的 `test_imagegen.py` 全过。
- **隔离**：
  - 星绘改连接和步数，不影响香奈美
  - 星绘切回 NovelAI，步数还是 23
  - 新卡抄到上次的设置，之后两边互不影响
- **角色包**：
  - 导出的 `.animavn` 里没有 `imagegen.setup`、连接、key
  - 有长相、参考图；没有「只画全年龄」
  - 旧包能导入，旧字段会搬进 setup
- **本地 SD**：用假服务器（httpx `MockTransport`）测，覆盖这些情况：
  - 请求体字段
  - 可选请求 404 时界面隐藏对应项
  - LoRA 写成 `<lora:名字:权重>`、触发词的位置、关掉的 LoRA 不发
  - 报错原文
- **中转**：用假服务器测三种接口，以及三种回图写法的解析、自动换接口、尺寸吸附、额外参数合并。
- **真实出图**：
  - 本地 SD 要有一个 Forge。先问用户装在哪；装在 5090 上的话，有别的会话在练声音时不跑（见 `docs/voice-server.md`），用完关掉，免得占显存。
  - 测试项：普通出图、LoRA 开关前后对比、换模型、预览。
- **用时**：同一个场景对比改前改后，数字写进这份文档。
- **界面**：写库的测试用数据库副本 + 8012 端口，给链接时标明是测试版；实测前先备份 `plugin.*`。

## 13. 分步

一步做成一个或几个提交，每一步都能单独验收：

0. **先提交工作区里现有的生图改动**：`writer.py`、`ImageGenSettings.tsx`、`imagegen.css`、`imagegen.test.ts`、`tips.ts`、`useImageGen.tsx`。等用户确认后再提交，别混进这次的改动。
1. **骨架**：
   - 连接表、`imagegen.setup`、升级、角色包白名单
   - NovelAI 接到后端接口、用时、测试按钮
   - 设置页改造
   - 做完以后 NovelAI 的行为不变
2. **本地 SD**：A1111 接口、LoRA、SD 标签转换、预览。要用 Forge 实测。
3. **中转**：三种接口加自然语言写法。要拿真站实测。
4. **高级提示词**：模板和说明书的界面。
5. **延迟收尾**：连接复用、边写边读（按用时数据决定做不做）。
6. **收尾**：
   - 改 `docs/plugins/image-gen.md`（现在写着「只支持 NovelAI」）
   - 新写 `docs/plugins/image-gen-api.md`
   - 改 `TODO.md` 里相关的三条
   - 确认整合包
   - 按规则进公开版 preview

## 不做

- 直接接 ComfyUI（工作流、占位符、内置工作流）：11-07 用户定，让玩家自己包成接口
- 替玩家装软件、下模型、写包装
- 本地 SD 的参考图：ControlNet、IP-Adapter 各家写法不一样
- 要轮询的异步任务接口
- 回复写完就提前想好画面（等数据）
- 公网站，以及只给公网用的东西：限制连接类型、按账号排队、按玩家隔离（11-07 用户：暂时只做个人版）
- 「只画全年龄」的新处理（11-07 用户：现在不分瑟瑟和普通）
