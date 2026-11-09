/** 生图卡带的接口(后端 app/plugins/imagegen/api.py) */

import { apiRequest } from '../../lib/api';
import type { VnImageNote } from '../../lib/chatEntry';
import type { LoraPick } from './loras';

export interface NaiAccount {
  /** 3 = Opus */
  tier: number | null;
  active: boolean;
  anlas: number;
  /** Opus 画 V5 的免费额度还剩百分之几 */
  v5_percent: number | null;
  v5_next_percent_s: number | null;
}

export interface ImageGenDefaults {
  skills: {
    manual: string;
    auto: string;
    look: string;
    note: string;
  };
  models: string[];
  quality: string;
  free_pixels: number;
  free_steps: number;
  /** 模型 → 反向预设 / 质量词 → 原文 */
  uc_presets: Record<string, Record<string, string>>;
  quality_presets: Record<string, Record<string, string>>;
}

export interface Person {
  who: string;
  tags: string;
  /** 这一刻穿的 */
  clothes?: string;
  /** 这一刻的长相(10-22 起指导模型写);没有 / null = 老的画面,拼提示词时照老规矩补卡上的长相和平时的衣服 */
  look?: string | null;
}

/** 一幅画面:指导模型写的、玩家在「先看提示词」里改过的 */
export interface Picture {
  scene: string;
  people: Person[];
  nsfw: boolean;
  /** 第一人称:玩家是镜头,不画玩家 */
  pov?: boolean;
  /** 一句英文的整体构图(接在场景标签后面) */
  composition?: string;
}

export interface Who {
  name: string;
  gender: 'female' | 'male';
  look: string;
  outfit?: string;
  player?: boolean;
}

export interface Drawn {
  line: number | null;
  title: string;
  description: string;
  /** 这一张里谁穿得和平时不一样 */
  clothes?: string;
}

export interface PlanRequest {
  mode: 'manual' | 'auto';
  connection_id: string | null;
  thinking: 'off' | 'conn';
  skill: string | null;
  cast: Who[];
  lines: { speaker: string | null; text: string }[];
  focus?: number | null;
  place?: string;
  want?: string;
  user_text?: string;
  since?: number | null;
  last?: string;
  /** 前后已经画过的图(接上连贯):line 是在 lines 里的编号,null = 上一条回复的,越界 = 这条回复更前 / 更后面 */
  drawn?: Drawn[];
  /** 上一条回复结束时的状态笔记;没有不传 */
  note?: VnImageNote | null;
  sfw_only?: boolean;
  /** 镜头:pov 第一人称 / third 第三人称 / auto 指导模型挑 */
  camera?: 'pov' | 'third' | 'auto';
}

export interface PlanResult {
  draw: boolean;
  at: number | null;
  /** 画面到第几句为止(手动时 useImageGen 已经换算成这条回复里的句号);null = 没写 */
  until?: number | null;
  importance: number;
  reason: string;
  /** 四到八个字的短名字 */
  title: string;
  description: string;
  picture: Picture;
  ms: number;
  connection: string;
}

/** 记一条回复的状态笔记 */
export interface NoteRequest {
  connection_id: string | null;
  thinking: 'off' | 'conn';
  skill: string | null;
  cast: Who[];
  lines: { speaker: string | null; text: string }[];
  /** 上一次的笔记;没有不传 */
  prev?: VnImageNote | null;
  place?: string;
  user_text?: string;
}

export interface NoteResult extends VnImageNote {
  ms: number;
  connection: string;
}

export interface RefIn {
  kind: 'sprite' | 'upload';
  /** 立绘 / 上传的编号;不传 = 当前立绘包的默认立绘 */
  id?: string | null;
  style?: boolean;
  /** 参考强度 0.3–1.0;不传 = 1 */
  strength?: number;
}

export interface LookIn {
  /** 卡上写的长相、平时的衣服:10-22 起只给老画面补(新画面照指导模型写的) */
  tags: string;
  outfit: string;
  negative: string;
  gender: 'female' | 'male';
  player?: boolean;
  /** 角色名标签 */
  name_tag?: string;
  /** 参考图(只 V4.5 用) */
  ref?: RefIn | null;
}

export interface GenerateRequest {
  card_id: string | null;
  chat_id: string | null;
  entry_id: string | null;
  swipe: number | null;
  line: number | null;
  trigger: 'manual' | 'auto' | 'reroll';
  title: string;
  description: string;
  picture: Picture;
  looks: Record<string, LookIn>;
  style: { tags: string; negative: string; artists?: string };
  model: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  noise_schedule: 'karras' | 'exponential' | 'polyexponential';
  cfg_rescale: number;
  variety: boolean;
  /** 不传 = 随机 */
  seed?: number;
  quality: 'standard' | 'light' | 'none';
  uc_preset: 'heavy' | 'light' | 'human' | 'none';
  /** 反向预设之外另外写的 */
  uc: string;
  sfw_only: boolean;
  allow_paid: boolean;
  /** 用哪条画图连接(11-07);不传是老写法,后端照以前用 NovelAI token */
  connection_id?: string | null;
  /** 问指导模型花了几毫秒,记进相册的用时;没问(换一张、测试出图)不传 */
  plan_ms?: number;
  /** 只有本地 SD 连接带:调度器、这张卡在这条连接下的 LoRA(关着的照发,后端过滤)、过程预览的编号 */
  scheduler?: string;
  loras?: LoraPick[];
  job_id?: string;
}

export interface GeneratedImage {
  id: string;
  sha: string | null;
  card_id: string | null;
  chat_id: string | null;
  entry_id: string | null;
  swipe: number | null;
  line: number | null;
  trigger: 'manual' | 'auto' | 'reroll';
  title: string;
  description: string;
  picture: Partial<Picture>;
  prompt: string;
  negative: string;
  chars: { prompt: string; negative: string; x: number; y: number }[];
  params: {
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
    sampler?: string;
    noise_schedule?: string;
    cfg_rescale?: number;
    variety?: boolean;
    quality?: string;
    uc_preset?: string;
    seed?: number;
    /** 带了参考图:谁、哪张(null = 默认立绘)、是不是连画风一起参考、强度(11-04 以前的图没记,都是 1) */
    reference?: { who: string; kind: 'sprite' | 'upload'; id: string | null; style: boolean; strength?: number } | null;
    /** 设了参考图但这张没带上的原因 */
    reference_note?: string;
    /** 11-07 起:哪条画图连接画的 */
    connection?: { id: string | null; name: string; kind: string };
    /** 11-07 起:每段几毫秒(plan = 问指导模型;测试出图、换一张没有,是 null) */
    timing?: { queue: number; draw: number; fetch: number; plan: number | null };
  };
  ms: number;
  kept_asset_id: string | null;
  created_at: string;
}

export interface LookResult {
  tags: string;
  outfit: string;
  gender: 'female' | 'male';
  /** 认得出是哪部作品的角色时的 danbooru 角色标签,原创角色是空串 */
  name_tag: string;
  ms: number;
}

export interface RefImage {
  id: string;
  sha: string | null;
  mime: string;
}

export interface KeepResult {
  pack_id: string;
  pack_name: string;
  asset_id: string;
  label: string;
}

// ── 画图连接(11-07,后端 connections.py 和 api.py 的 /connections/{id}/...)──

export type ConnKind = 'novelai' | 'sdapi' | 'openai';

export interface ImageConn {
  id: string;
  name: string;
  kind: ConnKind;
  /** NovelAI 空着 = 官方地址 */
  base_url: string | null;
  /** key 只写不读,只回填没填 */
  has_key: boolean;
  options: Record<string, unknown>;
  created_at: string;
}

export interface ImageConnIn {
  name?: string;
  kind: ConnKind;
  base_url?: string | null;
  api_key?: string | null;
  options?: Record<string, unknown>;
}

/** 没传的不动;api_key 传空串 = 清掉;改了地址又没一起给 key,后端把旧 key 清掉 */
export interface ImageConnPatch {
  name?: string;
  base_url?: string | null;
  api_key?: string;
  options?: Record<string, unknown>;
}

/** 这条连接能选的(GET /options):拿不到的项不给,界面上就不显示 */
export interface ConnOptions {
  models?: string[];
  samplers?: string[];
  schedulers?: string[];
  loras?: unknown[];
}

/** 查连接:连上了 message 是档位之类,没连上是接口回的原文 */
export interface CheckResult {
  ok: boolean;
  message: string;
  ms: number;
}

/** 测试出图:图直接回 base64,不进相册 */
export interface TrialResult {
  mime: string;
  b64: string;
  prompt: string;
  negative: string;
  chars: GeneratedImage['chars'];
  params: GeneratedImage['params'];
  ms: number;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const imagegenApi = {
  defaults: () => apiRequest<ImageGenDefaults>('/api/imagegen/defaults'),
  plan: (req: PlanRequest) => apiRequest<PlanResult>('/api/imagegen/plan', json(req)),
  note: (req: NoteRequest) => apiRequest<NoteResult>('/api/imagegen/note', json(req)),
  look: (req: { card_id: string; connection_id: string | null; thinking: 'off' | 'conn' }) =>
    apiRequest<LookResult>('/api/imagegen/look', json(req)),
  generate: (req: GenerateRequest) => apiRequest<GeneratedImage>('/api/imagegen/generate', json(req)),
  images: (cardId: string) => apiRequest<GeneratedImage[]>(`/api/imagegen/images?card_id=${encodeURIComponent(cardId)}`),
  image: (id: string) => apiRequest<GeneratedImage>(`/api/imagegen/images/${id}`),
  deleteImage: (id: string) => apiRequest<void>(`/api/imagegen/images/${id}`, { method: 'DELETE' }),
  keep: (id: string) => apiRequest<KeepResult>(`/api/imagegen/images/${id}/keep`, { method: 'POST' }),
  /** 上传一张参考图 */
  uploadRef: (file: File, cardId: string | null) => {
    const form = new FormData();
    form.append('file', file);
    if (cardId) form.append('card_id', cardId);
    return apiRequest<RefImage>('/api/imagegen/refs', { method: 'POST', body: form });
  },
  deleteRef: (id: string) => apiRequest<void>(`/api/imagegen/refs/${id}`, { method: 'DELETE' }),
  // ── 画图连接、每张卡的设置(11-07)──
  connections: () => apiRequest<ImageConn[]>('/api/imagegen/connections'),
  /** 每条连接有几张卡在用 */
  connectionUsage: () => apiRequest<Record<string, number>>('/api/imagegen/connections/usage'),
  addConnection: (body: ImageConnIn) => apiRequest<ImageConn>('/api/imagegen/connections', json(body)),
  updateConnection: (id: string, patch: ImageConnPatch) =>
    apiRequest<ImageConn>(`/api/imagegen/connections/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteConnection: (id: string) => apiRequest<void>(`/api/imagegen/connections/${id}`, { method: 'DELETE' }),
  /** 查连接(不花钱) */
  checkConnection: (id: string) => apiRequest<CheckResult>(`/api/imagegen/connections/${id}/check`, { method: 'POST' }),
  /** 这条连接能选的模型、采样器、LoRA(不花钱);拿不到的项不给 */
  connectionOptions: (id: string) =>
    apiRequest<ConnOptions>(`/api/imagegen/connections/${id}/options`),
  /** 让本地 SD 重新扫 LoRA 文件夹 */
  refreshLoras: (id: string) => apiRequest<void>(`/api/imagegen/connections/${id}/refresh-loras`, { method: 'POST' }),
  /** 一条 NovelAI 连接的账户 */
  connectionAccount: (id: string) => apiRequest<NaiAccount>(`/api/imagegen/connections/${id}/account`),
  /** 测试出图 */
  testConnection: (id: string, req: GenerateRequest) =>
    apiRequest<TrialResult>(`/api/imagegen/connections/${id}/test`, json(req)),
  /** 这张卡的 imagegen.setup(第一次读时后端会升级、新卡抄上次的) */
  setup: (cardId: string) => apiRequest<unknown>(`/api/imagegen/setup?card_id=${encodeURIComponent(cardId)}`),
  putSetup: (cardId: string, value: unknown) =>
    apiRequest<unknown>(`/api/imagegen/setup?card_id=${encodeURIComponent(cardId)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};
