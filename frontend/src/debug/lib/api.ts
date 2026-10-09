import type { AnnotateRequest, AnnotateResponse } from '../plugins/jevRun';
import type { AssemblyResult } from './assembler';
import type { StoredChatMessage } from './chatEntry';

/** Jev 的 key 设了没有、从哪来(环境变量 / 插件页) */
export interface JevKeyStatus {
  has_key: boolean;
  source: 'env' | 'settings' | null;
}

/** 后端存的 Jev 默认问法和门槛(插件页显示、「恢复默认」用) */
export interface JevDefaults {
  prompts: Record<string, string>;
  /** 「不换」选项的名字 */
  keep: string;
  /** CG 题里「收起 CG」那个选项的名字;后端是旧版时没有 */
  cg_off?: string;
  thresholds: { speaker: number; bg: number; bgm: number; cg?: number };
}

// 没配置时跟着地址栏走:本机开就连 localhost,手机用局域网 IP 开就连那个 IP,
// 换网络不用改配置。部署时配成空串 = 同源,走 nginx 反代
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `http://${location.hostname}:8000`;

/** FastAPI 的错误体是 {detail: "..."},取出来当消息;取不到就退回状态码 */
async function failure(res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  let detail = body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'detail' in parsed &&
      typeof (parsed as { detail: unknown }).detail === 'string'
    ) {
      detail = (parsed as { detail: string }).detail;
    }
  } catch {
    // 不是 JSON,保留原始 body
  }
  return new Error(detail || `${res.status} ${res.statusText}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 只有带 JSON 请求体的才标 Content-Type:后端在另一个端口(跨源),GET 带上它就不算「简单请求」,
  // 浏览器每次都要先发一个 OPTIONS 预检,手机走 Tailscale 时每个 GET 平白多一个来回
  const res = await fetch(`${BASE_URL}${path}`, {
    ...(typeof init?.body === 'string' ? { headers: { 'Content-Type': 'application/json' } } : {}),
    ...init,
  });
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Content-Disposition 里的文件名。后端两个都给:filename*=UTF-8''… 是完整的(带中文),
 * filename="…" 是把非 ASCII 字符剥掉的兜底 —— 先认前者,不然中文名的对话全导出成 chat.jsonl
 */
export function filenameFromDisposition(disposition: string): string | null {
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) {
    try {
      const decoded = decodeURIComponent(star[1].trim());
      if (decoded) return decoded;
    } catch {
      // 编码坏了就退回普通的 filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
  return plain?.[1].trim() || null;
}

/** 后端返回 attachment 的下载:拉成 blob,再从 Content-Disposition 取文件名存盘 */
async function downloadAttachment(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw await failure(res);
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get('Content-Disposition') ?? '') ?? fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export type ApiType = 'openai_compatible' | 'anthropic' | 'mock';

/** 思考深浅:null = 不传,跟服务默认。怎么翻译成请求参数见后端 app/llm/thinking.py */
export type ThinkingLevel = 'off' | 'low' | 'high' | 'max';

export interface DebugConnection {
  id: string;
  name: string;
  api_type: string;
  base_url: string | null;
  model: string;
  has_api_key: boolean;
  is_active: boolean;
  /** 这个端点能不能流式 —— 是端点的属性不是我们的,不少中转站号称兼容却吃不下 stream=true */
  stream: boolean;
  thinking: ThinkingLevel | null;
  cached_models: string[];
  cached_models_at: string | null;
}

/** 创建/更新连接用的载荷(更新时全可选,只发变化的字段) */
export interface ConnectionPayload {
  name?: string;
  api_type?: ApiType;
  base_url?: string | null;
  api_key?: string | null;
  model?: string;
  stream?: boolean;
  /** null = 改回跟服务默认 */
  thinking?: ThinkingLevel | null;
}

export interface CompleteResult {
  raw: string;
  connection_name: string;
  model: string;
}

export interface StreamMeta {
  connection_name: string;
  model: string;
  ttft_ms: number;
}

export interface StreamDone {
  total_ms: number;
  reasoning_type: 'model' | 'parsed' | null;
  reasoning_ms: number | null;
}

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void;
  onReasoning?: (text: string) => void;
  onDelta?: (text: string) => void;
}

/** 一帧 SSE:`event: xxx` + 一到多行 `data: ...` */
function parseFrame(frame: string): { event: string; data: string } {
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  return { event, data };
}

/**
 * 流式版的 complete。
 *
 * 不用 EventSource ——它只会发 GET,而提示词是一大坨 body,必须 POST。
 * 好处是 AbortSignal 照常起作用,「停止生成」白送。
 */
async function streamComplete(
  messages: { role: string; content: string; name?: string }[],
  connectionId: string | undefined,
  model: string | undefined,
  signal: AbortSignal | undefined,
  handlers: StreamHandlers,
): Promise<StreamDone> {
  const res = await fetch(`${BASE_URL}/api/debug/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, connection_id: connectionId, model }),
    signal,
  });
  // 后端刻意把第一个 chunk 拿到手才开始响应,所以密钥/模型名这类错还是正经的 4xx/5xx
  if (!res.ok) throw await failure(res);
  if (!res.body) throw new Error('这个浏览器不支持流式读取(ReadableStream)');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: StreamDone | null = null;

  // 中途抛错(error 帧、解析失败)时把连接关掉,别让它挂着等后端自己断
  let ended = false;
  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) {
        ended = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const { event, data } = parseFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        const payload: unknown = data ? JSON.parse(data) : {};

        if (event === 'meta') handlers.onMeta?.(payload as StreamMeta);
        else if (event === 'reasoning') handlers.onReasoning?.((payload as { text: string }).text);
        else if (event === 'delta') handlers.onDelta?.((payload as { text: string }).text);
        else if (event === 'done') done = payload as StreamDone;
        else if (event === 'error') throw new Error((payload as { message: string }).message);

        split = buffer.indexOf('\n\n');
      }
    }
  } finally {
    if (!ended) void reader.cancel().catch(() => undefined);
  }

  if (!done) throw new Error('流意外中断——没有收到结束帧');
  return done;
}

export interface HealthResult {
  status: string;
  version: string;
}

/** 后端存的预设 —— 字段和酒馆预设 JSON 一一对应,原样进出 */
export interface StoredPresetPayload {
  name: string;
  prompts: unknown[];
  prompt_order: unknown[];
  formats: Record<string, string>;
  params: Record<string, unknown>;
  squash_system_messages: boolean;
}

export interface StoredPreset extends StoredPresetPayload {
  id: string;
  created_at: string;
  updated_at: string;
}

// ── 调试台对话 ──────────────────────────────────────────────

/** 列表视图的一条对话 */
export interface ChatSummary {
  id: string;
  name: string;
  card_id: string | null;
  preset_id: string | null;
  card_name: string;
  preset_name: string;
  user_name: string;
  tainted: boolean;
  parent_chat_id: string | null;
  parent_message_id: string | null;
  /** {{setvar}} 一类的宏写下的变量。老后端没有这个字段 */
  variables?: Record<string, string | number>;
  message_count: number;
  /** 最后一条消息的正文(后端已压平空白并截断)—— 历史列表的预览行 */
  last_message: string;
  created_at: string;
  updated_at: string;
}

/** 详情视图 = 摘要 + 全量消息。消息里的 swipe_info 没有 snapshot,只有哈希 */
export interface ChatDetail extends Omit<ChatSummary, 'message_count'> {
  message_count: number;
  messages: StoredChatMessage[];
}

export interface ChatPayload {
  name?: string;
  card_id?: string | null;
  preset_id?: string | null;
  user_name?: string;
  tainted?: boolean;
  /** 宏变量,整份替换 */
  variables?: Record<string, string | number>;
}

/** 后端存的角色卡 —— 字段名照搬 chara_card_v2/v3 spec */
export interface StoredCardPayload {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  post_history_instructions: string;
  creator_notes: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  character_book: Record<string, unknown> | null;
  extensions: Record<string, unknown>;
  spec: string;
  avatar: string | null;
  /** 这张卡上次打开的对话(酒馆的 character.chat)。null = 还没打开过 */
  last_chat_id: string | null;
}

export interface StoredCard extends Omit<StoredCardPayload, 'avatar'> {
  id: string;
  has_avatar: boolean;
  created_at: string;
  updated_at: string;
}


/** 玩家人设(酒馆 Persona Management 的对应物)。全局一份,激活的那个决定 {{user}}。 */
export interface DebugPersona {
  id: string;
  name: string;
  description: string;
  /** data URL;null = 用默认头像 */
  avatar: string | null;
  is_active: boolean;
  created_at: string;
}

function parseEmoMode(v: string | null): EmoMode {
  return v === 'vector' || v === 'none' ? v : 'ref';
}

export const debugApi = {
  health: () => request<HealthResult>('/api/health'),

  // --- 玩家人设 ---
  listPersonas: () => request<DebugPersona[]>('/api/personas'),

  createPersona: (payload: { name: string; description?: string; avatar?: string | null }) =>
    request<DebugPersona>('/api/personas', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePersona: (
    id: string,
    patch: { name?: string; description?: string; avatar?: string | null },
  ) =>
    request<DebugPersona>(`/api/personas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deletePersona: (id: string) => request<void>(`/api/personas/${id}`, { method: 'DELETE' }),

  /** 单激活:后端先熄灭其余人设再点亮这一个 */
  activatePersona: (id: string) =>
    request<DebugPersona>(`/api/personas/${id}/activate`, { method: 'PUT' }),

  listConnections: () => request<DebugConnection[]>('/api/connections'),

  createConnection: (payload: ConnectionPayload & { name: string; api_type: ApiType }) =>
    request<DebugConnection>('/api/connections', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateConnection: (id: string, patch: ConnectionPayload) =>
    request<DebugConnection>(`/api/connections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteConnection: (id: string) =>
    request<void>(`/api/connections/${id}`, { method: 'DELETE' }),

  activateConnection: (id: string) =>
    request<DebugConnection>(`/api/connections/${id}/activate`, { method: 'POST' }),

  refreshConnectionModels: (id: string) =>
    request<string[]>(`/api/connections/${id}/refresh-models`, { method: 'POST' }),

  /** 未保存表单的模型预览,新建时不用先保存 */
  previewConnectionModels: (payload: {
    api_type: ApiType;
    base_url: string | null;
    api_key: string | null;
    connection_id: string | null;
  }) =>
    request<string[]>('/api/connections/models-preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  pingConnection: (id: string) =>
    request<{ ok: boolean; message: string }>(`/api/connections/${id}/ping`, {
      method: 'POST',
    }),

  testConnectionMessage: (id: string, content: string) =>
    request<{ reply: string }>(`/api/connections/${id}/test-message`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  /** 把已经组装好的 messages 原样发出去,后端不再做任何加工 */
  complete: (
    messages: { role: string; content: string; name?: string }[],
    connectionId: string | undefined,
    model: string | undefined,
    signal?: AbortSignal,
  ) =>
    request<CompleteResult>('/api/debug/complete', {
      method: 'POST',
      body: JSON.stringify({ messages, connection_id: connectionId, model }),
      signal,
    }),

  /** 同上,但边生成边吐。连接上的 stream 开关决定走哪条 */
  streamComplete,

  // ── 预设 ──────────────────────────────────────────

  listPresets: () => request<StoredPreset[]>('/api/tavern/presets'),

  createPreset: (body: StoredPresetPayload) =>
    request<StoredPreset>('/api/tavern/presets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 只发改动的字段;后端 exclude_unset,不会清空没提到的 */
  updatePreset: (id: string, patch: Partial<StoredPresetPayload>) =>
    request<StoredPreset>(`/api/tavern/presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deletePreset: (id: string) =>
    request<void>(`/api/tavern/presets/${id}`, { method: 'DELETE' }),

  duplicatePreset: (id: string, name?: string) =>
    request<StoredPreset>(`/api/tavern/presets/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: name ?? null }),
    }),

  // ── 角色卡 ────────────────────────────────────────

  listCards: () => request<StoredCard[]>('/api/tavern/cards'),

  getCard: (id: string) => request<StoredCard>(`/api/tavern/cards/${id}`),

  createCard: (body: Partial<StoredCardPayload>) =>
    request<StoredCard>('/api/tavern/cards', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCard: (id: string, patch: Partial<StoredCardPayload>) =>
    request<StoredCard>(`/api/tavern/cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteCard: (id: string) =>
    request<void>(`/api/tavern/cards/${id}`, { method: 'DELETE' }),

  duplicateCard: (id: string, name?: string) =>
    request<StoredCard>(`/api/tavern/cards/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: name ?? null }),
    }),

  /** 头像是 data: URL,单独取,列表接口只给 has_avatar */
  getCardAvatar: async (id: string): Promise<string | null> => {
    const res = await fetch(`${BASE_URL}/api/tavern/cards/${id}/avatar`);
    return res.ok ? res.text() : null;
  },

  getPreset: (id: string) => request<StoredPreset>(`/api/tavern/presets/${id}`),

  // ── 对话持久化 ──────────────────────────────────────

  listChats: (cardId: string | null) =>
    request<ChatSummary[]>(`/api/debug/chats${cardId ? `?card_id=${cardId}` : ''}`),

  createChat: (payload: ChatPayload) =>
    request<ChatSummary>('/api/debug/chats', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getChat: (id: string) => request<ChatDetail>(`/api/debug/chats/${id}`),

  updateChat: (id: string, patch: ChatPayload) =>
    request<ChatSummary>(`/api/debug/chats/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteChat: (id: string) =>
    request<void>(`/api/debug/chats/${id}`, {
      method: 'DELETE',
    }),

  putChatMessage: (chatId: string, message: StoredChatMessage) =>
    request<unknown>(`/api/debug/chats/${chatId}/messages/${message.id}`, {
      method: 'PUT',
      body: JSON.stringify(message),
    }),

  deleteChatMessage: (chatId: string, messageId: string) =>
    request<void>(`/api/debug/chats/${chatId}/messages/${messageId}`, {
      method: 'DELETE',
    }),

  /** 按哈希取一份历史提示词 —— 点「看提示词」才调,加载对话不拖历史 */
  getSnapshot: (hash: string) =>
    request<AssemblyResult>(`/api/debug/snapshots/${hash}`),

  /** 「从这里开始」—— 复制前缀到新分支,返回新对话摘要 */
  branchChat: (chatId: string, messageId: string) =>
    request<ChatSummary>(`/api/debug/chats/${chatId}/branch`, {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId }),
    }),

  /** 导出对话为 ST jsonl;tree=true 导出整棵分支树为 zip */
  exportChat: (chatId: string, tree = false) =>
    downloadAttachment(
      `${BASE_URL}/api/debug/chats/${chatId}/export${tree ? '?tree=true' : ''}`,
      'chat.jsonl',
    ),

  /** 导入 ST jsonl(可多文件)。返回新建的对话摘要 */
  importChats: async (files: File[]): Promise<ChatSummary[]> => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch(`${BASE_URL}/api/debug/chats/import`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw await failure(res);
    return res.json() as Promise<ChatSummary[]>;
  },

  // ---- 情绪识别:对不上立绘名的标签,挑列表里最像的 ----

  emotionMatch: (payload: { tags: string[]; candidates: { key: string; names: string[] }[] }) =>
    request<{ model: string; results: EmotionMatchResult[] }>('/api/emotion/match', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  emotionStatus: () => request<EmotionStatus>('/api/emotion/status'),

  // ---- Jev 标注(plugins/jev.ts) ----

  annotateLines: (req: AnnotateRequest, signal?: AbortSignal) =>
    request<AnnotateResponse>('/api/annotate/lines', {
      method: 'POST',
      body: JSON.stringify(req),
      signal,
    }),

  /** 玩家发消息时叫一声:LLM 还在想的时候先把到 Jev 的连接连好 */
  annotateWarmup: () => request<void>('/api/annotate/warmup', { method: 'POST' }),

  annotateStatus: () => request<JevKeyStatus>('/api/annotate/status'),

  annotateDefaults: () => request<JevDefaults>('/api/annotate/defaults'),

  /** 用现在的 key 问 Jev 一道小题:通了回耗时,不通抛出原因 */
  annotateTest: () => request<{ ms: number }>('/api/annotate/test', { method: 'POST' }),

  /** 只能写、不能读;空串 = 删掉 */
  setJevKey: (key: string) =>
    request<void>('/api/annotate/key', { method: 'PUT', body: JSON.stringify({ key }) }),

  // ---- 立绘插件:立绘包、包里的表情映射、卡挂哪些包 ----

  listSpritePacks: () => request<SpritePack[]>('/api/sprite-packs'),

  createSpritePack: (name: string, description = '') =>
    request<SpritePack>('/api/sprite-packs', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  updateSpritePack: (packId: string, patch: { name?: string; description?: string }) =>
    request<SpritePack>(`/api/sprite-packs/${packId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteSpritePack: (packId: string) =>
    request<void>(`/api/sprite-packs/${packId}`, { method: 'DELETE' }),

  listSprites: (packId: string) => request<PackSprite[]>(`/api/sprite-packs/${packId}/sprites`),

  createSprite: (packId: string, payload: SpritePayload & { label: string }) =>
    request<PackSprite>(`/api/sprite-packs/${packId}/sprites`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSprite: (packId: string, spriteId: string, patch: SpritePayload) =>
    request<PackSprite>(`/api/sprite-packs/${packId}/sprites/${spriteId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteSprite: (packId: string, spriteId: string) =>
    request<void>(`/api/sprite-packs/${packId}/sprites/${spriteId}`, { method: 'DELETE' }),

  reorderSprites: (packId: string, ids: string[]) =>
    request<PackSprite[]>(`/api/sprite-packs/${packId}/sprites/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  /** 给还没找过脸的立绘补上;rescan = 整套重找。返回这个包的全部立绘 */
  scanSpriteFaces: (packId: string, rescan = false) =>
    request<PackSprite[]>(
      `/api/sprite-packs/${packId}/sprites/scan-faces${rescan ? '?rescan=true' : ''}`,
      { method: 'POST' },
    ),

  getSpriteLayout: (packId: string) =>
    request<SpriteLayout>(`/api/sprite-packs/${packId}/sprites/layout`),

  putSpriteLayout: (packId: string, layout: SpriteLayout) =>
    request<SpriteLayout>(`/api/sprite-packs/${packId}/sprites/layout`, {
      method: 'PUT',
      body: JSON.stringify(layout),
    }),

  uploadSpriteImage: async (packId: string, spriteId: string, file: Blob): Promise<PackSprite> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/api/sprite-packs/${packId}/sprites/${spriteId}/image`, {
      method: 'PUT',
      body: form,
    });
    if (!res.ok) throw await failure(res);
    return res.json() as Promise<PackSprite>;
  },

  /** 这张卡挂着哪些包(按顺序)、哪个是当前 */
  getCardSpritePacks: (cardId: string) =>
    request<CardSpritePacks>(`/api/tavern/cards/${cardId}/sprite-packs`),

  /** 整组替换;current 不传 = 原来的当前包还在就留着,不在了换成它后面的下一个 */
  setCardSpritePacks: (cardId: string, packIds: string[], current?: string) =>
    request<CardSpritePacks>(`/api/tavern/cards/${cardId}/sprite-packs`, {
      method: 'PUT',
      body: JSON.stringify({ pack_ids: packIds, current: current ?? null }),
    }),

  /** 游戏里换一套立绘:只换当前包 */
  setCardCurrentSpritePack: (cardId: string, packId: string) =>
    request<CardSpritePacks>(`/api/tavern/cards/${cardId}/sprite-packs/current`, {
      method: 'PUT',
      body: JSON.stringify({ pack_id: packId }),
    }),

  /** 这张卡当前包的立绘;没挂包时是空列表 */
  listCardSprites: (cardId: string) =>
    request<PackSprite[]>(`/api/tavern/cards/${cardId}/sprites`),

  // ---- 场景包(背景 + BGM 插件) ----

  listScenePacks: () => request<ScenePack[]>('/api/scene-packs'),

  createScenePack: (name: string, description = '') =>
    request<ScenePack>('/api/scene-packs', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  updateScenePack: (
    packId: string,
    patch: { name?: string; description?: string; title_bgm_id?: string | null },
  ) =>
    request<ScenePack>(`/api/scene-packs/${packId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteScenePack: (packId: string) =>
    request<void>(`/api/scene-packs/${packId}`, { method: 'DELETE' }),

  listSceneAssets: (packId: string) =>
    request<SceneAsset[]>(`/api/scene-packs/${packId}/assets`),

  createSceneAsset: (
    packId: string,
    payload: {
      kind: SceneKind;
      label: string;
      aliases?: string[];
      description?: string;
      /** 只有 CG 差分带:挂在哪张 CG 下面 */
      parent_id?: string;
    },
  ) =>
    request<SceneAsset>(`/api/scene-packs/${packId}/assets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSceneAsset: (packId: string, assetId: string, patch: SceneAssetPatch) =>
    request<SceneAsset>(`/api/scene-packs/${packId}/assets/${assetId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteSceneAsset: (packId: string, assetId: string) =>
    request<void>(`/api/scene-packs/${packId}/assets/${assetId}`, { method: 'DELETE' }),

  reorderSceneAssets: (packId: string, kind: SceneKind, ids: string[]) =>
    request<SceneAsset[]>(`/api/scene-packs/${packId}/assets/reorder`, {
      method: 'POST',
      body: JSON.stringify({ kind, ids }),
    }),

  uploadSceneFile: async (packId: string, assetId: string, file: Blob): Promise<SceneAsset> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/api/scene-packs/${packId}/assets/${assetId}/file`, {
      method: 'PUT',
      body: form,
    });
    if (!res.ok) throw await failure(res);
    return res.json() as Promise<SceneAsset>;
  },

  /** 这张卡绑的场景包;没绑返回 null */
  getCardScenePack: async (cardId: string): Promise<string | null> =>
    (await request<{ pack_id: string | null }>(`/api/tavern/cards/${cardId}/scene-pack`)).pack_id,

  setCardScenePack: (cardId: string, packId: string | null) =>
    request<{ pack_id: string | null }>(`/api/tavern/cards/${cardId}/scene-pack`, {
      method: 'PUT',
      body: JSON.stringify({ pack_id: packId }),
    }),

  // ---- 全局设置(插件配置) ----

  /** 没存过返回 null,由调用方用默认值 */
  getSetting: async <T,>(key: string): Promise<T | null> =>
    (await request<{ value: T | null }>(`/api/settings/${key}`)).value,

  putSetting: <T,>(key: string, value: T) =>
    request<{ key: string; value: T }>(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  // ---- 语音插件 ----

  listTtsConnections: () => request<TtsConnection[]>('/api/tts/connections'),

  createTtsConnection: (
    payload: { name: string; api_type?: TtsApiType; base_url: string } & TtsConnectionPatch,
  ) =>
    request<TtsConnection>('/api/tts/connections', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTtsConnection: (id: string, patch: TtsConnectionPatch) =>
    request<TtsConnection>(`/api/tts/connections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteTtsConnection: (id: string) =>
    request<void>(`/api/tts/connections/${id}`, { method: 'DELETE' }),

  testTtsConnection: (id: string) =>
    request<{ ms: number }>(`/api/tts/connections/${id}/test`, { method: 'POST' }),

  /** force:不信任后端记住的「当前权重」,强制重新切(插件页的按钮用) */
  warmupVoice: (profileId: string, force = false) =>
    request<{ ms: number }>('/api/tts/warmup', {
      method: 'POST',
      body: JSON.stringify({ profile_id: profileId, force }),
    }),

  /** 这句会怎么念(不合成):挑中的情绪行、怎么挑中的、发给语音服务的原样请求、缓存里有没有 */
  explainVoice: (req: SpeakRequest) =>
    request<VoiceExplain>('/api/tts/explain', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  /** 声音配的一段参考音频(音色参考或某行情绪的参考),从语音服务那台机器上原样取回 —— 语音详情里试听 */
  referenceAudio: async (profileId: string, path: string): Promise<ArrayBuffer> => {
    const q = new URLSearchParams({ profile_id: profileId, path });
    const res = await fetch(`${BASE_URL}/api/tts/reference?${q}`);
    if (!res.ok) throw await failure(res);
    return res.arrayBuffer();
  },

  listVoices: () => request<VoiceProfile[]>('/api/voices'),

  createVoice: (payload: { name: string; connection_id: string } & VoiceProfilePatch) =>
    request<VoiceProfile>('/api/voices', { method: 'POST', body: JSON.stringify(payload) }),

  updateVoice: (id: string, patch: VoiceProfilePatch) =>
    request<VoiceProfile>(`/api/voices/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  deleteVoice: (id: string) => request<void>(`/api/voices/${id}`, { method: 'DELETE' }),

  /** 贴进来的 refs.json(已经 JSON.parse 过);同名声音会更新而不是重复添加 */
  importVoice: (connectionId: string, refs: unknown) =>
    request<VoiceProfile>('/api/voices/import', {
      method: 'POST',
      body: JSON.stringify({ connection_id: connectionId, refs }),
    }),

  createVoiceEmotion: (profileId: string, payload: { label: string } & VoiceEmotionPatch) =>
    request<VoiceEmotion>(`/api/voices/${profileId}/emotions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateVoiceEmotion: (profileId: string, emotionId: string, patch: VoiceEmotionPatch) =>
    request<VoiceEmotion>(`/api/voices/${profileId}/emotions/${emotionId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteVoiceEmotion: (profileId: string, emotionId: string) =>
    request<void>(`/api/voices/${profileId}/emotions/${emotionId}`, { method: 'DELETE' }),

  /** 按这张卡当前立绘包的表情补齐情绪行(只对 IndexTTS 的声音);返回这个声音全部的情绪行 */
  fillVoiceEmotionsFromSprites: (profileId: string, cardId: string) =>
    request<VoiceEmotion[]>(`/api/voices/${profileId}/emotions/from-sprites`, {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    }),

  reorderVoiceEmotions: (profileId: string, ids: string[]) =>
    request<VoiceEmotion[]>(`/api/voices/${profileId}/emotions/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  getCardVoices: async (cardId: string): Promise<CardVoices> => {
    const r = await request<CardVoices>(`/api/tavern/cards/${cardId}/voices`);
    return { main: r.main, extras: r.extras };
  },

  setCardVoices: async (cardId: string, v: CardVoices): Promise<CardVoices> => {
    const r = await request<CardVoices>(`/api/tavern/cards/${cardId}/voices`, {
      method: 'PUT',
      body: JSON.stringify(v),
    });
    return { main: r.main, extras: r.extras };
  },

  ttsCacheStats: () =>
    request<{ count: number; bytes: number; limit_bytes: number }>('/api/tts/cache'),

  clearTtsCache: () => request<void>('/api/tts/cache', { method: 'DELETE' }),

  /**
   * 合成一句(后端有缓存)。音频原样拿回来,由播放器解码。
   * fresh = 重新生成:不用缓存,换一种念法,新的替换缓存里的旧版。
   * tuning = 试音台:这一句用这组语速 / 语言 / 参数,不用声音存着的(不保存)
   */
  speak: async (body: SpeakRequest, fresh = false, tuning?: VoiceTuning): Promise<SpeakResult> => {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...(fresh && { fresh }), ...(tuning && { tuning }) }),
    });
    if (!res.ok) throw await failure(res);
    const audio = await res.arrayBuffer();
    return {
      audio,
      cache: res.headers.get('X-TTS-Cache') === 'hit' ? 'hit' : 'miss',
      emotion: decodeURIComponent(res.headers.get('X-TTS-Emotion') ?? ''),
      mode: parseEmoMode(res.headers.get('X-TTS-Emo-Mode')),
      ms: Math.round(performance.now() - t0),
    };
  },
};

/** 立绘包:一整套表情立绘,卡挂一个或几个,游戏里随时换 */
export interface SpritePack {
  id: string;
  name: string;
  description: string;
  sprite_count: number;
  /** 挂着这个包的卡有几张 */
  card_count: number;
}

export interface CardSpritePacks {
  card_id: string;
  /** 挂着的包,按顺序 */
  pack_ids: string[];
  /** 游戏里正在用的包;一个都没挂时是 null */
  current: string | null;
}

export interface PackSprite {
  id: string;
  pack_id: string;
  /** AI 写在标签里的表情名 */
  label: string;
  /** 同样指向这张图的其他叫法 */
  aliases: string[];
  /** 给 AI 看的用法说明,{{sprites}} 宏会带上它 */
  description: string;
  has_image: boolean;
  /** 图的版本号,拼进 URL 当缓存键 */
  image_version: number;
  /** 排第一的是默认表情 */
  sort: number;
  /** 关掉 = 游戏里当它不存在,行和图留着 */
  enabled: boolean;
  /** 图里的脸在哪;null = 还没找过 */
  face_scan: SpriteFaceScan | null;
  /** 换到这张立绘时的特效(plugins/spriteFx.ts);null = 没设。旧后端没有这个字段 */
  effect?: SpriteEffect | null;
}

/** 立绘切换特效,三样都是 plugins/spriteFx.ts 清单里的 id;null = 这一样不要 */
export interface SpriteEffect {
  motion: string | null;
  bubble: string | null;
  sound: string | null;
}

/** 后端 app/sprite_faces.py 的结果。位置都是占整张图的比例 */
export interface SpriteFaceScan {
  width: number | null;
  height: number | null;
  face: { x: number; y: number; w: number; h: number } | null;
}

/** 一个立绘包怎么摆:按脸自动对齐之后再挪、再放大缩小。dx / dy 以舞台高度为单位 */
export interface SpriteLayout {
  /** 关掉 = 不按脸对齐,撑满舞台高度、居中 */
  auto: boolean;
  zoom: number;
  dx: number;
  dy: number;
}

/** /api/emotion/match 的一条结果:标签 → 最像的候选 */
export interface EmotionMatchResult {
  tag: string;
  key: string;
  /** 候选里相似度最高的那个名字 */
  name: string;
  /** 余弦相似度 */
  score: number;
}

export interface EmotionStatus {
  ready: boolean;
  model: string;
  /** 没装 / 加载失败的原因 */
  detail: string | null;
}

export interface SpritePayload {
  label?: string;
  aliases?: string[];
  description?: string;
  enabled?: boolean;
  /** null = 去掉特效 */
  effect?: SpriteEffect | null;
}

/**
 * 立绘请求后端转好的 WebP:原图 PNG 一张动辄近 1 MB(星绘一张 1058 KB → 126 KB),一个角色十几张,
 * 进游戏要等很久。立绘原图大多就 800–1000 宽,比这窄的后端不放大、只换格式,分辨率不丢。
 * 手机、平板(触屏)最宽 1024;电脑最宽 1280(10-04 起电脑也压,之前电脑用原图)。见 AnimaBackend/app/images.py
 */
const COARSE = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const SPRITE_WIDTH = COARSE ? 1024 : 1280;
/** 背景 / CG:游戏里铺满屏幕,电脑 1920、手机 1280 宽就够 */
const SCENE_WIDTH = COARSE ? 1280 : 1920;

/** <img src> 直接用的地址。带版本号:换图后 URL 变,浏览器就不会继续显示缓存里的旧图 */
export function spriteImageUrl(s: PackSprite): string | null {
  if (!s.has_image) return null;
  return `${BASE_URL}/api/sprite-packs/${s.pack_id}/sprites/${s.id}/image?v=${s.image_version}&w=${SPRITE_WIDTH}`;
}

/**
 * 封面上的角色头像圈:后端把这张卡当前包的默认立绘按脸裁成的小图。没有带图的立绘时 404,
 * <img> 的 onError 里退回卡面头像。后端带 ETag,换了立绘自己会更新;
 * 同一页里换了包时传 version(比如当前包 id),换个地址,免得浏览器直接用内存里的旧图
 */
export function cardFaceUrl(cardId: string, size = 96, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : '';
  return `${BASE_URL}/api/tavern/cards/${cardId}/sprites/face?size=${size}${v}`;
}

// ---- 场景包 ----

/** cg:CG 插件的事件插图(构图);构图下面挂的差分也是 cg,parent_id 指向构图 */
export type SceneKind = 'bg' | 'bgm' | 'cg';

export interface ScenePack {
  id: string;
  name: string;
  description: string;
  bg_count: number;
  bgm_count: number;
  /** CG 构图的张数(不算差分);后端是旧版时没有 */
  cg_count?: number;
  /** 绑了这个包的卡有几张 */
  card_count: number;
  /** 标题画面(封面)放的那首 BGM;null = 放排第一的 */
  title_bgm_id: string | null;
}

export interface SceneAsset {
  id: string;
  pack_id: string;
  kind: SceneKind;
  /** AI 写在标签里的名字 */
  label: string;
  aliases: string[];
  /** 给 AI 看的说明,{{backgrounds}} / {{bgms}} 宏会带上它 */
  description: string;
  has_file: boolean;
  mime: string | null;
  /** 文件字节数 */
  size: number;
  /** 文件版本号,拼进 URL 当缓存键 */
  file_version: number;
  /** 仅背景:竖屏时对准横图的哪儿,0 最左 100 最右 */
  focus_x: number;
  /** 仅背景:换到这个场景时自动换上的 BGM(CG 不带曲子) */
  bgm_id: string | null;
  /** 同类里排第一的是默认 */
  sort: number;
  /** 关掉 = 游戏里当它不存在,文件留在包里 */
  enabled: boolean;
  /** CG 差分:它属于哪张 CG(名字是立绘的表情名);其余素材是 null。后端是旧版时没有 */
  parent_id?: string | null;
}

export interface SceneAssetPatch {
  label?: string;
  aliases?: string[];
  description?: string;
  focus_x?: number;
  /** null = 不要默认曲 */
  bgm_id?: string | null;
  enabled?: boolean;
}

/** 素材文件的地址;还没传文件时返回 null */
export function sceneFileUrl(a: SceneAsset): string | null {
  if (!a.has_file) return null;
  return `${BASE_URL}/api/scene-packs/${a.pack_id}/assets/${a.id}/file?v=${a.file_version}`;
}

/** 游戏里显示的背景 / CG:压成 WebP(见 SCENE_WIDTH);BGM 原样 */
export function sceneImageUrl(a: SceneAsset): string | null {
  return a.kind === 'bgm' ? sceneFileUrl(a) : sceneThumbUrl(a, SCENE_WIDTH);
}

/** 背景 / CG 缩到 w 宽的 WebP(插件页缩略图用;后端 16–1024) */
export function sceneThumbUrl(a: SceneAsset, w: number): string | null {
  const url = sceneFileUrl(a);
  return url && `${url}&w=${w}`;
}

// ---- 语音插件 ----

export type TtsApiType = 'gpt_sovits' | 'indextts';

export interface TtsConnection {
  id: string;
  name: string;
  api_type: TtsApiType;
  base_url: string;
  /** GSV 的采样步数;IndexTTS 不用 */
  sample_steps: number;
  /** IndexTTS 的情绪强度 0–1;GSV 不用 */
  emo_alpha: number;
  /** 用这个服务的声音有几个 */
  profile_count: number;
}

export type TtsConnectionPatch = Partial<Pick<TtsConnection, 'name' | 'base_url' | 'sample_steps' | 'emo_alpha'>>;

/**
 * 一种情绪,名字和立绘表情名对上时用它,排第一的是默认。
 * GSV:一段参考音频 + 原文。IndexTTS:可选的情绪参考,或者一组向量
 */
export interface VoiceEmotion {
  id: string;
  profile_id: string;
  label: string;
  aliases: string[];
  /** 语音服务那台机器上的路径 */
  ref_path: string;
  prompt_text: string;
  /** GSV 的辅助参考路径:音色和主参考一起取平均,语气还跟主参考走(v3 / v4 模型不认) */
  aux_refs: string[];
  /** IndexTTS 的 8 维情绪向量(顺序见 plugins/voice.ts 的 EMO_DIMS);null = 不用向量 */
  emo_vector: number[] | null;
  sort: number;
}

export type TextSplitMethod = 'cut0' | 'cut1' | 'cut2' | 'cut3' | 'cut4' | 'cut5';

/**
 * 一个声音调过的合成参数,只有调过的项;没有的用默认(采样步数、情绪强度跟语音服务)。
 * 每项的范围和说明见 plugins/voice.ts 的 GSV_PARAMS
 */
export interface VoiceParams {
  sample_steps?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  text_split_method?: TextSplitMethod;
  fragment_interval?: number;
  parallel_infer?: boolean;
  /** IndexTTS */
  emo_alpha?: number;
}

/** 试音台:这一句整组换掉声音存着的语速、语言和参数 */
export interface VoiceTuning {
  speed: number;
  text_lang: string;
  params: VoiceParams;
  /** 固定随机种子(只有 GSV 认);null = 每次随机 */
  seed: number | null;
}

export interface VoiceProfile {
  id: string;
  name: string;
  aliases: string[];
  connection_id: string;
  gpt_weights: string;
  sovits_weights: string;
  /** IndexTTS 的音色参考(语音服务那台机器上的路径);GSV 不用 */
  ref_path: string;
  text_lang: string;
  speed: number;
  params: VoiceParams;
  emotions: VoiceEmotion[];
  card_count: number;
}

export type VoiceProfilePatch = Partial<
  Pick<
    VoiceProfile,
    | 'name'
    | 'aliases'
    | 'connection_id'
    | 'gpt_weights'
    | 'sovits_weights'
    | 'ref_path'
    | 'text_lang'
    | 'speed'
    | 'params'
  >
>;

export type VoiceEmotionPatch = Partial<
  Pick<VoiceEmotion, 'label' | 'aliases' | 'ref_path' | 'prompt_text' | 'aux_refs' | 'emo_vector'>
>;

/** 一张卡用哪些声音(id):主声音念角色自己的台词,其他的按说话人名字对上才念 */
export interface CardVoices {
  main: string | null;
  extras: string[];
}

export interface SpeakRequest {
  profile_id: string;
  /** 这句生效的立绘表情名;null = 默认情绪 */
  emotion: string | null;
  text: string;
}

/** 这句的情绪从哪来:ref = 参考音频,vector = 向量,none = 沿用音色参考的语气 */
export type EmoMode = 'ref' | 'vector' | 'none';

export interface SpeakResult {
  audio: ArrayBuffer;
  cache: 'hit' | 'miss';
  /** 后端实际用的情绪名(对不上时是默认情绪) */
  emotion: string;
  /** 后端实际用的情绪方式 */
  mode: EmoMode;
  /** 从发出请求到收完音频的毫秒数 */
  ms: number;
}

/** 一句语音的来龙去脉(/api/tts/explain),排查语音用 */
export interface VoiceExplain {
  profile_name: string;
  connection_name: string;
  api_type: TtsApiType;
  /** 要的情绪(立绘表情名);没传是 null */
  wanted: string | null;
  /** 实际用的情绪行;IndexTTS 没有情绪行时是空串 */
  emotion: string;
  /** exact 名字对上 / alias 别名对上 / nearest 模型挑的最像的 / default 没传或对不上,用排第一的 */
  how: 'exact' | 'alias' | 'nearest' | 'default';
  /** alias:对上的别名;nearest:模型认为最像的那个名字 */
  via: string | null;
  /** nearest:相似度 */
  score: number | null;
  mode: EmoMode;
  /** GSV 的模型权重(IndexTTS 为空串) */
  gpt_weights: string;
  sovits_weights: string;
  /** 发给语音服务的请求体,原样 */
  request: Record<string, unknown>;
  /** 缓存里已经有这句 */
  cached: boolean;
}
