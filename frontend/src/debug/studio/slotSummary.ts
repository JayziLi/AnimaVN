/**
 * 卡编辑器素材页左栏「在用的素材」每一行的副标题:看一眼就知道这张卡每一栏用了什么。
 * 输入是 DebugApp 手上现成的数据(各个按卡的 hook),这里只做拼字。
 *
 *   立绘「2 套服装 · 玉衡星」(当前那套的服装名)
 *   声音「刻晴(中文) · 12 种情绪」(一张卡只用一个音色,存着的备用声音不显示)
 *   背景「原神 · 璃月 · 16 张」/ BGM「原神 · 璃月 · 7 首」(几个包用「、」连)
 *   CG「2 个包 · 43 个构图」(只数导入的;AI 生成的包归「AI 生成」那一栏)
 *   AI 生成「相册 7 张 · 收藏 2」(没装生图卡带就没有这一行)
 */

import type { CardVoices, CgPack, SceneAsset, ScenePack, SpritePack, VoiceProfile } from '../lib/api';
import type { SlotKey, SlotRow } from './types';

/** 每一栏的名字(左栏、栏顶的类型小牌子共用) */
export const SLOT_NAMES: Record<SlotKey, string> = {
  sprite: '立绘',
  voice: '声音',
  bg: '背景',
  bgm: 'BGM',
  cg: 'CG',
  ai: 'AI 生成',
};

export interface SlotSummaryInput {
  sprite: {
    packs: readonly Pick<SpritePack, 'id' | 'name' | 'sprite_count'>[];
    /** 这张卡挂的立绘包,按顺序 */
    bound: readonly string[];
    /** 游戏里正在用的那套 */
    current: string | null;
  };
  voice: {
    profiles: readonly (Pick<VoiceProfile, 'id' | 'name'> & { emotions: readonly unknown[] })[];
    binding: Pick<CardVoices, 'main'> & { extras: readonly string[] };
  };
  scene: {
    packs: readonly Pick<ScenePack, 'id' | 'name' | 'bg_count' | 'bgm_count'>[];
    /** 背景、BGM 各绑了哪些场景包 */
    binding: { bg: readonly string[]; bgm: readonly string[] };
    /** 读到了的包内容(包 id → 素材);有就按它数,包列表里的数要等刷新才变 */
    lists?: Readonly<Record<string, readonly Pick<SceneAsset, 'kind' | 'parent_id'>[]>>;
  };
  cg: {
    packs: readonly (Pick<CgPack, 'id' | 'name' | 'cg_count'> & { generated?: boolean })[];
    /** 这张卡绑的 CG 包(含 AI 生成的),按顺序 */
    bound: readonly string[];
  };
  /** 装了生图卡带才有;counts 为 null = 相册还没读到 */
  ai?: { name: string; counts: { total: number; kept: number } | null } | null;
}

const UNBOUND = '还没有';
/** 绑着但列表里还没有(刚开机、刚建的包)时的名字 */
const PENDING = '…';

/** 「刻晴 · 玉衡星」→「玉衡星」:去掉开头的角色名;没有分隔就是整个名字 */
export function outfitOf(packName: string): string {
  const parts = packName
    .split(/[·・•]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(' · ') : (parts[0] ?? '');
}

const row = (key: SlotKey, sub: string, ok: boolean, name = SLOT_NAMES[key]): SlotRow => ({
  key,
  name,
  sub,
  state: ok ? 'ok' : 'empty',
});

function spriteRow({ packs, bound, current }: SlotSummaryInput['sprite']): SlotRow {
  if (bound.length === 0) return row('sprite', UNBOUND, false);
  const pack = packs.find((p) => p.id === (current ?? bound[0]));
  return row('sprite', `${bound.length} 套服装 · ${pack ? outfitOf(pack.name) || pack.name : PENDING}`, true);
}

function voiceRow({ profiles, binding }: SlotSummaryInput['voice']): SlotRow {
  if (!binding.main) return row('voice', UNBOUND, false);
  const main = profiles.find((p) => p.id === binding.main);
  return row('voice', `${main?.name ?? PENDING} · ${main?.emotions.length ?? 0} 种情绪`, true);
}

function sceneRow(kind: 'bg' | 'bgm', { packs, binding, lists }: SlotSummaryInput['scene']): SlotRow {
  const ids = binding[kind];
  if (ids.length === 0) return row(kind, UNBOUND, false);
  let total = 0;
  const names = ids.map((id) => {
    const pack = packs.find((p) => p.id === id);
    const list = lists?.[id];
    // 读到了包内容就按它数(CG 差分不算,背景和曲子本来也没有 parent)
    total += list
      ? list.filter((a) => a.kind === kind && !a.parent_id).length
      : (kind === 'bg' ? pack?.bg_count : pack?.bgm_count) ?? 0;
    return pack?.name ?? PENDING;
  });
  return row(kind, `${names.join('、')} · ${total} ${kind === 'bg' ? '张' : '首'}`, true);
}

function cgRow({ packs, bound }: SlotSummaryInput['cg']): SlotRow {
  // 按绑定顺序;列表里还没有的包看不出是不是 AI 生成的,先不算
  const imported = bound
    .map((id) => packs.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined && !p.generated);
  if (imported.length === 0) return row('cg', UNBOUND, false);
  if (imported.length === 1) return row('cg', `${imported[0].name} · ${imported[0].cg_count} 个构图`, true);
  const total = imported.reduce((n, p) => n + p.cg_count, 0);
  return row('cg', `${imported.length} 个包 · ${total} 个构图`, true);
}

function aiRow({ name, counts }: NonNullable<SlotSummaryInput['ai']>): SlotRow {
  if (!counts) return row('ai', PENDING, false, name);
  if (counts.total === 0) return row('ai', '相册还是空的', false, name);
  return row('ai', `相册 ${counts.total} 张 · 收藏 ${counts.kept}`, true, name);
}

/** 左栏的全部行,顺序固定:立绘、声音、背景、BGM、CG、(AI 生成) */
export function summarizeSlots(input: SlotSummaryInput): SlotRow[] {
  const rows = [
    spriteRow(input.sprite),
    voiceRow(input.voice),
    sceneRow('bg', input.scene),
    sceneRow('bgm', input.scene),
    cgRow(input.cg),
  ];
  if (input.ai) rows.push(aiRow(input.ai));
  return rows;
}
