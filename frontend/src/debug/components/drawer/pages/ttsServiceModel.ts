/**
 * 语音服务页(游戏皮,照模型页的三栏)用的小函数:测通以后「文件怎么到语音机」那一行、
 * 连接表单的默认值 / 有没有改过 / 要存什么。纯函数,不碰 React。
 */

import type { TtsApiType, TtsConnection, TtsConnectionPatch, VoiceParams } from '../../../lib/api';

export type RouteInfo = { route?: 'same' | 'plugin' | 'none' | null; plugin?: boolean; pair_ok?: boolean; model_count?: number | null };

/** 连接测通以后那一行:文件怎么到语音机 */
export function routeText(r: RouteInfo, isGsv: boolean): string | null {
  if (!isGsv || !r.route) return null;
  if (r.route === 'same') return '同一台电脑,声音文件不用传';
  if (r.route === 'none') return '另一台电脑,没装小插件:导入的声音要手动放文件';
  return r.pair_ok ? '另一台电脑,小插件已配对:导入的声音会自动送过去' : '另一台电脑,配对码没填或不对';
}

export const voicesOn = <T extends { connection_id: string }>(profiles: readonly T[], connId: string | null) =>
  profiles.filter((p) => p.connection_id === connId);

export const DEFAULT_URL: Record<TtsApiType, string> = {
  gpt_sovits: 'http://127.0.0.1:9880',
  indextts: 'http://127.0.0.1:9890',
  fish: '',
  openai: '',
};

export const TYPE_LABEL: Record<TtsApiType, string> = {
  gpt_sovits: 'GPT-SoVITS',
  indextts: 'IndexTTS-2.5',
  fish: 'Fish Audio',
  openai: 'OpenAI 兼容',
};

/** 类型下拉的顺序 */
export const TYPE_ORDER: readonly TtsApiType[] = ['gpt_sovits', 'fish', 'indextts', 'openai'];
/** 下拉里选项后面的小字 */
export const TYPE_SUB: Partial<Record<TtsApiType, string>> = { openai: '中转站,New API 这类' };

/** 装得了 AnimaVN 小插件的(语音机上的服务):测通以后问文件怎么送、有配对码 */
export const hasPlugin = (t: TtsApiType) => t === 'gpt_sovits' || t === 'indextts';
/** 云端的:要 key,文件由 AnimaVN 自己带过去 */
export const isCloud = (t: TtsApiType) => t === 'fish' || t === 'openai';

export const FISH_MODELS = ['drama-3', 's1'] as const;
export const DEFAULT_MODEL: Record<TtsApiType, string> = { gpt_sovits: '', indextts: '', fish: 'drama-3', openai: 'tts-1' };
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;

/** 测通结果里的一行:中转站列出了几个模型 */
export const modelCountText = (n: number | null | undefined) => (typeof n === 'number' ? `${n} 个模型` : null);

/** 语音模型:名字里带 tts / speech / audio / voice */
export const isSpeechModel = (name: string) => /tts|speech|audio|voice/i.test(name);

/** 可用模型:语音模型排前面,各自保持原来的顺序 */
export function sortModels(models: readonly string[]): { speech: string[]; other: string[] } {
  return { speech: models.filter(isSpeechModel), other: models.filter((m) => !isSpeechModel(m)) };
}

export const keyPlaceholder = (has: boolean) => (has ? '已保存(留空保持不变)' : 'sk-…');

// ---- 中转站的音色:一行一个,保存连接时按行增删改声音 ----

export type VoiceLang = 'zh' | 'ja';
export interface VoiceRow {
  /** 已有声音的编号;新加的是 null */
  id: string | null;
  name: string;
  lang: VoiceLang;
  /** 已有声音的其余参数(改名时原样带着) */
  params?: VoiceParams;
}

export const rowsFrom = (
  voices: readonly { id: string; name: string; text_lang: string; params: VoiceParams }[],
): VoiceRow[] =>
  voices.map((v) => ({
    id: v.id,
    name: v.params.voice ?? v.name,
    lang: v.text_lang.toLowerCase().includes('ja') ? 'ja' : 'zh',
    params: v.params,
  }));

const blankRow = (r: VoiceRow) => r.id === null && !r.name.trim();

/** 音色行有没有问题:已有的行不能清空名字,名字不能重 */
export function rowsError(rows: readonly VoiceRow[]): string | null {
  if (rows.some((r) => r.id !== null && !r.name.trim())) return '音色名不能空,不要的音色点右边的 × 删掉';
  const seen = new Set<string>();
  for (const r of rows.filter((x) => !blankRow(x))) {
    const k = r.name.trim().toLowerCase();
    if (seen.has(k)) return `音色「${r.name.trim()}」重复了`;
    seen.add(k);
  }
  return null;
}

/** 保存时要对声音做的事:新加(名字非空)、改了名字或语言的、不在了的 */
export function diffVoiceRows(saved: readonly VoiceRow[], draft: readonly VoiceRow[]) {
  const was = new Map(saved.filter((r) => r.id).map((r) => [r.id as string, r]));
  const create = draft.filter((r) => r.id === null && r.name.trim());
  const update = draft.filter((r) => {
    const old = r.id ? was.get(r.id) : undefined;
    return old && (old.name.trim() !== r.name.trim() || old.lang !== r.lang);
  });
  const keep = new Set(draft.map((r) => r.id));
  const remove = saved.filter((r) => r.id && !keep.has(r.id)).map((r) => r.id as string);
  return { create, update, remove };
}

export const rowsDirty = (saved: readonly VoiceRow[], draft: readonly VoiceRow[]) => {
  const d = diffVoiceRows(saved, draft);
  return d.create.length + d.update.length + d.remove.length > 0;
};

export const pairCodePlaceholder = (has: boolean) =>
  has ? '已保存(留空保持不变)' : '同一台电脑不用填';

export const PAIR_CODE_TIP =
  '语音机和这台电脑不是同一台时,在语音机上装小插件,启动窗口会显示 8 位配对码,填在这里,导入的声音就能自动送过去。同一台电脑不用填。填错了或不要了,点右边的「清除」。';

export const TEST_IDLE = '「连接」只测通不通,不花钱;「试听」真念一句。';
export const DEFAULT_TEST_TEXT = '你好,今天过得怎么样?';

/** 表单里的字段(数字都按字符串存,填一半不会被吃掉) */
export interface TtsForm {
  name: string;
  api_type: TtsApiType;
  base_url: string;
  sample_steps: string;
  emo_alpha: string;
  pair_code: string;
  /** Fish、中转站:新填的 key(留空 = 保持不变);存着的 key 不会回传 */
  api_key: string;
  model: string;
  /** 「从模型页带入」选的那条的 id;抄来的 key 在后端,这里只记是哪条 */
  copy_from_llm: string;
}

export function newForm(api_type: TtsApiType = 'gpt_sovits'): TtsForm {
  return {
    name: '',
    api_type,
    base_url: DEFAULT_URL[api_type],
    sample_steps: '64',
    emo_alpha: '1',
    pair_code: '',
    api_key: '',
    model: DEFAULT_MODEL[api_type],
    copy_from_llm: '',
  };
}

export function formFrom(c: TtsConnection | null): TtsForm {
  if (!c) return newForm();
  return {
    name: c.name,
    api_type: c.api_type,
    base_url: c.base_url,
    sample_steps: String(c.sample_steps),
    emo_alpha: String(c.emo_alpha),
    pair_code: '',
    api_key: '',
    model: c.model || DEFAULT_MODEL[c.api_type],
    copy_from_llm: '',
  };
}

/** 保存成功后:新填的配对码、key 已经进后端,输入框回到空(不然一直算「有没保存的改动」) */
export const clearSecrets = (f: TtsForm): TtsForm => ({ ...f, pair_code: '', api_key: '', copy_from_llm: '' });

/** 换类型:地址没改过(还是旧类型的默认值,或空着)就跟着换成新类型的默认值 */
export function withType(f: TtsForm, api_type: TtsApiType): TtsForm {
  const untouched = f.base_url.trim() === '' || f.base_url === DEFAULT_URL[f.api_type];
  const modelUntouched = f.model.trim() === '' || f.model === DEFAULT_MODEL[f.api_type];
  return {
    ...f,
    api_type,
    base_url: untouched ? DEFAULT_URL[api_type] : f.base_url,
    model: modelUntouched ? DEFAULT_MODEL[api_type] : f.model,
  };
}

export const isDirty = (form: TtsForm, saved: TtsConnection | null) =>
  JSON.stringify(form) !== JSON.stringify(formFrom(saved));

/** 表单检查:通过返回 null,不通过返回要给用户看的话 */
export function formError(f: TtsForm): string | null {
  if (!f.name.trim()) return '名称不能空';
  if (!f.base_url.trim() && f.api_type !== 'fish' && !(f.api_type === 'openai' && f.copy_from_llm)) return '地址不能空';
  if (isCloud(f.api_type)) return null;
  if (f.api_type === 'gpt_sovits') {
    const n = Number(f.sample_steps);
    if (!Number.isInteger(n) || n < 4 || n > 128) return '采样步数是 4 到 128 之间的整数';
  } else {
    const a = Number(f.emo_alpha);
    if (f.emo_alpha.trim() === '' || !(a >= 0 && a <= 1)) return '情绪强度在 0 到 1 之间';
  }
  return null;
}

/** 新建时发给后端的 */
export function createBody(f: TtsForm) {
  const code = hasPlugin(f.api_type) && f.pair_code.trim() ? { pair_code: f.pair_code.trim() } : {};
  const cloud = isCloud(f.api_type)
    ? {
        model: f.model.trim(),
        ...(f.api_key.trim() ? { api_key: f.api_key.trim() } : {}),
        ...(f.api_type === 'openai' && f.copy_from_llm ? { copy_from_llm: f.copy_from_llm } : {}),
      }
    : {};
  return {
    name: f.name.trim(),
    api_type: f.api_type,
    base_url: f.base_url.trim(),
    ...(f.api_type === 'gpt_sovits' ? { sample_steps: Number(f.sample_steps) } : {}),
    ...(f.api_type === 'indextts' ? { emo_alpha: Number(f.emo_alpha) } : {}),
    ...code,
    ...cloud,
  };
}

/** 保存已有连接时发给后端的:只带改过的(配对码留空 = 保持不变,不发) */
export function updateBody(f: TtsForm, saved: TtsConnection): TtsConnectionPatch {
  const p: TtsConnectionPatch = {};
  if (f.name.trim() !== saved.name) p.name = f.name.trim();
  if (f.api_type !== saved.api_type) p.api_type = f.api_type;
  if (f.base_url.trim() !== saved.base_url) p.base_url = f.base_url.trim();
  if (f.api_type === 'gpt_sovits' && Number(f.sample_steps) !== saved.sample_steps) p.sample_steps = Number(f.sample_steps);
  if (f.api_type === 'indextts' && Number(f.emo_alpha) !== saved.emo_alpha) p.emo_alpha = Number(f.emo_alpha);
  if (hasPlugin(f.api_type) && f.pair_code.trim()) p.pair_code = f.pair_code.trim();
  if (isCloud(f.api_type)) {
    if (f.model.trim() !== (saved.model || DEFAULT_MODEL[saved.api_type])) p.model = f.model.trim();
    if (f.api_key.trim()) p.api_key = f.api_key.trim();
    if (f.api_type === 'openai' && f.copy_from_llm) p.copy_from_llm = f.copy_from_llm;
  }
  return p;
}

/** 删除按钮灰着时的原因 */
export const deleteBlockedWhy = (voices: number) =>
  voices > 0 ? `还有 ${voices} 个声音在用,先在素材管理里给它们换一条连接` : undefined;
