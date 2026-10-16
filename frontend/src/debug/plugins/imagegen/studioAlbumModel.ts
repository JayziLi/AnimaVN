/**
 * 卡编辑器「AI 生成」栏(StudioAlbum.tsx)的纯逻辑:相册里的图和收藏进 CG 包的那些怎么排、怎么筛、
 * 右栏的生成参数和收藏状态怎么说、舞台「放在哪」的选项、底下那排设置摘要。有测试(studioAlbumModel.test.ts)。
 *
 * 「收藏」以 CG 包为准:收藏建的「AI 生图 · 卡名」包(generated)里还在的才算(包里删掉了 = 没收藏,再点 ☆ 会重新收藏);
 * 包还没读到时先看相册记录上的 kept_asset_id。相册里的记录删了、包里那张还在的,接在「已收藏」最后。
 */

import type { SceneAsset } from '../../lib/api';
import { cgNarration } from '../../studio/editors/cgEdit';
import { TERMS } from '../../studio/terms';
import type { GeneratedImage } from './api';
import { MODELS, styleFor, supportsReference, type CardImagePrefs, type ImageGenConfig } from './config';

export type AlbumFilter = 'all' | 'manual' | 'auto' | 'kept';

/** 相册上面那排筛选 */
export const ALBUM_FILTERS: readonly { key: AlbumFilter; name: string }[] = [
  { key: 'all', name: '全部' },
  { key: 'manual', name: '手动' },
  { key: 'auto', name: '自动' },
  { key: 'kept', name: '已收藏' },
];

/** 相册里的一格 */
export interface AlbumEntry {
  /** 相册记录的 id;只在 CG 包里的是 cg:构图 id */
  key: string;
  /** 相册里那条记录;null = 只在 CG 包里(相册里的记录删了,或者太早没列出来) */
  image: GeneratedImage | null;
  /** 收藏进 CG 包的那张构图;没收藏、或者 CG 包还没读到是 null */
  cg: SceneAsset | null;
  kept: boolean;
}

/**
 * 相册条目:相册里的图按原来的顺序(新的在前),后面接只在 CG 包里的。
 * kept = 这张卡绑的 AI 生成 CG 包里的构图;null = 还没读到(收藏先看记录,不出只在包里的)。
 * pending = 刚收藏的那几张 CG 的 id:收藏完到重读完 CG 绑定之间,包里还没有它们,也算收藏了(☆ 不会闪回去)
 */
export function albumEntries(
  images: readonly GeneratedImage[],
  kept: readonly SceneAsset[] | null,
  pending: ReadonlySet<string> = new Set(),
): AlbumEntry[] {
  if (kept === null) {
    return images.map((image) => ({ key: image.id, image, cg: null, kept: Boolean(image.kept_asset_id) }));
  }
  const cgs = kept.filter((a) => !a.parent_id);
  const byId = new Map(cgs.map((a) => [a.id, a]));
  const out: AlbumEntry[] = images.map((image) => {
    const id = image.kept_asset_id;
    const cg = id ? (byId.get(id) ?? null) : null;
    return { key: image.id, image, cg, kept: cg !== null || (id !== null && pending.has(id)) };
  });
  const referenced = new Set(images.map((i) => i.kept_asset_id).filter(Boolean));
  for (const cg of cgs) if (!referenced.has(cg.id)) out.push({ key: `cg:${cg.id}`, image: null, cg, kept: true });
  return out;
}

/** 手动 = 玩家点的(画笔、「换一张」);自动 = 自动出图 */
const isAuto = (e: AlbumEntry) => e.image?.trigger === 'auto';

function matches(e: AlbumEntry, filter: AlbumFilter): boolean {
  if (filter === 'kept') return e.kept;
  if (!e.image) return false;
  if (filter === 'manual') return !isAuto(e);
  if (filter === 'auto') return isAuto(e);
  return true;
}

/** 每个筛选下有几张(「全部」只数相册里的,只在 CG 包里的只出现在「已收藏」) */
export function albumCounts(entries: readonly AlbumEntry[]): Record<AlbumFilter, number> {
  const n = (f: AlbumFilter) => entries.filter((e) => matches(e, f)).length;
  return { all: n('all'), manual: n('manual'), auto: n('auto'), kept: n('kept') };
}

export function filterAlbum(entries: readonly AlbumEntry[], filter: AlbumFilter): AlbumEntry[] {
  return entries.filter((e) => matches(e, filter));
}

/** 左栏那一行的数:相册几张、收藏几张(包读到了按包里的构图数);相册还没读到是 null */
export function albumSummary(
  images: readonly GeneratedImage[] | null,
  kept: readonly SceneAsset[] | null,
): { total: number; kept: number } | null {
  if (images === null) return null;
  return {
    total: images.length,
    kept: kept === null ? images.filter((i) => i.kept_asset_id).length : kept.filter((a) => !a.parent_id).length,
  };
}

/** 选中的那张:还在(筛选后的)列表里就留着,不在了换成第一张 */
export function pickEntry(entries: readonly AlbumEntry[], key: string | null): AlbumEntry | null {
  return entries.find((e) => e.key === key) ?? entries[0] ?? null;
}

// ---------------------------------------------------------------- 右栏

export function triggerName(trigger: GeneratedImage['trigger']): string {
  return trigger === 'auto' ? '自动' : trigger === 'reroll' ? '换一张' : '手动';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 「10-13 18:30」;不是今年的带上年份;读不出来是空串 */
function timeText(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? day : `${d.getFullYear()}-${day}`;
}

/** 右栏标题下面那行:「10-13 18:30 · 手动 · 4.3 秒」 */
export function metaLine(image: GeneratedImage, now: Date = new Date()): string {
  return [timeText(image.created_at, now), triggerName(image.trigger), image.ms > 0 ? `${(image.ms / 1000).toFixed(1)} 秒` : '']
    .filter(Boolean)
    .join(' · ');
}

/** 「V5 Full」:设置页里的名字去掉括号里的说明;不认得的原样 */
export function modelName(id: string | undefined): string {
  if (!id) return '—';
  const m = MODELS.find((x) => x.id === id);
  return m ? m.name.replace(/[(（].*$/, '').trim() : id;
}

/** 参考图那一行:带了什么 / 设了没带上的原因 / 没用 */
export function referenceText(params: GeneratedImage['params']): string {
  const ref = params.reference;
  if (ref) {
    const what = ref.kind === 'upload' ? '用了上传的图' : ref.id ? '用了立绘' : '用了默认立绘';
    return ref.style ? `${what} · 连画风一起` : what;
  }
  if (params.reference_note) return `没用(${params.reference_note})`;
  return params.model && supportsReference(params.model) ? '没用' : '没用(只有 V4.5 能用)';
}

const dash = (v: number | string | undefined | null) => (v === undefined || v === null || v === '' ? '—' : String(v));

/** 「生成参数」那几行 */
export function paramRows(image: GeneratedImage): { label: string; value: string }[] {
  const p = image.params;
  return [
    { label: '模型', value: modelName(p.model) },
    { label: '尺寸', value: p.width && p.height ? `${p.width} × ${p.height}` : '—' },
    { label: '步数 · 引导', value: `${dash(p.steps)} · ${dash(p.scale)}` },
    { label: '种子', value: dash(p.seed) },
    { label: '参考图', value: referenceText(p) },
  ];
}

/** 提示词:主提示词,后面接每个人各自的(NovelAI 的角色提示词),空的不要 */
export function promptText(image: GeneratedImage): string {
  return [image.prompt, ...image.chars.map((c) => c.prompt)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** 收藏状态那一框里的话(只在 CG 包里的那张,相册里没有记录的事右栏另外说) */
export function keptText(e: AlbumEntry): string {
  if (!e.kept) return '还没收藏,游戏里 AI / Jev 选不到它';
  return e.cg ? `已收藏 · CG 名「${e.cg.label}」· 游戏里 AI / Jev 能选它` : '已收藏 · 游戏里 AI / Jev 能选它';
}

/** 舞台对话框里的旁白:画面描述截短,没写就用标题;只在包里的用构图 */
export function narrationOf(e: AlbumEntry): string {
  if (e.image) return cgNarration({ label: e.image.title.trim() || '(没有说明)', description: e.image.description });
  return e.cg ? cgNarration(e.cg) : '';
}

/** 「?」说明里的「卡名」换成真的卡名(terms.ts 的 keep) */
export function withCardName(text: string, cardName: string): string {
  const name = cardName.trim();
  return name ? text.replaceAll('卡名', name) : text;
}

/** 相册标题旁的小字 */
export function albumNote(total: number, cardName: string): string {
  return `${total} 张 · ☆ 收藏后进「AI 生图 · ${cardName.trim() || '卡名'}」CG 包`;
}

/** 筛选下一张都没有时网格那里的话 */
export function emptyNote(filter: AlbumFilter): string {
  if (filter === 'manual') return '还没有手动画的 · 游戏里点对话框旁边的画笔画一张';
  if (filter === 'auto') return '还没有自动出的图 · 自动出图开着时,写完一条回复导演会判要不要画';
  if (filter === 'kept') return '还没有收藏 · 点图右上角的 ☆ 收藏进 CG 包,游戏里 AI / Jev 才选得到';
  return '相册还是空的 · 在游戏里点画笔画一张,或者开自动出图';
}

// ---------------------------------------------------------------- 舞台、设置摘要

/** 舞台右上角「放在哪」:改的是生图设置里的 place(和设置页「画面」里那一项是同一个) */
export const PLACE_OPTIONS: readonly { value: ImageGenConfig['place']; name: string }[] = [
  { value: 'above', name: '对话框上面' },
  { value: 'screen', name: '铺满屏幕' },
];

export const placeName = (place: ImageGenConfig['place']) => PLACE_OPTIONS.find((o) => o.value === place)?.name ?? place;

export interface SettingsCell {
  label: string;
  value: string;
  /** 标题旁「?」的说明 */
  help?: string;
}

/** 底下那排设置摘要:角色名、画风、参考图、自动出图(点了打开生图设置去改) */
export function settingsCells(config: ImageGenConfig, prefs: CardImagePrefs): SettingsCell[] {
  const own = prefs.styleId ? config.styles.find((s) => s.id === prefs.styleId) : undefined;
  const style = own ? `这张卡另选 · ${own.name}` : `跟「画面」里的 · ${styleFor(config, prefs).name}`;
  const kind = prefs.ref.kind;
  const ref =
    kind === 'off'
      ? '不用'
      : `${kind === 'upload' ? '用上传的图' : '用立绘'}${supportsReference(config.model) ? '' : ' · V5 不生效'}`;
  const auto = !config.auto.enabled ? '关(全局)' : prefs.autoOff ? '这张卡关了' : '开';
  return [
    { label: '角色名', value: prefs.nameTag.trim() || '没填(原创角色)' },
    { label: '画风', value: style },
    { label: '参考图', value: ref, help: TERMS.genRef },
    { label: '自动出图', value: auto },
  ];
}
