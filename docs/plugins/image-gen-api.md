# 本地 SD 的接口

AnimaVN 的「本地 SD」连接只认 A1111 接口。A1111、Forge 开了 API 就是这个接口。用别的软件（比如 ComfyUI）的话，把它包成下面这几个地址就能接进来，不用改 AnimaVN。

连接里填的「用户:密码」会走 HTTP Basic，没填就不发。地址填到端口为止，比如 `http://127.0.0.1:7860`。

## 要实现哪些

| 请求 | 用途 | 必须实现吗 |
|---|---|---|
| `POST /sdapi/v1/txt2img` | 出图 | 必须，最少要认 `prompt` |
| `GET /sdapi/v1/sd-models` | 模型下拉，也当「查连接」 | 可选 |
| `GET /sdapi/v1/samplers`、`/schedulers` | 采样器、调度器下拉 | 可选 |
| `GET /sdapi/v1/loras`、`POST /sdapi/v1/refresh-loras` | LoRA 列表 | 可选 |
| `GET /sdapi/v1/progress` | 画的时候的过程预览 | 可选 |

可选的请求回 404 时，界面上就不显示对应那一项，照样能画。

## 出图

请求体：

| 字段 | 说明 |
|---|---|
| `prompt` | 正面提示词，LoRA 已经写在里面（见下面） |
| `negative_prompt` | 反向提示词 |
| `width`、`height` | 64 的倍数 |
| `seed` | 每次都发具体的数 |
| `steps`、`cfg_scale` | 步数、引导 |
| `batch_size`、`n_iter` | 固定 1 |
| `send_images` | 固定 `true`，图要放在回包里 |
| `save_images` | 固定 `false` |
| `sampler_name` | 选了才发 |
| `scheduler` | 选了才发 |
| `override_settings` | 选了模型才有，`{"sd_model_checkpoint": "模型名"}` |
| `override_settings_restore_afterwards` | 固定 `false`：画完不换回原来的模型 |

回包：

```json
{"images": ["base64"]}
```

只取第一张。PNG、JPEG、WebP 都行，开头带不带 `data:` 前缀都行，类型按文件头认。

出错时 HTTP 状态码不是 200，回包里的 `detail`（或者 `error` / `errors`）会原样显示给玩家。

## 下拉列表

每个都回 JSON 数组，只用这一个字段：

| 请求 | 字段 |
|---|---|
| `sd-models` | `title`，选中后原样发回 `sd_model_checkpoint` |
| `samplers` | `name` |
| `schedulers` | `name` |
| `loras` | `name`，发的时候也用它 |

`POST /sdapi/v1/refresh-loras` 不用回内容，让服务重新看一遍 LoRA 文件夹。

## 过程预览

画的时候每 0.5 秒查一次 `GET /sdapi/v1/progress?skip_current_image=false`：

```json
{"progress": 0.4, "current_image": "base64"}
```

`current_image` 是不带前缀的 base64，空的时候这一轮跳过。`progress` 是 0 到 1。

## LoRA 怎么写

开着的 LoRA 接在 `prompt` 的最后，写成：

```
<lora:名字:权重>
```

权重 0 到 2，比如 `<lora:my_style:0.8>`。名字是列表里的 `name`，手填的就是玩家填的文件名。

有触发词的话，触发词接在人数标签（比如 `1girl`）的后面。

关掉的 LoRA 不会出现在提示词里。你的接口认这个写法，就能在 AnimaVN 里按卡开关 LoRA。你在自己服务里写死的 LoRA，AnimaVN 看不到也切不了，只能叠加。
