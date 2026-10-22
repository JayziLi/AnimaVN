import { SCENE_WIDTHS, SPRITE_WIDTHS } from '../generated/contracts';
import type { AnnotateRequest, AnnotateResponse } from '../plugins/jevRun';
import type { AssemblyResult } from './assembler';
import type { StoredChatMessage } from './chatEntry';
import { saveResponse, type SavedFile } from './download';

/** 地址、模型名从哪来:环境变量 / Jev 页里填的 / 官方默认 */
export type JevEndpointSource = 'env' | 'settings' | 'default';

/** Jev 的 key 设了没有、从哪来(环境变量 / Jev 页),连的哪个地址、哪个模型名。后端是旧版时没有地址那几项 */
export interface JevKeyStatus {
  has_key: boolean;
  source: 'env' | 'settings' | null;
  url?: string;
  model?: string;
  url_source?: JevEndpointSource;
  model_source?: JevEndpointSource;
  default_url?: string;
  default_model?: string;
}

/** Jev 用了多少:只数 token 不算钱(走中转的价格各不一样) */
export interface JevUsageTotal {
  requests: number;
  tokens: number;
}
export interface JevUsage {
  today: JevUsageTotal;
  /** 这 7 天(含今天) */
  week: JevUsageTotal;
  month: JevUsageTotal;
  all: JevUsageTotal;
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
// 换网络不用改配置。部署时配成空串 = 同源,走 nginx 反代。
// 没有地址栏(node 里跑测试)时当作 localhost:卡带会在加载时 import 这里,测试 import 登记处时不能崩
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  `http://${typeof location === 'undefined' ? 'localhost' : location.hostname}:8000`;

/** 后端回的错:带着状态码,调用方能分「设置不对」(4xx)和「服务出了问题」(5xx) */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** FastAPI 的错误体是 {detail: "..."},取出来当消息;取不到就退回状态码 */
async function failure(res: Response): Promise<ApiError> {
  return errorOf(res.status, res.statusText, await res.text().catch(() => ''));
}

/** failure 的本体:XMLHttpRequest 发的请求(要上传进度的导入)也用它 */
function errorOf(status: number, statusText: string, body: string): ApiError {
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
  return new ApiError(detail || `${status} ${statusText}`, status);
}

/**
 * 合成一句最多等多久。冷启动(服务刚开、换权重)实测约 40 秒;卡住的那句到点就算失败,
 * 不会让后面的句子一直排着(P21)。后端那边照常合成完、进缓存,重播时直接命中
 */
export const SPEAK_TIMEOUT_MS = 60_000;

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

/** 卡带自己的接口用它发请求:地址、出错时的消息和 debugApi 一样 */
export const apiRequest = request;

/** 后端的完整地址(卡带的音频链接一类) */
export const apiUrl = (path: string) => `${BASE_URL}${path}`;

export { filenameFromDisposition } from './download';

/** 后端返回 attachment 的下载:拉成 blob,再从 Content-Disposition 取文件名存盘 */
async function downloadAttachment(url: string, fallbackName: string, init?: RequestInit): Promise<SavedFile> {
  const res = await fetch(url, init);
  if (!res.ok) throw await failure(res);
  return saveResponse(res, fallbackName);
}

/**
 * 导入计划的上传。用 XMLHttpRequest 不用 fetch:fetch 报不了上传进度,一个文件夹 250 MB 要传好几秒。
 * 出错和 request 一样抛 ApiError(连不上是状态码 0);取消抛 AbortError
 */
function uploadImport(
  files: ImportUpload[],
  opts: ImportPlanOptions,
  onProgress?: (sent: number, total: number) => void,
): Promise<ImportPlan> {
  const form = new FormData();
  for (const f of files) form.append('files', f.file, f.file.name);
  form.append('paths', JSON.stringify(files.map((f) => f.path)));
  if (opts.targetCardId) form.append('target_card_id', opts.targetCardId);
  if (opts.kind) form.append('kind', opts.kind);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const aborted = () => reject(new DOMException('导入已取消', 'AbortError'));
    if (opts.signal?.aborted) {
      aborted();
      return;
    }
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.open('POST', `${BASE_URL}/api/import/plan`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.upload.onload = (e) => onProgress(e.total || e.loaded, e.total || e.loaded);
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(errorOf(xhr.status, xhr.statusText, xhr.responseText));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as ImportPlan);
      } catch {
        reject(new ApiError('后端回的导入计划读不出来', xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('连不上后端', 0));
    xhr.onabort = aborted;
    xhr.send(form);
  });
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
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  const decoder = new TextDecoder();
  let buffer = '';

  // 中途抛错(error 帧、解析失败)时把连接关掉,别让它挂着等后端自己断
  let ended = false;
  signal?.addEventListener('abort', cancelReader, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done: finished } = await reader.read();
      signal?.throwIfAborted();
      if (finished) {
        ended = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        signal?.throwIfAborted();
        const { event, data } = parseFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        const payload: unknown = data ? JSON.parse(data) : {};

        if (event === 'meta') handlers.onMeta?.(payload as StreamMeta);
        else if (event === 'reasoning') handlers.onReasoning?.((payload as { text: string }).text);
        else if (event === 'delta') handlers.onDelta?.((payload as { text: string }).text);
        else if (event === 'done') return payload as StreamDone;
        else if (event === 'error') throw new Error((payload as { message: string }).message);

        split = buffer.indexOf('\n\n');
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    if (!ended) void reader.cancel().catch(() => undefined);
  }

  throw new Error('流意外中断——没有收到结束帧');
}

export interface HealthResult {
  status: string;
  version: string;
  /** 迁移器这次启动的结果(app/migrations);老后端没有这个字段 */
  db?: string;
}

/** 设置页「数据」一栏:迁移器这次启动的结果、上次整库备份(GET /api/meta/migrations) */
export interface MigrationStatus {
  app_version: string;
  mode: 'report' | 'apply' | 'off';
  status: 'ok' | 'pending' | 'blocked' | 'failed' | 'skipped';
  message: string;
  applied: number;
  detected: number;
  pending: { id: string; title: string }[];
  unknown: { id: string; title: string; compat: string }[];
  last_backup: BackupInfo | null;
}

export interface BackupInfo {
  name: string;
  at: string;
  size: number;
}

/** 设置页「数据」一栏:文件仓库(AnimaBackend/app/storage)的概况(GET /api/meta/storage) */
export interface StorageStatus {
  /** 开关 storage_files:关着时一律从库里读 */
  enabled: boolean;
  files: number;
  bytes: number;
  /** 库里有原件、还没复制进仓库的 */
  pending: number;
  trash_bytes: number;
  /** 库文件多大;不是文件库时 null */
  db_bytes: number | null;
  /** 后台复制任务;还没跑过是 null */
  copy: { state: 'pending' | 'running' | 'done' | 'failed'; done: number; total: number; message: string } | null;
}

export interface StorageCleanResult {
  kept: number;
  moved: number;
  moved_bytes: number;
  /** 没人用、但放进来不到 24 小时的 */
  young: number;
  /** 回收区里过了 30 天删掉的 */
  purged: number;
}

export interface StorageCheckResult {
  ok: boolean;
  checked: number;
  /** 「表名 id」 */
  missing: string[];
  /** missing 里库中还有原件、下次启动会补回的个数 */
  restorable: number;
  damaged: string[];
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
  /** 是哪张主卡的状态卡(素材架构 3.5);主卡和普通的卡是 null。旧后端没有 */
  state_of?: string | null;
}

/** 状态组(GET /api/tavern/cards/{id}/states):主卡、各状态卡的名字和顺序;不在组里时 group_id 是 null */
export interface StateGroup {
  group_id: string | null;
  main_card_id: string | null;
  states: { card_id: string; name: string; sort: number; show_in_pick: boolean }[];
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
  migrations: () => request<MigrationStatus>('/api/meta/migrations'),
  storage: () => request<StorageStatus>('/api/meta/storage'),
  backupNow: () => request<BackupInfo>('/api/meta/backup', { method: 'POST' }),
  cleanStorage: () => request<StorageCleanResult>('/api/meta/storage/clean', { method: 'POST' }),
  checkStorage: (deep = false) =>
    request<StorageCheckResult>(`/api/meta/storage/check${deep ? '?deep=true' : ''}`, { method: 'POST' }),

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

  // ---- 认词记录(素材架构第 1b 期;设置 → 数据「表情认法」选了认词记录时用) ----

  emotionRecords: (listRef: string) =>
    request<{ list_ref: string; records: WordRecordOut[] }>(
      `/api/emotion/records?list_ref=${encodeURIComponent(listRef)}`,
    ),

  emotionResolve: (payload: { list_ref: string; words: string[] }) =>
    request<{ model: string | null; results: ResolveResult[] }>('/api/emotion/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  emotionRecordsSummary: () => request<RecordsSummary>('/api/emotion/records/summary'),

  /** 以后这个词都认成名单里的这一项(第 1d 期,检查器、认词记录页):有就改、没有就新加,来源记「你改的」 */
  putWordRecord: (payload: { list_ref: string; word: string; item: string }) =>
    request<WordRecordOut>('/api/emotion/records', { method: 'PUT', body: JSON.stringify(payload) }),

  /** 删一条认词记录:这个词下次出现时重新认;没有这一条是 404 */
  deleteWordRecord: (listRef: string, word: string) =>
    request<void>(
      `/api/emotion/records?list_ref=${encodeURIComponent(listRef)}&word=${encodeURIComponent(word)}`,
      { method: 'DELETE' },
    ),

  // ---- 配对表(素材架构第 1c 期;「表情认法」选了认词记录时,语音按它挑那一行语气、CG 按它挑那一帧) ----

  /** 一份名单的共用配对表(只给某张卡另存的表不回),按 target 排;给了 target 只回那一张 */
  pairings: (follower: PairingFollower, listRef: string, target?: string) =>
    request<PairingTableOut[]>(
      `/api/pairings?follower=${follower}&list_ref=${encodeURIComponent(listRef)}` +
        (target === undefined ? '' : `&target=${encodeURIComponent(target)}`),
    ),

  /** 改配对表的一格(第 1d 期;没有就新加):来源默认「你改的」,采纳聊天模型的建议时传 chat */
  putPairingCell: (pairingId: string, item: string, payload: PairingCellIn) =>
    request<PairingCellOut>(`/api/pairings/${pairingId}/cells/${encodeURIComponent(item)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** 缺格补配:名单里这张表还没有的项当场补上(表不在先建),已有的格子一条不动 */
  fillPairings: (payload: { follower: PairingFollower; list_ref: string; target: string }) =>
    request<PairingFillOut>('/api/pairings/fill', { method: 'POST', body: JSON.stringify(payload) }),

  /** 「让模型重配」会发出去什么:字数和原文。不发请求、不花钱 */
  pairingEstimate: (pairingId: string) => request<PairingEstimate>(`/api/pairings/${pairingId}/estimate`),

  /** 让聊天模型把这张表重配一遍(花钱:只在玩家点了按钮以后调)。只回建议、不改表;不给连接用当前的聊天连接 */
  suggestPairings: (pairingId: string, connectionId?: string) =>
    request<PairingSuggestOut>(`/api/pairings/${pairingId}/suggest`, {
      method: 'POST',
      body: JSON.stringify(connectionId ? { connection_id: connectionId } : {}),
    }),

  // ---- Jev 标注(plugins/jev.ts) ----

  annotateLines: (req: AnnotateRequest, signal?: AbortSignal) =>
    request<AnnotateResponse>('/api/annotate/lines', {
      method: 'POST',
      body: JSON.stringify(req),
      signal,
    }),

  /**
   * 只拼题、不问 Jev(插件抽屉「高级 · 问法」):请求和 annotateLines 一样,只出第一个要判的句子的题,
   * 回题名(e1、bg1……)→ 问法和选项,和真发给 Jev 的一样。不要 key、不记用量
   */
  annotatePreview: (req: AnnotateRequest, signal?: AbortSignal) =>
    request<{ prompts: Record<string, string> }>('/api/annotate/preview', {
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

  /** Jev 的地址和模型名(走中转时填);空串 = 用官方的 */
  setJevEndpoint: (url: string, model: string) =>
    request<void>('/api/annotate/endpoint', { method: 'PUT', body: JSON.stringify({ url, model }) }),

  /** 用了多少 token:今天、这 7 天、这个月、全部 */
  annotateUsage: () => request<JevUsage>('/api/annotate/usage'),

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

  /**
   * 这张卡的场景包分两栏(第 1 步):出背景的、出曲子的,各按顺序;一个包可能两边都在。
   * 旧后端没有这个接口:读旧接口那一个包,两边都用它
   */
  getCardScenePacks: async (cardId: string): Promise<CardSceneParts> => {
    try {
      const r = await request<CardSceneParts>(`/api/tavern/cards/${cardId}/scene-packs`);
      return { bg: r.bg, bgm: r.bgm };
    } catch (e) {
      const old = await request<{ pack_id: string | null }>(`/api/tavern/cards/${cardId}/scene-pack`).catch(() => {
        throw e;
      });
      return old.pack_id ? { bg: [old.pack_id], bgm: [old.pack_id] } : { bg: [], bgm: [] };
    }
  },

  /** 整组替换两栏;返回读回来的样子(两栏共用一个先后:背景的在前,只出曲子的接在后面) */
  setCardScenePacks: async (cardId: string, v: CardSceneParts): Promise<CardSceneParts> => {
    const r = await request<CardSceneParts>(`/api/tavern/cards/${cardId}/scene-packs`, {
      method: 'PUT',
      body: JSON.stringify({ bg: v.bg, bgm: v.bgm }),
    });
    return { bg: r.bg, bgm: r.bgm };
  },

  /** 这张卡所在的状态组(素材架构 3.5);不在组里时 group_id 是 null */
  cardStates: (cardId: string) => request<StateGroup>(`/api/tavern/cards/${cardId}/states`),

  // ---- CG 包(素材架构第 4 期;包里的 CG 和场景素材同一个形状,kind = cg、source = cg) ----

  listCgPacks: async () => (await request<CgPack[]>('/api/cg-packs')).map(cgPackOf),

  createCgPack: async (name: string, description = '') =>
    cgPackOf(await request<CgPack>('/api/cg-packs', { method: 'POST', body: JSON.stringify({ name, description }) })),

  updateCgPack: async (packId: string, patch: { name?: string; description?: string }) =>
    cgPackOf(await request<CgPack>(`/api/cg-packs/${packId}`, { method: 'PUT', body: JSON.stringify(patch) })),

  deleteCgPack: (packId: string) => request<void>(`/api/cg-packs/${packId}`, { method: 'DELETE' }),

  listCgAssets: (packId: string) => request<SceneAsset[]>(`/api/cg-packs/${packId}/assets`),

  createCgAsset: (
    packId: string,
    payload: { label: string; aliases?: string[]; description?: string; /** 差分带:挂在哪张构图下面 */ parent_id?: string },
  ) => request<SceneAsset>(`/api/cg-packs/${packId}/assets`, { method: 'POST', body: JSON.stringify(payload) }),

  updateCgAsset: (packId: string, assetId: string, patch: SceneAssetPatch) =>
    request<SceneAsset>(`/api/cg-packs/${packId}/assets/${assetId}`, { method: 'PUT', body: JSON.stringify(patch) }),

  deleteCgAsset: (packId: string, assetId: string) =>
    request<void>(`/api/cg-packs/${packId}/assets/${assetId}`, { method: 'DELETE' }),

  /** 一个 CG 包里全部构图的新顺序(差分不在里面) */
  reorderCgAssets: (packId: string, ids: string[]) =>
    request<SceneAsset[]>(`/api/cg-packs/${packId}/assets/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),

  uploadCgFile: async (packId: string, assetId: string, file: Blob): Promise<SceneAsset> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/api/cg-packs/${packId}/assets/${assetId}/file`, { method: 'PUT', body: form });
    if (!res.ok) throw await failure(res);
    return res.json() as Promise<SceneAsset>;
  },

  /** 这张卡绑的 CG 包,按顺序(构图重名时取排前面的) */
  getCardCgPacks: async (cardId: string): Promise<string[]> =>
    (await request<{ pack_ids: string[] }>(`/api/tavern/cards/${cardId}/cg-packs`)).pack_ids,

  setCardCgPacks: (cardId: string, packIds: string[]) =>
    request<{ pack_ids: string[] }>(`/api/tavern/cards/${cardId}/cg-packs`, {
      method: 'PUT',
      body: JSON.stringify({ pack_ids: packIds }),
    }),

  // ---- 导入(素材架构第 1 步第 3 段):拖进来就认,先出计划、确认以后执行,能撤销 ----

  /**
   * 上传拖进来的文件、出导入计划。paths 和文件一一对应(带最上面那层文件夹名);
   * 拖到某张卡上给 targetCardId,拖到素材页的某一栏给 kind。onProgress 报上传了多少字节(传完那一下 sent = total)
   */
  importPlan: (files: ImportUpload[], opts: ImportPlanOptions = {}, onProgress?: (sent: number, total: number) => void) =>
    uploadImport(files, opts, onProgress),

  /** 照计划执行:decisions 只给重复的那几组,classify 只给选了类型的文件 */
  importApply: (planId: string, body: ImportApplyBody) =>
    request<ImportResult>(`/api/import/${encodeURIComponent(planId)}/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * 不导了(确认框点取消、什么都没认出来):后端马上删掉这次的暂存文件(一个角色文件夹几百 MB,不然要放 7 天)。
   * 204;计划不在了 404、已经执行过了 409
   */
  importDiscard: (planId: string) =>
    request<void>(`/api/import/${encodeURIComponent(planId)}`, { method: 'DELETE' }),

  /** 导完以后在提示条里认领一个没认出来的文件(暂存路径);返回更新过的提示 */
  importClassify: (jobId: string, path: string, kind: ClassifyKind) =>
    request<ImportResult>(`/api/import/jobs/${encodeURIComponent(jobId)}/classify`, {
      method: 'POST',
      body: JSON.stringify({ path, kind }),
    }),

  /** 最近 50 次导入,新的在前 */
  importJobs: () => request<ImportJobSummary[]>('/api/import/jobs'),

  /** 撤销会删 / 拿掉 / 改回什么(确认框用) */
  importUndoPreview: (jobId: string) =>
    request<ImportUndoPreview>(`/api/import/jobs/${encodeURIComponent(jobId)}/undo-preview`),

  importUndo: (jobId: string) =>
    request<ImportUndoPreview>(`/api/import/jobs/${encodeURIComponent(jobId)}/undo`, { method: 'POST' }),

  // ---- 导出(素材架构第 3 步;后端 app/api/export.py) ----

  /** 导出面板要列的:会带上哪些包、各多大、建议的预设、能当预览图的几张 */
  exportBundleSummary: (cardId: string) =>
    request<ExportBundleSummary>(`/api/export/bundle/${encodeURIComponent(cardId)}/summary`),

  /** 导出角色包(.animavn)并存到本地;fallbackName 是后端没给文件名时用的 */
  exportBundle: (cardId: string, body: ExportBundleBody, fallbackName = 'character.animavn') =>
    downloadAttachment(`${BASE_URL}/api/export/bundle/${encodeURIComponent(cardId)}`, fallbackName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** 导出一个包(.animapack)并存到本地 */
  exportPack: (kind: ExportPackKind, packId: string, fallbackName = 'pack.animapack') =>
    downloadAttachment(exportPackUrl(kind, packId), fallbackName),

  // ---- 全局设置(插件配置) ----

  /** 没存过返回 null,由调用方用默认值 */
  getSetting: async <T,>(key: string): Promise<T | null> =>
    (await request<{ value: T | null }>(`/api/settings/${key}`)).value,

  putSetting: <T,>(key: string, value: T) =>
    request<{ key: string; value: T }>(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  // ---- 按卡设置(一张卡在全局插件设置之上另外改的几项,合并见 plugins/cardPrefs.ts) ----

  /** 这张卡另设过的全部项:{设置的键: 改了的字段};一项都没设过是 {} */
  cardPrefs: (cardId: string) => request<CardPrefs>(`/api/tavern/cards/${cardId}/prefs`),

  /** 整份换掉这一项改了的字段(后端不和上次存的合并):每次都发这张卡现在改了的全部字段 */
  putCardPref: (cardId: string, key: string, value: CardPrefValue) =>
    request<{ key: string; value: CardPrefValue }>(`/api/tavern/cards/${cardId}/prefs/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  /** 这一项不再另设,回到全局;这张卡本来就没另设这一项时后端回 404 */
  deleteCardPref: (cardId: string, key: string) =>
    request<void>(`/api/tavern/cards/${cardId}/prefs/${key}`, { method: 'DELETE' }),

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

  /** 「导出这些文件」:这个声音的参考和模型打成 zip(refs/、models/,原文件名)存到本地(第 4 步) */
  voiceFilesZip: (id: string, fallbackName = 'voice-files.zip') =>
    downloadAttachment(`${BASE_URL}/api/voices/${encodeURIComponent(id)}/files.zip`, fallbackName),

  /** 「已放好」:文件已经拷到语音机的 folder 下(refs/、models/),路径改成那边的;回改好的声音 */
  placeVoiceFiles: (id: string, folder: string) =>
    request<VoiceProfile>(`/api/voices/${encodeURIComponent(id)}/placed`, {
      method: 'POST',
      body: JSON.stringify({ folder }),
    }),

  /**
   * 贴进来的 refs.json(已经 JSON.parse 过)。清单带着声音编号就合进那个声音;
   * 没带、又有同名的声音时后端回 409(ApiError),按 onConflict 再发一次:更新那个 / 另建一个
   */
  importVoice: (connectionId: string, refs: unknown, onConflict?: 'update' | 'new') =>
    request<VoiceProfile>('/api/voices/import', {
      method: 'POST',
      body: JSON.stringify({ connection_id: connectionId, refs, ...(onConflict && { on_conflict: onConflict }) }),
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
    try {
      const res = await fetch(`${BASE_URL}/api/tts/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...(fresh && { fresh }), ...(tuning && { tuning }) }),
        signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS),
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
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        throw new Error(`语音合成超过 ${SPEAK_TIMEOUT_MS / 1000} 秒没回来,这句先跳过`);
      }
      throw e;
    }
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
  /** 图在文件仓库里的指纹;有它时从 /api/blobs/<指纹> 取图(见 blobUrl)。还没复制进去、旧后端是 null / 没有 */
  image_sha?: string | null;
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

/** 认词记录里的一条(GET /api/emotion/records) */
export interface WordRecordOut {
  word: string;
  /** 名单里的哪一项:立绘的 id / 内置表情的名字 */
  item: string;
  /** migrated 迁移时按旧结果 / model 模型认过一次 / rename 改名留下的 / player 你改的 */
  source: string;
  guessed: boolean;
  unstable: boolean;
  score: number | null;
}

/** POST /api/emotion/resolve 的一条结果 */
export interface ResolveResult {
  word: string;
  key: string;
  label: string;
  /** name 名字或别名对上 / record 认词记录 / model 模型这次认的(后端已经记进认词记录) */
  how: 'name' | 'record' | 'model';
  source: string | null;
  score: number | null;
}

/** 设置 → 数据:认词记录一共几条、各来源几条 */
export interface RecordsSummary {
  total: number;
  /** 来自几份表情名单 */
  lists: number;
  by_source: Record<string, number>;
}

/** 配对表跟着谁:voice 声音的一行语气 / cg CG 构图的一张差分 */
export type PairingFollower = 'voice' | 'cg';

/** 配对表的一格(GET /api/pairings) */
export interface PairingCellOut {
  /** 名单里的一项(立绘的 id) */
  item: string;
  /** 声音的一行语气 / CG 的一张差分;CG 是 null = 用构图本身那张 */
  value: string | null;
  /** migrated 迁移时按旧结果 / name 名字对上 / chat 聊天模型配的 / jev / local 本地模型 / player 你改的 */
  source: string;
  /** 今天是认词模型猜的 / 待重配 / 今天的结果本来就随批次变 */
  guessed: boolean;
  pending: boolean;
  unstable: boolean;
}

/** 一张共用的配对表:一份表情名单(立绘包)→ 一个声音 / 一张 CG 构图 */
export interface PairingTableOut {
  id: string;
  follower: PairingFollower;
  list_ref: string;
  /** 声音的 id / CG 构图的 id */
  target: string;
  /** 用这张表的卡(按卡 id 排) */
  cards: string[];
  /** 按名单项排 */
  cells: PairingCellOut[];
}

/** PUT /api/pairings/{id}/cells/{item} 的请求体 */
export interface PairingCellIn {
  /** voice:这个声音的一行语气(不能空);cg:这张构图的一张差分,null = 用构图本身那张 */
  value: string | null;
  /** player 你改的(不传就是它) / chat 采纳了聊天模型的建议 */
  source?: 'player' | 'chat';
}

/** POST /api/pairings/fill 的结果 */
export interface PairingFillOut {
  table_id: string;
  /** 这次新加的格子,按名单的顺序 */
  added: PairingCellOut[];
  /** 没补上的(本地认词模型用不了等),下次再补 */
  skipped: { item: string; reason: string }[];
}

/** GET /api/pairings/{id}/estimate:「让模型重配」会发出去的 */
export interface PairingEstimate {
  /** 发出去的字数(就是 prompt 的长度) */
  chars: number;
  /** 发给模型的原文 */
  prompt: string;
}

/** 聊天模型建议改的一格 */
export interface PairingSuggestion {
  item: string;
  /** 表里现在配的;new 时是 null */
  current: string | null;
  /** 模型建议的;CG 是 null = 用构图本身那张 */
  suggested: string | null;
  /** 表里还没有这一格:采纳就是新加 */
  new: boolean;
}

/** POST /api/pairings/{id}/suggest 的结果 */
export interface PairingSuggestOut {
  /** 只列和现在不一样的(表里还没有的格子也列),按名单的顺序 */
  suggestions: PairingSuggestion[];
  /** 模型漏了没配的项 */
  unanswered: string[];
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
 * 宽度前后端共用(后端按这几个宽度预先转好),定义在 AnimaBackend/app/contracts.py
 */
const COARSE = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const SPRITE_WIDTH = COARSE ? SPRITE_WIDTHS.touch : SPRITE_WIDTHS.desktop;
/** 背景 / CG:游戏里铺满屏幕,电脑 1920、手机 1280 宽就够 */
const SCENE_WIDTH = COARSE ? SCENE_WIDTHS.touch : SCENE_WIDTHS.desktop;

/**
 * 文件仓库里的文件按指纹取(AnimaBackend/app/api/blobs.py):内容不变地址就不变,
 * 同一张图挂在几个包里也只下一次。w:图片缩到这个宽度的 WebP
 */
function blobUrl(sha: string, w?: number): string {
  return `${BASE_URL}/api/blobs/${sha}${w ? `?w=${w}` : ''}`;
}

/** 在已有的地址后面接一个查询参数(地址本身可能带 ? 也可能不带) */
function withParam(url: string, param: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${param}`;
}

/** <img src> 直接用的地址。有指纹走文件仓库;没有时带版本号:换图后 URL 变,浏览器就不会继续显示缓存里的旧图 */
export function spriteImageUrl(s: PackSprite): string | null {
  if (!s.has_image) return null;
  if (s.image_sha) return blobUrl(s.image_sha, SPRITE_WIDTH);
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
  /** 包里的 CG 拆成了哪个 CG 包(第 4 期);null / 没有 = 没拆过,包里的 CG 照旧跟着场景包走 */
  cg_pack_id?: string | null;
}

/** 一张卡的场景包分两栏(第 1 步):bg 出背景、bgm 出曲子,各按顺序;一个包可能两边都在 */
export interface CardSceneParts {
  bg: string[];
  bgm: string[];
}

/** CG 包(第 4 期):一个角色在一个场景里的一组 CG,单独绑到卡上,可以叠几个 */
export interface CgPack {
  id: string;
  name: string;
  description: string;
  /** 构图的张数(不算差分) */
  cg_count: number;
  card_count: number;
  /** 从哪个场景包拆出来的;改动会同步回那个场景包 */
  source_scene_pack_id: string | null;
  /** true = 生图收藏建的「AI 生图 · 卡名」包(卡编辑器里归「AI 生成」那一栏);旧后端没有这个字段,读进来时补成 false */
  generated: boolean;
}

/** 旧后端的 CG 包没有 generated:当导入的 */
function cgPackOf(p: CgPack): CgPack {
  return { ...p, generated: p.generated === true };
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
  /** 同 PackSprite.image_sha */
  data_sha?: string | null;
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
  /** 仅 CG 构图:在哪些形态里出(存形态的名字,由形态卡带定;没装形态卡带时不显示、不读);空 = 不限。后端是旧版时没有 */
  forms?: string[];
  /** 从哪来:scene 场景包 / cg CG 包(第 4 期);没有 = 场景包 */
  source?: 'scene' | 'cg';
}

export interface SceneAssetPatch {
  label?: string;
  aliases?: string[];
  description?: string;
  focus_x?: number;
  /** null = 不要默认曲 */
  bgm_id?: string | null;
  enabled?: boolean;
  /** 仅 CG 构图;[] = 不限 */
  forms?: string[];
}

/** 素材文件的地址;还没传文件时返回 null */
export function sceneFileUrl(a: SceneAsset): string | null {
  if (!a.has_file) return null;
  if (a.data_sha) return blobUrl(a.data_sha);
  const packs = a.source === 'cg' ? 'cg-packs' : 'scene-packs';
  return `${BASE_URL}/api/${packs}/${a.pack_id}/assets/${a.id}/file?v=${a.file_version}`;
}

/** 游戏里显示的背景 / CG:压成 WebP(见 SCENE_WIDTH);BGM 原样 */
export function sceneImageUrl(a: SceneAsset): string | null {
  return a.kind === 'bgm' ? sceneFileUrl(a) : sceneThumbUrl(a, SCENE_WIDTH);
}

/** 背景 / CG 缩到 w 宽的 WebP(插件页缩略图用;后端 16–1024) */
export function sceneThumbUrl(a: SceneAsset, w: number): string | null {
  const url = sceneFileUrl(a);
  return url && withParam(url, `w=${w}`);
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
  /**
   * 文件在哪(第 4 步):local = 本机文件仓库(导完就能念);pending = 导进来了、语音服务在另一台电脑,文件还没放过去;
   * manual = 手填的路径(原有的声音都是)。后端是旧版时没有,当 manual
   */
  files_at?: VoiceFilesAt;
}

export type VoiceFilesAt = 'local' | 'pending' | 'manual';

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

/** 按卡设置的一项:只放这张卡改了的那几个字段,比如 plugin.cg 的 {"jev": {"threshold": 0.75}} */
export type CardPrefValue = Record<string, unknown>;

/** 一张卡另设过的全部项:设置的键(plugin.cg 这类,和全局设置同一套) → 改了的字段 */
export type CardPrefs = Record<string, CardPrefValue>;

export interface SpeakRequest {
  profile_id: string;
  /** 这句生效的立绘表情名;null = 默认情绪 */
  emotion: string | null;
  text: string;
  /**
   * 表情认法 = 认词记录时,配对表挑好的那一行(声音的一行语气的 id);后端有它就直接用,不是这个声音的行当没传。
   * emotion 照旧填表情名(老后端、语音详情还看它)。旧算法时不带这个键
   */
  emotion_id?: string;
  /** 拆句拼接开着(卡带的 useSplice):后端有登记拼接的卡带、这个声音也用得上时,拼着念 */
  sfx?: boolean;
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
  /**
   * exact 名字对上 / alias 别名对上 / nearest 模型挑的最像的 / default 没传或对不上,用排第一的 /
   * pairing 配对表挑好的那一行(表情认法 = 认词记录时)
   */
  how: 'exact' | 'alias' | 'nearest' | 'default' | 'pairing';
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
  /** 拼接时的拆分(片段是这次现挑的,真正合成时会再挑一次);不拼时是 null。怎么显示由拼接的卡带定 */
  sfx?: SpliceSegment[] | null;
  /** 拼接用的素材的名字 */
  sfx_pack?: string | null;
}

/** 拼接时一句拆成的一段 */
export interface SpliceSegment {
  /** speech 交给模型念 / sfx 换成素材里的片段 */
  kind: 'speech' | 'sfx';
  text: string;
  category: string | null;
  clip_id: string | null;
  clip_text: string | null;
}

// ---- 导入(素材架构第 1 步第 3 段;后端 app/api/importer.py) ----

/** 拖到素材页的哪一栏:导入时一律按这一类认。声音、AI 生成那两栏不能拖文件进来 */
export type ImportKind = 'sprite' | 'bg' | 'bgm' | 'cg';
/** 没认出来的文件选成什么;skip = 不要了 */
export type ClassifyKind = ImportKind | 'skip';
/** 和库里一样的那几组怎么办:new 另存一份 / share 共用库里那份 / update 更新库里那张卡(只对卡) */
export type ImportDecision = 'new' | 'share' | 'update';

export interface ImportUpload {
  file: File;
  /** 相对路径,带最上面那层文件夹名(collectDrop 给的);单个文件就是文件名 */
  path: string;
}

export interface ImportPlanOptions {
  /** 拖到的那张卡 */
  targetCardId?: string | null;
  kind?: ImportKind | null;
  /** 上传中途取消 */
  signal?: AbortSignal;
}

/** 导入以后会建出来的一样东西 */
export interface ImportGroup {
  key: string;
  /** bundle = 一个角色包(.animavn),pack_file = 一个单包(.animapack):都照包里的清单另建一份 */
  type: 'card' | 'sprite_pack' | 'scene_pack' | 'cg_pack' | 'bundle' | 'pack_file';
  /** 建议的名字(撞名时执行那一步再加「 2」) */
  name: string;
  /** 卡 1;立绘张数;背景 + 曲子的数目;CG 构图数 */
  count: number;
  /** 绑到哪张卡:'card:N' = 这次一起导进来的卡(另一组的 key)、'target' = 拖到的那张卡、null = 不绑 */
  owner: string | null;
  /** 库里有一模一样的:包带上被几张卡用着(card_count),卡没有 */
  duplicate_of: { id: string; name: string; card_count?: number } | null;
  bg_count?: number;
  bgm_count?: number;
  /** CG 包:差分一共几张 */
  variant_count?: number;
  /** bundle 组是 ImportBundleDetail,pack_file 组是 ImportPackDetail;别的组没有 */
  detail?: ImportBundleDetail | ImportPackDetail;
}

/** 角色包、单包里的一个包(导入确认那一行) */
export interface ImportPackDetail {
  kind: ExportPackKind;
  name: string;
  /** 「14 张」「16 张背景、7 首 BGM」 */
  detail: string;
  /** 几张缩略图的地址(暂存目录里的,GET /api/import/{plan_id}/file?path=…) */
  thumbs: string[];
  /** 单包才有:文件多大 */
  bytes?: number;
  /** 单个声音包(kind = voice):里面那个声音 */
  voices?: ImportVoiceDetail[];
}

/** 角色包、声音包里的一个声音(导入确认那一行,第 4 步) */
export interface ImportVoiceDetail {
  name: string;
  /** 「12 段参考 + 2 个模型」 */
  detail: string;
  /** 默认导到哪个语音服务(第一个 GPT-SoVITS 连接);local = 地址是本机(127.0.0.1 / localhost);一个连接都没有是 null */
  connection: { id: string; name: string; local: boolean } | null;
  /** 包里缺几个文件(导出时语音机连不上):导入后只有设置 */
  missing: number;
}

/** 角色包(.animavn)里有什么:导入确认照它画 */
export interface ImportBundleDetail {
  /** 作者写的分享说明 */
  note: string;
  /** 作者选的预览图(暂存目录里的地址);没有是 null */
  preview: string | null;
  /** 会新建的卡:new_name 是撞名后接了「 2」的名字(没撞名就和 name 一样);state = 状态卡的状态名 */
  cards: { name: string; new_name: string; state: string | null }[];
  packs: ImportPackDetail[];
  /** 「认词记录 32 条」「配对表 2 张」 */
  follows: string[];
  /** 作者建议的预设;没带是 null */
  preset: { name: string } | null;
  has_voice: boolean;
  /** 包里的声音(第 4 步);后端是旧版时没有 */
  voices?: ImportVoiceDetail[];
  bytes: number;
}

export interface ImportPlan {
  plan_id: string;
  groups: ImportGroup[];
  /** 没认出来的文件(暂存目录里的路径,zip 已经解开) */
  unknown: string[];
  /** 跳过了什么,一句一条 */
  skipped: string[];
  /** 拖到了某张卡上、或者有和库里一样的:先弹确认框 */
  needs_confirm: boolean;
}

export interface ImportApplyBody {
  decisions?: Record<string, ImportDecision>;
  classify?: Record<string, ClassifyKind>;
  /** 拖到原有的卡上时,挂上以后直接换成这次的第一套立绘 */
  make_current?: boolean;
  /** 角色包 / 单包那一组的选项(组的 key → 选项):preset = 也导入作者建议的预设;connection_id = 声音导到哪个语音服务 */
  options?: Record<string, { preset?: boolean; connection_id?: string }>;
}

/** 素材页顶上那一行提示 */
export interface ImportNoticeData {
  title: string;
  detail: string;
  unknown: string[];
}

/** 一次导入新建的卡和包的编号,按建的先后(共用库里的不算;认领时新建的「补充」包也在里面) */
export interface ImportCreated {
  cards: string[];
  sprite_packs: string[];
  scene_packs: string[];
  cg_packs: string[];
  /** 导入角色包时另建的预设、状态组;后端是旧版时没有 */
  presets?: string[];
  state_groups?: string[];
  /** 这次新建的声音(第 4 步) */
  voices?: string[];
}

export interface ImportResult {
  job_id: string;
  /** 导完要打开的卡:新建的第一张,没有就是拖到的那张;都没有是 null */
  card_id: string | null;
  notice: ImportNoticeData;
  /** 一句一条的报告 */
  report: string[];
  /** 没有卡可开时照它打开素材管理页、选中第一个新建的包;后端是旧版时没有 */
  created?: ImportCreated;
}

/** 导入记录的数(后端 counts_of) */
export interface ImportJobCounts {
  cards: number;
  sprite_packs: number;
  scene_packs: number;
  cg_packs: number;
  /** 加到原有卡上的绑定 */
  bound: number;
  /** 资料被这次导入改过的原有卡 */
  updated_cards: number;
  /** 没认出来的文件 */
  unknown: number;
}

/** 导入记录一条(GET /api/import/jobs,最近 50 条,新的在前) */
export interface ImportJobSummary {
  id: string;
  created_at: string;
  /** 「刻晴.png + 3 个文件夹」 */
  title: string;
  status: 'done' | 'undone';
  /** 这次导入的主角卡(新建的或导进去的那张);没有是 null */
  card_id: string | null;
  counts: ImportJobCounts;
}

/** 撤销一次导入会做什么;撤销接口返回同样的东西(status 变成 undone) */
export interface ImportUndoPreview {
  job_id: string;
  title: string;
  status: 'done' | 'undone';
  /** 这次新建、撤销时要删的卡 */
  cards: { id: string; name: string }[];
  packs: { kind: 'sprite' | 'scene' | 'cg'; id: string; name: string; other_cards: { id: string; name: string }[] }[];
  unbind: {
    card_id: string;
    card_name: string;
    kind: string;
    target_id: string;
    target_name: string;
    parts: string | null;
  }[];
  /** 资料要改回导入前的原有卡 */
  restore_cards: { id: string; name: string }[];
  /** 一句一条,确认框照着列 */
  lines: string[];
}

// ---- 导出(素材架构第 3 步) ----

/** 单包导出的种类:背景和 BGM 是同一个场景包;voice = 声音(第 4 步) */
export type ExportPackKind = 'sprite' | 'scene' | 'cg' | 'voice';

/** 导出面板里一个包 */
export interface ExportBundleItem {
  /** 「sprite:<id>」:点掉时放进 exclude */
  key: string;
  kind: ExportPackKind;
  name: string;
  /** 「14 张」「16 张背景、7 首 BGM」 */
  detail: string;
  bytes: number;
  /** 立绘包:是不是现在用的那套 */
  current?: boolean;
  /** 缩略图地址(已有的缩略图接口);没有是 null */
  thumb: string | null;
  /** 声音:现在拿不到的文件数(语音机连不上、路径不让读);别的包没有 */
  missing?: number;
  /** 声音:黄字提醒,比如「只给自己用,别发给别人」;没有是 null */
  warn?: string | null;
}

/** 能当预览图的:卡头像,或者某张立绘 */
export type ExportPreview = { kind: 'avatar' } | { kind: 'sprite'; id: string };

/** GET /api/export/bundle/{card_id}/summary */
export interface ExportBundleSummary {
  title: string;
  /** 「刻晴.animavn」 */
  file_name: string;
  /** 卡头像(data URL);没有是 null */
  avatar: string | null;
  /** 一起带走的卡:有状态组时整组都在,main = 打开导出的那张 */
  cards: { id: string; name: string; state: string | null; main: boolean }[];
  /** 卡本身(连头像、世界书)多大 */
  card_bytes: number;
  items: ExportBundleItem[];
  /** 「认词记录 32 条」「配对表 2 张」「立绘位置和特效」 */
  follows: string[];
  /** 这张卡绑的预设;没绑是 null */
  preset: { id: string; name: string; bytes: number } | null;
  /** 能换的预览图,第一张是卡头像 */
  previews: (ExportPreview & { thumb?: string })[];
  /** 「人设」「对话记录」……(第 4 步起声音能带,这里不再有) */
  not_included: string[];
}

/** POST /api/export/bundle/{card_id} 的请求体 */
export interface ExportBundleBody {
  exclude: string[];
  preset: boolean;
  note: string;
  preview: ExportPreview;
}

/** 单包导出的地址(GET 直接回 .animapack 文件) */
export function exportPackUrl(kind: ExportPackKind, packId: string): string {
  return `${BASE_URL}/api/export/pack/${kind}/${encodeURIComponent(packId)}`;
}
