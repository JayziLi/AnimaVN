/**
 * 声音编辑器(卡编辑器「声音」栏、素材管理页的声音)的纯函数:「声音设置」每格存什么、缺什么、收起时的摘要,
 * 情绪参考表的匹配小牌子和每行文字、「新增情绪」认路径、改参考音频顺手填参考文本、全局参数存哪几项、
 * 「更多参数」的摘要和固定种子、试听的例句、念不了时说缺什么、进度和波形。
 */

import type {
  TtsConnection,
  VoiceEmotion,
  VoiceEmotionPatch,
  VoiceParams,
  VoiceProfile,
  VoiceProfilePatch,
  VoiceTuning,
} from '../../lib/api';
import { BUILTIN_EMOTIONS } from '../../plugins/emotions';
import {
  EMO_DIMS,
  GSV_NUM_PARAMS,
  VOICE_LANGS,
  VOICE_SAMPLES,
  missingEmotions,
  parseRefFileName,
  sampleLangOf,
  type NumParam,
} from '../../plugins/voice';
import { ENGINE_NAME } from '../slots/voiceSlotModel';

export const basename = (path: string) => path.split(/[\\/]/).pop() || path;

/** 贴进来的路径常带着引号(Windows「复制为路径」) */
const unquote = (s: string) => s.trim().replace(/^"|"$/g, '').trim();

// ---------------------------------------------------------------- 声音设置

/** 「声音设置」里一格一格存的几项(别名是一串小标签,另算:aliasesPatch) */
export type SettingKey = 'name' | 'connection_id' | 'text_lang' | 'ref_path' | 'gpt_weights' | 'sovits_weights';

/**
 * 「声音设置」里一格交出来的字 → 要存的那一项。路径去掉前后空格和引号;
 * 没变、或者名字 / 语音服务 / 语言清空了(不许存空的,框里退回原值)是 null
 */
export function settingPatch(
  profile: Pick<VoiceProfile, SettingKey>,
  key: SettingKey,
  raw: string,
): VoiceProfilePatch | null {
  const required = key === 'name' || key === 'connection_id' || key === 'text_lang';
  const value = required ? raw.trim() : unquote(raw);
  if ((required && !value) || value === profile[key]) return null;
  const patch: VoiceProfilePatch = {};
  patch[key] = value;
  return patch;
}

/** 别名:去掉空的、重复的(不分大小写)、和名字一样的(后端也这么收);和原来一样是 null */
export function aliasesPatch(
  profile: Pick<VoiceProfile, 'name' | 'aliases'>,
  next: readonly string[],
): VoiceProfilePatch | null {
  const seen = new Set([profile.name.trim().toLowerCase()]);
  const aliases: string[] = [];
  for (const raw of next) {
    const word = raw.trim();
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    aliases.push(word);
  }
  const same = aliases.length === profile.aliases.length && aliases.every((a, i) => a === profile.aliases[i]);
  return same ? null : { aliases };
}

/** 还没填、念不了的:IndexTTS 要音色参考,GPT-SoVITS 两个权重都要(后端缺了就不念) */
export function missingSettings(
  profile: Pick<VoiceProfile, 'ref_path' | 'gpt_weights' | 'sovits_weights'>,
  isIndex: boolean,
): string[] {
  if (isIndex) return profile.ref_path.trim() ? [] : ['音色参考'];
  return [
    ...(profile.gpt_weights.trim() ? [] : ['GPT 权重']),
    ...(profile.sovits_weights.trim() ? [] : ['SoVITS 权重']),
  ];
}

/** 「还没填 GPT 权重」「还没填音色参考」:中文里夹的英文前面空一格 */
const lacking = (missing: readonly string[]) => {
  const list = missing.join('、');
  return /^[A-Za-z]/.test(list) ? `还没填 ${list}` : `还没填${list}`;
};

/** 语音服务下拉的一项:连接名,右边灰字是引擎;连接名里已经写了引擎名就不重复 */
export function connectionOption(c: Pick<TtsConnection, 'id' | 'name' | 'api_type'>): {
  value: string;
  label: string;
  sub?: string;
} {
  const engine = ENGINE_NAME[c.api_type];
  const name = c.name.trim();
  if (!name) return { value: c.id, label: engine };
  return name.toLowerCase().includes(engine.toLowerCase())
    ? { value: c.id, label: name }
    : { value: c.id, label: name, sub: engine };
}

/**
 * 「语言」下拉:这个引擎认的几种(plugins/voice.ts 的 VOICE_LANGS,写人话名字);
 * 存着的不在里面(换过引擎、手填过 all_ja 这类)就原样多列一项,不悄悄改掉
 */
export function langOptions(textLang: string, isIndex: boolean): { value: string; label: string }[] {
  const list = VOICE_LANGS[isIndex ? 'indextts' : 'gpt_sovits'].map((l) => ({ value: l.value, label: l.name }));
  return list.some((l) => l.value === textLang) ? list : [...list, { value: textLang, label: textLang }];
}

/** 语言的人话名字:「日语」;不认识的原样 */
export const langName = (textLang: string, isIndex: boolean) =>
  langOptions(textLang, isIndex).find((l) => l.value === textLang)?.label ?? textLang;

/** 「声音设置」收起时的一行:用哪台语音服务、念什么语言 + 权重 / 音色参考的文件名;缺东西时写缺什么(warn) */
export function settingsSummary(
  profile: Pick<VoiceProfile, 'text_lang' | 'ref_path' | 'gpt_weights' | 'sovits_weights'>,
  connection: Pick<TtsConnection, 'id' | 'name' | 'api_type'> | null,
  isIndex: boolean,
): { text: string; warn: boolean } {
  const opt = connection && connectionOption(connection);
  const conn = opt ? [opt.label, ...(opt.sub ? [opt.sub] : [])].join(' · ') : '没选语音服务';
  const head = `${conn} · ${langName(profile.text_lang, isIndex)}`;
  const missing = missingSettings(profile, isIndex);
  if (!connection || missing.length > 0) {
    return { text: missing.length > 0 ? `${head} · ${lacking(missing)}` : head, warn: true };
  }
  const files = isIndex ? [basename(profile.ref_path)] : [basename(profile.gpt_weights), basename(profile.sovits_weights)];
  return { text: [head, ...files].join(' · '), warn: false };
}

/** 试听台念不了时那句话(缺音色参考 / 权重 / 参考音频);念得了是 null */
export function benchBlocker(
  profile: Pick<VoiceProfile, 'name' | 'ref_path' | 'gpt_weights' | 'sovits_weights' | 'emotions'>,
  isIndex: boolean,
): string | null {
  const missing = missingSettings(profile, isIndex);
  if (missing.length > 0) return `「${profile.name}」${lacking(missing)},念不了 · 在上面「声音设置」里填`;
  if (!isIndex && profile.emotions.length === 0) {
    return `「${profile.name}」还没有参考音频,念不了 · 在下面「新增情绪」贴一段参考音频的路径`;
  }
  return null;
}

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

/** 改一项合成参数;改回默认(或清掉)就删掉这一项 —— 调过又调回默认也算没改(和 plugins/voice.ts 的 sameDraft 一样) */
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

// ---------------------------------------------------------------- 更多参数(只有 GPT-SoVITS)

/**
 * 「全局参数」下面收起来的「更多参数」里的数值项:旧试音台里有、上面没单独放的 GSV 参数
 * (温度在上面)。名字、范围、默认值照 plugins/voice.ts 的 GSV_NUM_PARAMS
 */
export const MORE_GSV_PARAMS: readonly NumParam[] = GSV_NUM_PARAMS.filter((p) => p.key !== 'temperature');

/** 一项的默认:采样步数没设时跟语音服务的步数,别的是引擎自己的默认 */
export const paramDefault = (p: Pick<NumParam, 'def'>, connSteps: number) => p.def ?? connSteps;

/** 「更多参数」收起时那行小字:改过的几项(「采样步数 32 · top_k 10 · 关并行推理」);全是默认是空串 */
export function moreParamsSummary(params: VoiceParams): string {
  const parts = MORE_GSV_PARAMS.flatMap((p) => {
    const v = params[p.key];
    return v === undefined ? [] : [`${p.name} ${trimNum(v)}${p.unit ? ` ${p.unit}` : ''}`];
  });
  if (params.parallel_infer === false) parts.push('关并行推理');
  return parts.join(' · ');
}

/** 种子最大能填多少(和后端 VoiceTuning.seed 一样) */
export const SEED_MAX = 2 ** 32 - 1;

/** 「固定种子」框里的字:空着 = 每次随机(null);不是 0 到 SEED_MAX 的整数是 bad */
export function parseSeed(text: string): { seed: number | null; bad: boolean } {
  const t = text.trim();
  if (!t) return { seed: null, bad: false };
  const n = Number(t);
  return /^\d+$/.test(t) && n <= SEED_MAX ? { seed: n, bad: false } : { seed: null, bad: true };
}

/**
 * 试听这一句带不带 tuning:固定了种子才带(种子只能跟着 tuning 发),其余照声音存着的发 ——
 * 和不带时念出来一样,只是种子固定。IndexTTS 不认种子,不带
 */
export function benchTuning(
  profile: Pick<VoiceProfile, 'speed' | 'text_lang' | 'params'>,
  seed: number | null,
  isIndex: boolean,
): VoiceTuning | undefined {
  if (seed === null || isIndex) return undefined;
  return { speed: profile.speed, text_lang: profile.text_lang, params: profile.params, seed };
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

// ---------------------------------------------------------------- 文件在另一台电脑(第 4 步)

/** 导进来了、语音服务在另一台电脑、文件还没放过去:编辑器顶上那一块要出来 */
export const filesPending = (p: Pick<VoiceProfile, 'files_at'>) => p.files_at === 'pending';

/** 「语音机上的目录」框里的字整理一下:去掉两头空白、复制路径时带的引号、末尾的斜杠;反斜杠换成 / */
export function normalizeFolder(raw: string): string {
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

/** 「已放好」能不能点:没填是 null 不能点;填了的给整理好的目录 */
export function placedFolder(raw: string): string | null {
  const f = normalizeFolder(raw);
  return f && f !== '.' ? f : null;
}

/** 框底下那行小字:路径会改成什么样 */
export function placedHint(raw: string): string {
  const f = placedFolder(raw) ?? '目录';
  return `参考音频会改成 ${f}/refs/原文件名,模型改成 ${f}/models/原文件名`;
}

/** 名字里 Windows 不让用的字换成 _ */
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || '声音';

/** 框里的提示:D:/AnimaVoice/imports/声音名 */
export const folderPlaceholder = (name: string) => `D:/AnimaVoice/imports/${safeName(name)}`;

/** 「导出这些文件」存成什么名字(后端给了就用后端的) */
export const filesZipName = (name: string) => `${safeName(name)}-文件.zip`;
