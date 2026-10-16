/**
 * 声音编辑器(卡编辑器「声音」栏、素材管理页的声音)的纯函数:情绪参考表的匹配小牌子和每行文字、
 * 「新增情绪」认路径、改参考音频顺手填参考文本、全局参数存哪几项、试听的例句、进度和波形。
 */

import type { VoiceEmotion, VoiceEmotionPatch, VoiceParams, VoiceProfile } from '../../lib/api';
import { BUILTIN_EMOTIONS } from '../../plugins/emotions';
import { EMO_DIMS, VOICE_SAMPLES, missingEmotions, parseRefFileName, sampleLangOf } from '../../plugins/voice';

export const basename = (path: string) => path.split(/[\\/]/).pop() || path;

/** 贴进来的路径常带着引号(Windows「复制为路径」) */
const unquote = (s: string) => s.trim().replace(/^"|"$/g, '').trim();

// ---------------------------------------------------------------- 情绪参考表

export interface MatchBadge {
  ok: boolean;
  /** 「14 张差分均已匹配」/「3 张差分没对上」 */
  text: string;
  /** 没对上的差分名(悬停时列出来) */
  missing: string[];
}

/**
 * 表头右边的匹配小牌子:当前服装的差分名在这个声音的情绪名 / 别名里找不找得到。
 * spriteLabels 为空 = 这张卡没立绘,AI 写的表情会落到内置基础表情上,拿它们对照;
 * null = 没有可对照的(素材管理页不带卡,备用声音只用默认情绪),不出小牌子
 */
export function matchBadge(spriteLabels: readonly string[] | null, profile: VoiceProfile): MatchBadge | null {
  if (spriteLabels === null) return null;
  const builtin = spriteLabels.length === 0;
  const labels = builtin ? BUILTIN_EMOTIONS.map((e) => e.label) : spriteLabels;
  const what = builtin ? '种基础表情' : '张差分';
  const missing = missingEmotions(labels, profile);
  return missing.length === 0
    ? { ok: true, text: `${labels.length} ${what}均已匹配`, missing }
    : { ok: false, text: `${missing.length} ${what}没对上`, missing };
}

/** 表头的说明:对照差分时说怎么匹配,不对照时只说默认是哪行 */
export const tableNote = (count: number, matching: boolean) =>
  matching ? `${count} 种 · 按当前差分匹配情绪,用对应的参考音频合成` : `${count} 种 · 排第一的是默认情绪`;

const trimNum = (n: number) => String(Number(n.toFixed(2)));

/** 表里每行最右边那列:参考文本;没有就写文件名或缺什么(faint = 灰字) */
export function rowText(e: VoiceEmotion, isIndex: boolean): { text: string; faint: boolean } {
  if (e.prompt_text.trim() && e.ref_path) return { text: e.prompt_text.trim(), faint: false };
  if (e.ref_path) return { text: basename(e.ref_path), faint: true };
  if (!isIndex) return { text: e.prompt_text.trim() || '还没填参考音频', faint: true };
  if (e.emo_vector?.some((v) => v > 0)) {
    const parts = e.emo_vector.flatMap((v, i) => (v > 0 ? [`${EMO_DIMS[i]?.short ?? i} ${trimNum(v)}`] : []));
    return { text: ['向量', ...parts].join(' · '), faint: true };
  }
  return { text: '沿用音色参考的语气', faint: true };
}

const AUDIO_EXT = /\.(wav|mp3|ogg|flac|m4a|aac|opus)$/i;
const looksLikePath = (s: string) => /[\\/]/.test(s) || AUDIO_EXT.test(s);

/** 从已占用的名字里挑一个不撞的:情绪、情绪2…(比较不分大小写) */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  let name = base;
  let i = 2;
  while (taken.has(name.toLowerCase())) name = `${base}${i++}`;
  return name;
}

/**
 * 「新增情绪」框里填的东西:像路径的当参考音频(文件名是「【情绪】原文.wav」就取出情绪名和参考文本,
 * 名字撞了加 2、3);别的当情绪名原样用(撞名让后端报出来,不偷偷改名)
 */
export function newEmotionFrom(
  input: string,
  emotions: readonly VoiceEmotion[],
): { label: string; ref_path?: string; prompt_text?: string } {
  const raw = unquote(input);
  if (!looksLikePath(raw)) return { label: raw };
  const parsed = parseRefFileName(raw);
  const taken = new Set(emotions.flatMap((e) => [e.label, ...e.aliases]).map((n) => n.toLowerCase()));
  return { label: uniqueName(parsed?.label || '情绪', taken), ref_path: raw, prompt_text: parsed?.text ?? '' };
}

/** 改参考音频的路径:参考文本还空着、文件名又是「【情绪】原文.wav」时顺手填上 */
export function refPatch(e: Pick<VoiceEmotion, 'prompt_text'>, next: string): VoiceEmotionPatch {
  const path = unquote(next);
  const parsed = parseRefFileName(path);
  return parsed && !e.prompt_text.trim() ? { ref_path: path, prompt_text: parsed.text } : { ref_path: path };
}

/** 删掉一行以后选哪行:下一行,删的是最后一行就选上一行;一行不剩是 null */
export function selectAfterDelete(emotions: readonly Pick<VoiceEmotion, 'id'>[], deletedId: string): string | null {
  const i = emotions.findIndex((e) => e.id === deletedId);
  if (i === -1) return emotions[0]?.id ?? null;
  return emotions[i + 1]?.id ?? emotions[i - 1]?.id ?? null;
}

/** 挪到第一 = 设为默认情绪 */
export function moveToFront(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [id, ...ids.filter((x) => x !== id)] : [...ids];
}

// ---------------------------------------------------------------- 全局参数

/** 改一项合成参数;改回默认(或清掉)就删掉这一项 —— 和插件页试音台一样,调过又调回默认也算没改 */
export function withParam<K extends keyof VoiceParams>(
  params: VoiceParams,
  key: K,
  value: VoiceParams[K] | undefined,
  def: VoiceParams[K] | null | undefined,
): VoiceParams {
  const next = { ...params };
  if (value === undefined || value === def) delete next[key];
  else next[key] = value;
  return next;
}

/** 语速:「1.0×」「1.05×」 */
export function fmtSpeed(v: number): string {
  const r = Math.round(v * 100) / 100;
  const oneDigit = Math.abs(r * 10 - Math.round(r * 10)) < 1e-9;
  return `${r.toFixed(oneDigit ? 1 : 2)}×`;
}

// ---------------------------------------------------------------- 试听

/** 例句跟着声音念的语言走:日语声音用日文那套 */
export const samplesFor = (textLang: string) => VOICE_SAMPLES[sampleLangOf(textLang)];

/** 播放条右边的「1.1 / 2.6 秒」 */
export function progressText(pos: number, duration: number): string {
  const p = Math.min(duration, Math.max(0, pos));
  return `${p.toFixed(1)} / ${duration.toFixed(1)} 秒`;
}

/** 波形:把音频分成 n 段,每段取最响的那个采样,再按最响的一段归一到 0–1 */
export function peaksOf(samples: ArrayLike<number>, n: number): number[] {
  if (n <= 0) return [];
  const len = samples.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const end = Math.floor(((i + 1) * len) / n);
    let peak = 0;
    for (let j = Math.floor((i * len) / n); j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    out.push(peak);
  }
  const max = Math.max(0, ...out);
  return max > 0 ? out.map((v) => v / max) : out;
}
