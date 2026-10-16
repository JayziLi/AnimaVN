/**
 * 立绘标签 → 这张卡的哪个表情。先精确匹配(名字 / 别名,不分大小写),对不上的交给
 * 后端模型挑列表里最像的(/api/emotion/match)。立绘层、占位框、语音、控制台都用这里。
 * 设置 → 数据「表情认法」选了认词记录(素材架构第 1b 期)时,精确匹配和模型之间先查认词记录(vn/useWordRecords.ts)。
 * 规则见 docs/superpowers/specs/2026-09-25-sprite-emotion-matching-design.md、2026-10-09-asset-architecture-design.md 1.4
 */

import type { PackSprite } from '../lib/api';
import type { TagHit } from '../vn/script';
import { LABEL_MAX, resolveByLabel } from './common';
import { BUILTIN_EMOTIONS } from './emotions';

/** 一个能被匹配到的表情:有立绘时是一张立绘,没有时是一个内置表情 */
export interface EmotionCandidate {
  key: string;
  label: string;
  aliases: string[];
}

export function emotionCandidates(sprites: readonly PackSprite[]): EmotionCandidate[] {
  if (sprites.length > 0) return sprites.map((s) => ({ key: s.id, label: s.label, aliases: s.aliases }));
  return BUILTIN_EMOTIONS.map((e) => ({ key: e.label, label: e.label, aliases: [...e.aliases] }));
}

/** 候选变了(换卡、改立绘)结果就作废:缓存键里带着它 */
export const candidatesSignature = (candidates: readonly EmotionCandidate[]) =>
  candidates.map((c) => [c.key, c.label, ...c.aliases].join('\u0001')).join('\u0002');

/** 后端一次最多收 40 字的词(名字的长度上限 LABEL_MAX),更长的不问 */
export const MAX_TAG_LEN = LABEL_MAX;
const MAX_NAMES = 20;

export const normTag = (label: string) => label.trim();

/** 发给后端的候选:名字 + 别名,去掉太长的,最多 20 个 */
export function toRequestCandidate(c: EmotionCandidate): { key: string; names: string[] } {
  const names = [c.label, ...c.aliases]
    .map((n) => n.trim())
    .filter((n) => n && n.length <= MAX_TAG_LEN)
    .slice(0, MAX_NAMES);
  return { key: c.key, names };
}

/** 这张卡的表情名单是哪一份(认词记录按名单记):有立绘是当前立绘包,没有是内置表情 */
export const emotionListRef = (sprites: readonly PackSprite[]): string =>
  sprites.length > 0 ? `pack:${sprites[0].pack_id}` : 'builtin';

/** 认词记录里一条是怎么来的 */
export type RecordSource = 'migrated' | 'model' | 'rename' | 'player';

export const RECORD_SOURCE_NAME: Record<RecordSource, string> = {
  migrated: '迁移时按旧结果',
  model: '模型认过一次',
  rename: '改名留下的',
  player: '你改的',
};

/** 认词记录里的一条:这个词认成名单里的哪一项(候选的 key) */
export interface RecordEntry {
  key: string;
  source: RecordSource;
}

/** 后端的结果;出错时记下原因和时间(过一会儿再试) */
export type ModelEntry = { key: string; score: number } | { error: string; at: number };

export type TagMatch =
  | { state: 'exact'; label: string }
  | { state: 'record'; label: string; source: RecordSource }
  | { state: 'model'; label: string; score: number }
  | { state: 'pending' }
  | { state: 'failed'; reason: string };

/** 认出来了(名字、认词记录或模型):立绘、语音按它换 */
export const isRecognized = (m: TagMatch): m is Extract<TagMatch, { label: string }> =>
  m.state === 'exact' || m.state === 'record' || m.state === 'model';

export type TagResolver = (label: string) => TagMatch;

/**
 * records:这份名单的认词记录(表情认法选了认词记录才传);记的那一项现在不在名单里(停用了、删了)就当没记,
 * 照旧问模型
 */
export function matchTag(
  label: string,
  candidates: readonly EmotionCandidate[],
  lookup: (tag: string) => ModelEntry | undefined,
  records?: ReadonlyMap<string, RecordEntry> | null,
): TagMatch {
  const tag = normTag(label);
  if (!tag) return { state: 'failed', reason: '标签里没写表情' };
  const exact = resolveByLabel(tag, candidates);
  if (exact) return { state: 'exact', label: exact.label };
  const rec = records?.get(tag);
  const recorded = rec ? candidates.find((x) => x.key === rec.key) : undefined;
  if (rec && recorded) return { state: 'record', label: recorded.label, source: rec.source };
  if (tag.length > MAX_TAG_LEN) return { state: 'failed', reason: '标签太长' };
  const r = lookup(tag);
  if (!r) return { state: 'pending' };
  if ('error' in r) return { state: 'failed', reason: r.error };
  const c = candidates.find((x) => x.key === r.key);
  return c ? { state: 'model', label: c.label, score: r.score } : { state: 'pending' };
}

/** 标签后面紧跟的是另一个有名字的角色的台词:不切主角的立绘 */
export const isNpcHit = (h: TagHit, charName: string) =>
  h.kind === 'sprite' && typeof h.speaker === 'string' && h.speaker !== charName;

/** 累计表情时要的东西:查结果、没立绘时失败用原词、认 NPC 用的角色名 */
export interface EmotionContext {
  resolve: TagResolver;
  /** 这张卡一张立绘都没有:模型不可用时占位框 / 语音用 AI 写的原词(以前的行为) */
  rawOnFail: boolean;
  charName: string;
}
