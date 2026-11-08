# AI 生图：参考图强度可调

2026-11-04 用户定的。交给新会话实现，做完告诉用户（原会话在等这个功能，好用新画风重画 Claude娘 视频的 CG）。

**11-04 已实现（滑条部分）**：照下面做了；另外生成记录 `params.reference` 也记下 `strength`，相册「参考图」那行强度不是 1 时带「· 强度 0.60」。后端超出 0.3–1.0 返回 422。8000 要重启才认新字段（旧后端会忽略、按 1.0 画）。

## 为什么

做 Claude娘 宣传视频时测了「参考原画风」：同一张 CG（「含泪的瞪视」，NAI V4.5 Full、1216×832、23 步、同种子），拿礼裙立绘 `角色素材\Claude娘\立绘（礼裙）\00_平静.png` 当参考图、开「连画风一起参考」，换强度出了 6 张（`角色素材\Claude娘\CG画风\`，`gen_ref.py`，挑选页 127.0.0.1:8837）。

- 强度 1.0（游戏现在写死的值）：脸最稳，但画风、衣服都被立绘拉过去
- **用户选的是 34 号：连画风一起参考 + 强度 0.6 + 现在的画师串（fuzichoco + rella）**
- 现在玩家调不了：`AnimaBackend/app/plugins/imagegen/nai.py` 的 `build_body` 把 `director_reference_strength_values` 写死成 `[1.0]`（第 276 行），`director_reference_secondary_strength_values` 是 `[0.0]`

## 要做的

在卡的 AI 生图设置里、「连画风一起参考」开关下面加一个滑条：

- 名字：**参考强度**；小「?」里的说明用用户给的原话：**调节立绘参考图对画风控制程度**（界面不写别的长说明，见记忆「界面别过度解释」）
- 范围 0.3–1.0，步长 0.05；**默认 1.0**（不改已有卡的效果）
- 按卡存：放进卡偏好 `plugin.imagegen` 的 `ref` 里（现在是 `{kind, id, sha, style}`），加 `strength`；缺省 / 非法值按 1.0
- 参考图关着（`kind: 'off'`）或模型不是 V4.5 时，滑条和开关一样不显示 / 不可用

## 代码位置

- 前端
  - 卡偏好的类型和清洗：`frontend/src/debug/plugins/imagegen/config.ts`（`normalizeCardPrefs`，约 458 行；测试在 `imagegen.test.ts` 181–193 行，照着加）
  - 设置界面：`ImageGenSettings.tsx` 约 572 行「连画风一起参考」的 `<Toggle>`；参考图那块的摘要文字在约 166 行，强度不是 1.0 时可以带上
  - 小「?」文案：`tips.ts`（`ref` 那条是现有的参考图说明）
  - 发请求：`useImageGen.tsx` 约 463 行 `ref: { kind, id, style }`，加上 `strength`
- 后端
  - `schemas.py` 的 `RefIn`（约 162 行）加 `strength: float = 1.0`，限制在 0.3–1.0
  - `api.py` 的 `_reference`（约 306–324 行）把 `ref.strength` 交给 `nai.Reference`
  - `nai.py`：`Reference` 加 `strength: float = 1.0`，`build_body` 用它填 `director_reference_strength_values`；`secondary`（= 1 − 还原度）先不动
  - 测试：`AnimaBackend/tests/plugins/imagegen/test_imagegen.py`，加一条 build_body 带强度的

## 先注意

- **工作区里 imagegen 这几个文件已经有没提交的改动**（不是这次的）：`writer.py`、`test_imagegen.py`、`ImageGenSettings.tsx`、`imagegen.css`、`tips.ts`、`useImageGen.tsx`。动手前先 `git diff` 看清楚，别覆盖、别混进同一个提交；不确定是谁的问用户
- 34 号除了强度 0.6，还把「这一刻穿的」衣服串加重了（`1.4::…::`），因为强度低时容易把立绘的礼裙画回来。游戏现在不加重。**先只做滑条**；要不要「强度 < 1 时自动加重衣服」等用户用 0.6 实际出几张再定（参考图出图每张扣 5 Anlas，出图前先告诉用户）
- 提交：一件事一个提交、提交信息不加 Claude 署名（见记忆）；做完提醒用户提交
- 浏览器实测前先备份要动的设置（记忆「测试别覆盖用户的真实配置」）

## 做完以后

告诉用户，原会话接着做：
- 把 Claude娘 卡设成连画风参考 + 0.6
- 在录制副本 `宣发\视频\2026-11-04 Claude娘怀孕降智\录制\data` 里重画视频要用的几张 CG

注意副本的前端是单独打包的（`录制\dist`，VITE_API_PORT=8014），功能合进来以后要重新打包一次才看得到滑条。
