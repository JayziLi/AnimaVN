/**
 * 开发者页(ConsoleView)的纯逻辑:标签怎么对上素材、语音每句的状态、原文里把标签标出来、点一行看哪一句。
 * 原来写在 VNScreen.tsx 里;搬出来是为了能单独测,页面本身在 ../ConsoleView.tsx。
 */

import type { PackSprite, SceneAsset } from '../../lib/api';
import { isNpcHit, RECORD_SOURCE_NAME, type EmotionContext, type TagMatch } from '../../plugins/emotionMatch';
import { resolveByLabel } from '../../plugins/common';
import { kindName } from '../../plugins/registry';
import { backgroundsOf, bgmsOf, cgsOf, isCgOff, type SceneState } from '../../plugins/scene';
import type { TagHit, TagKind } from '../script';
import type { ClipState } from '../voice';

/** 一个标签的匹配结果:mark 是行首那个字(✓ 对上了、≈ 模型认的、… 还在认、— 不用对、! 对不上) */
export interface Verdict {
  mark: '✓' | '≈' | '…' | '—' | '!';
  text: string;
}

/** 只有真对不上才算出错(红字);还在认的、不用对的都是正常说明 */
export const isMiss = (v: Verdict) => v.mark === '!';

/** 场景里的音乐是怎么来的 */
export const BGM_FROM: Record<NonNullable<SceneState['bgmFrom']>, string> = {
  initial: '开场默认',
  scene: '场景默认曲',
  tag: 'AI 标签',
};

/** 立绘标签的匹配结果 */
export function describeMatch(m: TagMatch, sprites: readonly PackSprite[]): Verdict {
  const noImage = (label: string) => {
    const s = sprites.find((x) => x.label === label);
    return s && !s.has_image ? '(还没传图)' : '';
  };
  const where = sprites.length === 0 ? '内置表情 ' : '';
  switch (m.state) {
    case 'exact':
      return { mark: '✓', text: `${where}${m.label}${noImage(m.label)}` };
    case 'record':
      return { mark: '✓', text: `${where}${m.label}(认词记录 · ${RECORD_SOURCE_NAME[m.source]})${noImage(m.label)}` };
    case 'model':
      return { mark: '≈', text: `${where}${m.label}(模型 ${m.score.toFixed(2)})${noImage(m.label)}` };
    case 'pending':
      return { mark: '…', text: '识别中' };
    case 'failed':
      // m.reason 是后端 / 模型给的原文,不翻译
      return { mark: '!', text: `${m.reason},${sprites.length === 0 ? '占位框写原词' : '保持上一张'}` };
  }
}

export interface MatchCtx {
  emotion: EmotionContext;
  sprites: readonly PackSprite[];
  sceneAssets: readonly SceneAsset[];
}

/** 标签 → 匹配结果(立绘、背景、CG、音乐、玩家台词) */
export function resolveTag(kind: string, label: string, ctx: MatchCtx): Verdict {
  const { emotion, sprites, sceneAssets } = ctx;
  if (kind === 'sprite') return describeMatch(emotion.resolve(label), sprites);
  if (kind === 'player') return { mark: '✓', text: '玩家台词,不念' };
  if (kind === 'cg' && isCgOff(label)) return { mark: '✓', text: '收起 CG' };
  const pool = kind === 'bg' ? backgroundsOf(sceneAssets) : kind === 'cg' ? cgsOf(sceneAssets) : bgmsOf(sceneAssets);
  const a = resolveByLabel(label, pool);
  if (a) return { mark: '✓', text: `${a.label}${a.has_file ? '' : '(还没传文件)'}` };
  if (sceneAssets.length === 0) return { mark: '!', text: '这张卡没有绑定场景包' };
  return { mark: '!', text: `场景包里没有这个${kindName(kind)},保持不变` };
}

/** 标签表里一行的匹配结果:跟在别的角色台词前的立绘标签不切立绘 */
export function hitVerdict(h: TagHit, ctx: MatchCtx): Verdict {
  if (h.kind === 'sprite' && isNpcHit(h, ctx.emotion.charName)) {
    return { mark: '—', text: `「${h.speaker}」的台词,不切立绘` };
  }
  return resolveTag(h.kind, h.label, ctx);
}

/** 标签生效的位置;-1 = 写在回复最末尾 */
export const hitWhere = (h: TagHit): string =>
  h.lineIndex === -1 ? '回复末尾(延续到下一条)' : `第 ${h.lineIndex + 1} 句`;

/** 原文切成的一段:标签(带是否对上、哪一类)或普通文字 */
export interface RawSeg {
  text: string;
  tag?: { ok: boolean; kind: string };
}

/** 原文里把几类标签都标出来;ok 由调用方按 resolveTag 给 */
export function rawSegments(
  raw: string,
  tagKinds: readonly TagKind[],
  isOk: (kind: string, label: string) => boolean,
): RawSeg[] {
  if (!raw) return [];
  const found: { at: number; text: string; ok: boolean; kind: string }[] = [];
  for (const k of tagKinds) {
    if (!k.pattern) continue;
    for (const m of raw.matchAll(new RegExp(k.pattern.source, 'g'))) {
      found.push({ at: m.index ?? 0, text: m[0], ok: isOk(k.kind, m[1]), kind: k.kind });
    }
  }
  found.sort((a, b) => a.at - b.at);
  const out: RawSeg[] = [];
  let last = 0;
  for (const f of found) {
    if (f.at < last) continue;
    if (f.at > last) out.push({ text: raw.slice(last, f.at) });
    out.push({ text: f.text, tag: { ok: f.ok, kind: f.kind } });
    last = f.at + f.text.length;
  }
  if (last < raw.length) out.push({ text: raw.slice(last) });
  return out;
}

/** 语音合成这一句的状态;error 的 message 是后端原文 */
export function clipStatus(st: ClipState | undefined): { text: string; error: boolean; ok: boolean } {
  if (!st) return { text: '还没请求', error: false, ok: false };
  switch (st.state) {
    case 'queued':
      return { text: '排队中', error: false, ok: false };
    case 'loading':
      return { text: '合成中…', error: false, ok: false };
    case 'ready':
      return { text: `${st.cache === 'hit' ? '缓存命中' : '新合成'} · ${(st.ms / 1000).toFixed(1)} 秒`, error: false, ok: true };
    case 'error':
      return { text: st.message, error: true, ok: false };
  }
}

/** 标签表 / 语音表里点中的一行 */
export interface RowPick {
  table: 'tag' | 'voice';
  index: number;
}

/**
 * 点中的行落在这条回复的第几句(从 0 数);没点 = 光标那句。
 * 写在回复末尾的标签(lineIndex -1)没有自己的句子,看最后一句
 */
export function pickedLine(pick: RowPick | null, hits: readonly TagHit[], lineCount: number, cursor: number): number {
  const last = Math.max(0, lineCount - 1);
  if (!pick) return Math.min(Math.max(0, cursor), last);
  if (pick.table === 'voice') return Math.min(Math.max(0, pick.index), last);
  const li = hits[pick.index]?.lineIndex ?? -1;
  return li < 0 ? last : Math.min(li, last);
}
