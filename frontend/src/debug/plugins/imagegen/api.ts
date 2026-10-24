/** 生图卡带的接口(后端 app/plugins/imagegen/api.py) */

import { apiRequest } from '../../lib/api';
import type { VnImageNote } from '../../lib/chatEntry';

export interface ImageGenStatus {
  has_token: boolean;
  source: 'env' | 'settings' | null;
}

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
    /** 带了参考图:谁、哪张(null = 默认立绘)、是不是连画风一起参考 */
    reference?: { who: string; kind: 'sprite' | 'upload'; id: string | null; style: boolean } | null;
    /** 设了参考图但这张没带上的原因 */
    reference_note?: string;
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

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const imagegenApi = {
  status: () => apiRequest<ImageGenStatus>('/api/imagegen/status'),
  putToken: (token: string) =>
    apiRequest<ImageGenStatus>('/api/imagegen/token', { method: 'PUT', body: JSON.stringify({ token }) }),
  account: () => apiRequest<NaiAccount>('/api/imagegen/account'),
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
};
