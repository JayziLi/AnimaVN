/**
 * 素材管理「声音」页的「新建声音」「导入 refs.json」的纯逻辑:新声音起什么名字、贴进来的 refs.json 读不读得出来、
 * 撞上同名的声音时怎么问(后端回 409,选「合进去 / 另建一个」再发一次)。
 * 样子在 VoiceImportDialog.tsx,调接口在 AssetLibrary.tsx。
 */

import { ApiError, type VoiceProfile } from '../lib/api';

/** 新建的空声音叫什么:新声音、新声音2……里第一个没人用的(不分大小写,后端不许重名) */
export function newVoiceName(taken: readonly string[], base = '新声音'): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}${i}`;
  return name;
}

/** 选「另建一个」时后端起的名字:「名字 2」「名字 3」……里第一个没人用的(和后端 _free_name 一样) */
export function copyVoiceName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  let n = 2;
  while (used.has(`${name} ${n}`.toLowerCase())) n++;
  return `${name} ${n}`;
}

/** 素材里有没有和它同名的声音(不分大小写) */
export const hasVoiceNamed = (name: string, taken: readonly string[]) =>
  taken.some((n) => n.toLowerCase() === name.trim().toLowerCase());

export type RefsRead =
  | {
      ok: true;
      refs: Record<string, unknown>;
      name: string;
      count: number;
      /** 清单写了念哪种语言(refsLang);没写是 null,导入时不动原来的 */
      lang: string | null;
    }
  | { ok: false; error: string };

const langText = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * 清单写的这个声音念哪种语言,和后端(api/voices.py 的 _refs_lang)一个规矩:顶层的 text_lang(或 lang);
 * 没写就看每段参考的 lang(语音机上的清单每条都带),几段都一样就用它;都没写、或者几段不一样是 null
 */
export function refsLang(data: Record<string, unknown>, refs: readonly unknown[]): string | null {
  const top = langText(data.text_lang) || langText(data.lang);
  if (top) return top;
  const langs = new Set(
    refs.map((r) => (typeof r === 'object' && r !== null ? langText((r as Record<string, unknown>).lang) : '')),
  );
  langs.delete('');
  return langs.size === 1 ? [...langs][0] : null;
}

/**
 * 贴进来的 refs.json:读得出来就给角色名、几段参考音频和语言,读不出来说哪里不对(和后端报的同一句);
 * 框里是空的是 null(不报错)。每一段的细节(路径、原文)交给后端查
 */
export function readRefs(text: string): RefsRead | null {
  if (!text.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON —— 把 refs.json 的全部内容贴进来' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'refs.json 应该是一个 { … } 对象' };
  }
  const refs = data as Record<string, unknown>;
  const name = typeof refs.character === 'string' ? refs.character.trim() : '';
  if (!name) return { ok: false, error: 'refs.json 里没有 character(角色名)' };
  if (!Array.isArray(refs.refs) || refs.refs.length === 0) {
    return { ok: false, error: 'refs.json 里没有 refs(参考音频列表)' };
  }
  return { ok: true, refs, name, count: refs.refs.length, lang: refsLang(refs, refs.refs) };
}

export type ImportOutcome = { kind: 'done'; profile: VoiceProfile } | { kind: 'conflict'; message: string };

/**
 * 发一次导入。清单没带声音编号、又有同名的声音时后端回 409:不当成出错,交回去问用户
 * 「合进去」(onConflict = 'update')还是「另建一个」('new'),再带着答案发一次。别的错照样抛出去
 */
export async function importOnce(
  send: (onConflict?: 'update' | 'new') => Promise<VoiceProfile>,
  onConflict?: 'update' | 'new',
): Promise<ImportOutcome> {
  try {
    return { kind: 'done', profile: await send(onConflict) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && onConflict === undefined) {
      return { kind: 'conflict', message: e.message };
    }
    throw e;
  }
}
