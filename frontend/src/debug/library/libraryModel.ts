/**
 * 素材管理页(library/AssetLibrary)的纯逻辑:列表怎么排、怎么筛、哪些是重复的包、底部的占用空间、
 * 各处的字(张数、大小、删之前的提醒、导入记录的摘要),还有「绑定到角色卡…」改一张卡的绑定怎么算。
 *
 * 只 import 类型和纯模块(node 里的测试要跑);取数据在 libraryApi.ts,样子在 AssetLibrary.tsx。
 * 大小按设置页「数据」那一栏的算法(1 MB = 1,000,000 字节),两边的总数对得上。
 */

import type { CardSceneParts, CardVoices, ImportJobCounts, StorageStatus } from '../lib/api';
import { parseUtc } from '../lib/time';
import { bindSide, unbindSide } from '../studio/editors/sceneEdit';
import { bindAdd, bindRemove } from '../studio/slots/voiceSlotModel';
import type { SlotKey } from '../studio/types';

/** 五类素材(GET /api/library/{kind});背景、BGM 都是场景包的一边 */
export type LibraryKind = 'sprite' | 'voice' | 'bg' | 'bgm' | 'cg';

/** 顶栏页签:五类素材 + 导入记录 */
export type LibraryTab = LibraryKind | 'jobs';

/** 素材管理页开在哪:哪个页签、选中哪个包(null = 列表里排第一的) */
export interface LibraryRoute {
  tab: LibraryTab;
  id: string | null;
}

/** 列表里的一行(后端 LibraryItemOut) */
export interface LibraryItem {
  id: string;
  name: string;
  /** 立绘张数 / 背景张数 / 曲子首数 / CG 构图数 / 声音的情绪数 */
  count: number;
  /** 这一类文件占的地方(同一个文件只算一次);声音是 0,参考音频在语音机上 */
  bytes: number;
  /** 绑了它的卡(背景页只算绑了背景那一边的,BGM 页同理) */
  card_ids: string[];
  /** 列表缩略图的指纹;曲子、声音没有 */
  cover_sha: string | null;
  /** 文件指纹排好序的哈希:一样就是重复的包;没文件是 null */
  content_key: string | null;
  /** 来自哪次导入;手建的是 null */
  import_job_id: string | null;
  created_at: string;
  updated_at: string;
  /** 只有 CG:生图收藏建出来的(AI 生成的 CG) */
  generated?: boolean | null;
}

export interface LibraryFiles {
  files: number;
  bytes: number;
}

/** 删之前问一句用的(GET /api/library/{kind}/{id}/usage) */
export interface LibraryUsage {
  cards: { id: string; name: string; effect: string; parts?: string[] | null }[];
  files: number;
  bytes: number;
  by_kind: Partial<Record<string, LibraryFiles>>;
  /** 场景包另一边(或没拆出去的 CG)也有东西:在背景页删,曲子也一起删 */
  other_kinds: string[];
}

export type SortBy = 'size' | 'name' | 'recent';
export type LibraryFilter = 'all' | 'bound' | 'unbound' | 'active' | 'dupes' | 'generated' | 'imported';

export interface KindInfo {
  /** 页签上的字 */
  tab: string;
  /** 左栏标题:「立绘包 27 个」 */
  pack: string;
  /** 列表里:「22 张」 */
  unit: string;
  /** 顶上那一行:「16 张差分」 */
  unitLong: string;
  /** 卡编辑器素材页的哪一栏(点卡名跳过去) */
  slot: SlotKey;
}

export const KIND_ORDER: readonly LibraryKind[] = ['sprite', 'voice', 'bg', 'bgm', 'cg'];

export const KIND_INFO: Record<LibraryKind, KindInfo> = {
  sprite: { tab: '立绘', pack: '立绘包', unit: '张', unitLong: '张差分', slot: 'sprite' },
  voice: { tab: '声音', pack: '声音', unit: '种情绪', unitLong: '种情绪', slot: 'voice' },
  bg: { tab: '背景', pack: '背景包', unit: '张', unitLong: '张背景', slot: 'bg' },
  bgm: { tab: 'BGM', pack: 'BGM 包', unit: '首', unitLong: '首曲子', slot: 'bgm' },
  cg: { tab: 'CG', pack: 'CG 包', unit: '张', unitLong: '张 CG', slot: 'cg' },
};

export const SORT_LABELS: Record<SortBy, string> = {
  size: '按占用空间',
  name: '按名称',
  recent: '最近添加',
};

/** 这一类能怎么排:声音没有大小(参考在语音机上),不按占用空间排 */
export function sortOptions(kind: LibraryKind): SortBy[] {
  return kind === 'voice' ? ['name', 'recent'] : ['size', 'name', 'recent'];
}

// ---------------------------------------------------------------- 排序

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
const byName = (a: LibraryItem, b: LibraryItem) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
const timeOf = (iso: string) => {
  const t = parseUtc(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** 排好的新数组(不动原来的):占用空间大的在前 / 名字(中英文、数字按大小)/ 新建的在前;一样的按名字 */
export function sortItems(items: readonly LibraryItem[], by: SortBy): LibraryItem[] {
  const list = [...items];
  if (by === 'size') return list.sort((a, b) => b.bytes - a.bytes || byName(a, b));
  if (by === 'recent') return list.sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at) || byName(a, b));
  return list.sort(byName);
}

// ---------------------------------------------------------------- 重复

/** 文件一模一样的几组(content_key 一样、不是空的),组里至少两个;按列表里第一次出现的先后 */
export function duplicateGroups(items: readonly LibraryItem[]): LibraryItem[][] {
  const groups = new Map<string, LibraryItem[]>();
  for (const it of items) {
    if (!it.content_key) continue;
    const g = groups.get(it.content_key);
    if (g) g.push(it);
    else groups.set(it.content_key, [it]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** 和别的包重复的那些(每组都算上,原件和副本都在里面) */
export function dupeIds(items: readonly LibraryItem[]): Set<string> {
  return new Set(duplicateGroups(items).flatMap((g) => g.map((i) => i.id)));
}

// ---------------------------------------------------------------- 筛选

export interface FilterOptions {
  /** 卡 id → 卡名:搜索也找绑着它的卡 */
  cardNames?: ReadonlyMap<string, string>;
  /** 包 id → 差分名(立绘包):搜索也找差分名;没读到的包只比名字 */
  labels?: ReadonlyMap<string, readonly string[]>;
  /** 游戏里现在这张卡(菜单「素材」页「在用」筛选用);没有(调试台的素材管理页)就筛不出这一档 */
  activeCardId?: string | null;
}

function passes(it: LibraryItem, filter: LibraryFilter, dupes: Set<string>, activeCardId?: string | null): boolean {
  switch (filter) {
    case 'bound':
      return it.card_ids.length > 0;
    case 'unbound':
      return it.card_ids.length === 0;
    case 'active':
      return activeCardId != null && it.card_ids.includes(activeCardId);
    case 'dupes':
      return dupes.has(it.id);
    case 'generated':
      return it.generated === true;
    case 'imported':
      return it.generated !== true;
    default:
      return true;
  }
}

/** 筛选小按钮 + 搜索框(包名;给了的话也找绑着的卡名、差分名;不分大小写) */
export function filterItems(
  items: readonly LibraryItem[],
  filter: LibraryFilter,
  query: string,
  opts: FilterOptions = {},
): LibraryItem[] {
  const q = query.trim().toLowerCase();
  const dupes = filter === 'dupes' ? dupeIds(items) : new Set<string>();
  const has = (s: string | undefined) => s !== undefined && s.toLowerCase().includes(q);
  return items.filter(
    (it) =>
      passes(it, filter, dupes, opts.activeCardId) &&
      (!q ||
        has(it.name) ||
        it.card_ids.some((id) => has(opts.cardNames?.get(id))) ||
        (opts.labels?.get(it.id) ?? []).some(has)),
  );
}

export interface FilterChip {
  key: LibraryFilter;
  label: string;
  count: number;
}

/** 左栏那排筛选小按钮:全部 / 已绑定 / 未绑定,有重复的才出「重复」;CG 页有 AI 生成的才分「导入的 / AI 生成」 */
export function filterChips(kind: LibraryKind, items: readonly LibraryItem[]): FilterChip[] {
  const count = (f: LibraryFilter) => filterItems(items, f, '').length;
  const chips: FilterChip[] = [
    { key: 'all', label: '全部', count: items.length },
    { key: 'bound', label: '已绑定', count: count('bound') },
    { key: 'unbound', label: '未绑定', count: count('unbound') },
  ];
  const dupes = count('dupes');
  if (dupes > 0) chips.push({ key: 'dupes', label: '重复', count: dupes });
  const generated = kind === 'cg' ? count('generated') : 0;
  if (generated > 0) {
    chips.push({ key: 'imported', label: '导入的', count: count('imported') });
    chips.push({ key: 'generated', label: 'AI 生成', count: generated });
  }
  return chips;
}

/**
 * 菜单「素材」页(embedded)的筛选小按钮:10-26 用户定的更简单那套 —— 全部 / 在用,有重复的才出「重复」。
 * 「在用」= 绑给了游戏里现在这张卡(每个包页头「给她用」换的那个绑定,不是「已绑定过随便哪张卡」)
 */
export function filterChipsForActiveCard(items: readonly LibraryItem[], activeCardId: string): FilterChip[] {
  const count = (f: LibraryFilter) => filterItems(items, f, '', { activeCardId }).length;
  const chips: FilterChip[] = [
    { key: 'all', label: '全部', count: items.length },
    { key: 'active', label: '在用', count: count('active') },
  ];
  const dupes = count('dupes');
  if (dupes > 0) chips.push({ key: 'dupes', label: '重复', count: dupes });
  return chips;
}

// ---------------------------------------------------------------- 占用空间

export interface StorageSummary {
  /** 文件仓库总共多大;读不到是 null */
  total: number | null;
  files: number;
  /** 这一类的包大约占多少:一组重复的只算一份(它们共用文件) */
  kindBytes: number;
  /** 条上这一类占的比例(0–1) */
  share: number;
  /** 和别的包重复的有几个(左栏「重复」小按钮的数) */
  dupes: number;
  /** 回收区多大 */
  trash: number;
}

/**
 * 左栏底部:仓库总大小(后端 /api/meta/storage)、这一类大约占多少、重复的包有几个。
 * 「没人用的有多少」清理之前算不出来(要标记一遍全库和备份),这里不报,清理完再说挪走了多少
 */
export function storageSummary(
  items: readonly LibraryItem[],
  storage: Pick<StorageStatus, 'bytes' | 'files' | 'trash_bytes'> | null,
): StorageSummary {
  const seen = new Set<string>();
  let kindBytes = 0;
  for (const it of items) {
    if (it.content_key) {
      if (seen.has(it.content_key)) continue;
      seen.add(it.content_key);
    }
    kindBytes += it.bytes;
  }
  const total = storage ? storage.bytes : null;
  return {
    total,
    files: storage?.files ?? 0,
    kindBytes,
    share: total ? Math.min(1, kindBytes / total) : 0,
    dupes: dupeIds(items).size,
    trash: storage?.trash_bytes ?? 0,
  };
}

/** 「18 MB」:10 MB 以下留一位小数,1000 MB 起写 GB */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / 1e6;
  if (mb < 0.1) return '<0.1 MB';
  if (mb < 10) return `${Number(mb.toFixed(1))} MB`;
  if (mb < 1000) return `${Math.round(mb)} MB`;
  return `${(mb / 1000).toFixed(1)} GB`;
}

// ---------------------------------------------------------------- 字

/** 列表一行的灰字:「22 张 · 58 MB」;声音只有情绪数 */
export function itemSub(kind: LibraryKind, it: LibraryItem): string {
  const n = `${it.count} ${KIND_INFO[kind].unit}`;
  return kind === 'voice' ? n : `${n} · ${formatSize(it.bytes)}`;
}

/** 列表一行右边:「2 张卡」/「未绑定」;游戏菜单里(embedded)不说绑定:「2 张卡」/「没人用」 */
export function boundLabel(it: LibraryItem, embedded = false): string {
  if (it.card_ids.length > 0) return `${it.card_ids.length} 张卡`;
  return embedded ? '没人用' : '未绑定';
}

/** 主区顶上包名下面那行的开头:「16 张差分 · 18 MB」 */
export function headerSummary(kind: LibraryKind, it: LibraryItem): string {
  const n = `${it.count} ${KIND_INFO[kind].unitLong}`;
  return kind === 'voice' ? n : `${n} · ${formatSize(it.bytes)}`;
}

const PART_WORD: Record<string, string> = { bg: '张背景', bgm: '首曲子', cg: '张 CG' };

/**
 * 删之前的确认框里,卡列表下面那几句:会一起删掉多少文件、多大;在背景 / BGM 页删的是整个场景包(另一边也没了);
 * 和别的包是同一份文件的,删了不腾地方(sameAs = 那些包的名字)
 */
export function deleteNotes(kind: LibraryKind, usage: LibraryUsage, sameAs: readonly string[]): string[] {
  if (kind === 'voice') {
    return [
      usage.files > 0
        ? `${usage.files} 种情绪的设置会一起删掉,删了就找不回来(参考音频在语音机上,不会删)。`
        : '删了就找不回来(参考音频在语音机上,不会删)。',
    ];
  }
  const scene = kind === 'bg' || kind === 'bgm';
  const own = scene ? (usage.by_kind[kind] ?? { files: 0, bytes: 0 }) : { files: usage.files, bytes: usage.bytes };
  const noun = kind === 'bg' ? '张背景' : kind === 'bgm' ? '首曲子' : '张图';
  const others = scene
    ? usage.other_kinds
        .map((k) => ({ k, f: usage.by_kind[k] }))
        .filter((x): x is { k: string; f: LibraryFiles } => Boolean(x.f && x.f.files > 0))
    : [];
  const out: string[] = [];
  if (own.files === 0 && others.length === 0) return ['包里还没有东西。'];
  const dup = sameAs.length > 0;
  if (own.files > 0) {
    out.push(
      dup
        ? `${own.files} ${noun}会一起删掉,删了就找不回来。`
        : `${own.files} ${noun}、${formatSize(own.bytes)} 会一起删掉,删了就找不回来。`,
    );
  }
  if (others.length > 0) {
    const what = others.map(({ k, f }) => `${f.files} ${PART_WORD[k] ?? '个文件'}(${formatSize(f.bytes)})`).join('、');
    out.push(`背景和 BGM 在同一个场景包里:包里的 ${what}也会一起删掉。`);
  }
  if (dup) {
    const thing = kind === 'bgm' ? '曲子' : '图';
    out.push(`${thing}和${sameAs.map((n) => `「${n}」`).join('、')}是同一份文件,删了不会腾出空间。`);
  }
  return out;
}

/** 导入记录一行的摘要:「1 张卡 · 2 套立绘 · 1 个场景包 · 绑定 3 处」,是 0 的不写 */
export function jobSummary(c: ImportJobCounts): string {
  const parts = [
    c.cards && `${c.cards} 张卡`,
    c.sprite_packs && `${c.sprite_packs} 套立绘`,
    c.scene_packs && `${c.scene_packs} 个场景包`,
    c.cg_packs && `${c.cg_packs} 个 CG 包`,
    c.bound && `绑定 ${c.bound} 处`,
    c.updated_cards && `改了 ${c.updated_cards} 张卡的资料`,
    c.unknown && `${c.unknown} 个文件没认出来`,
  ].filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(' · ') : '没有新建东西';
}

// ---------------------------------------------------------------- 绑定到角色卡

/** 每一类卡上的绑定长什么样:立绘 / CG 是包的列表,背景 / BGM 是场景包的两边,声音是主声音 + 备用 */
export interface BindingOf {
  sprite: string[];
  cg: string[];
  bg: CardSceneParts;
  bgm: CardSceneParts;
  voice: CardVoices;
}

/**
 * 把一个包加到 / 拿出一张卡的绑定(读出来改一处再写回去用)。立绘、CG 接在最后;背景 / BGM 只动那一边;
 * 声音:这张卡还没有主声音就当主声音,有了就当备用;拿掉主声音不顶替(和删声音时一样,那张卡就不念台词了)
 */
export function bindingWith<K extends LibraryKind>(kind: K, current: BindingOf[K], id: string, on: boolean): BindingOf[K];
export function bindingWith(kind: LibraryKind, current: BindingOf[LibraryKind], id: string, on: boolean) {
  if (kind === 'bg' || kind === 'bgm') {
    const parts = current as CardSceneParts;
    return on ? bindSide(parts, kind, id) : unbindSide(parts, kind, id);
  }
  if (kind === 'voice') {
    // 和卡编辑器声音栏的「＋」/「解除绑定」一样
    const v = current as CardVoices;
    return on ? bindAdd(v, id) : bindRemove(v, id);
  }
  const ids = current as string[];
  if (on) return ids.includes(id) ? ids : [...ids, id];
  return ids.filter((x) => x !== id);
}

/** 勾选框改完:哪些卡要加、哪些要拿掉(按卡列表的顺序) */
export function bindChanges(
  order: readonly string[],
  before: readonly string[],
  checked: ReadonlySet<string>,
): { add: string[]; remove: string[] } {
  const had = new Set(before);
  return {
    add: order.filter((id) => checked.has(id) && !had.has(id)),
    remove: order.filter((id) => had.has(id) && !checked.has(id)),
  };
}
