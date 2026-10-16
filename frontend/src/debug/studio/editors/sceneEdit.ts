/**
 * 背景栏、BGM 栏的几样小算法:默认 BGM 下拉里有哪些曲子、切到一张背景时游戏里放什么、
 * 一首曲子被哪些背景当默认、封面曲是哪首、绑定只改一边、曲子删了以后背景上的引用、时长怎么写。
 *
 * 和游戏里的规则一样(plugins/scene.ts 的 applySceneTag、titleBgmOf):
 *   - 背景的默认 BGM 要在这张卡拼好的素材里(BGM 栏绑的包)、没停用,才会换;否则等于「不换」
 *   - 封面曲是包里设的那首(还在、没停用),否则是排第一的那首
 */

import type { SceneAsset, ScenePack } from '../../lib/api';
import type { SceneBinding } from '../../plugins/scenePacks';
import type { SelectOption } from '../ui';

export type SceneSide = 'bg' | 'bgm';

export const NO_BGM_LABEL = '不换(沿用之前的音乐)';
/** 背景的默认 BGM 指着这张卡没绑的包里的曲子(后端允许指向任何包) */
export const FOREIGN_BGM_LABEL = '(另一个包里的曲子,这张卡没绑)';

/** 播放器读到时长才有;秒 → 2:05 / 1:02:03 */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 默认 BGM 能选的一首:曲子本身 + 它所在的包名 */
export interface BgmChoice {
  asset: SceneAsset;
  packName: string;
}

/** BGM 栏绑的每个包里的曲子,按绑定顺序、包里原来的顺序;包的列表还没读到就先跳过 */
export function bgmChoicesOf(
  bgmPackIds: readonly string[],
  packs: readonly Pick<ScenePack, 'id' | 'name'>[],
  lists: Readonly<Record<string, readonly SceneAsset[] | undefined>>,
): BgmChoice[] {
  const seen = new Set<string>();
  const out: BgmChoice[] = [];
  for (const pid of bgmPackIds) {
    const packName = packs.find((p) => p.id === pid)?.name ?? '…';
    for (const a of lists[pid] ?? []) {
      if (a.kind !== 'bgm' || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ asset: a, packName });
    }
  }
  return out;
}

/**
 * 右栏「默认 BGM」下拉:先是「不换」,再是能选的每首(右边灰字写包名;停用的标出来)。
 * 存着的曲子不在里面(在这张卡没绑的包里)时多一行,下拉才显示得出来,也能改掉;knownName = 知道的话它的曲名
 */
export function defaultBgmOptions(
  choices: readonly BgmChoice[],
  currentId: string | null,
  knownName?: string,
): SelectOption[] {
  const opts: SelectOption[] = [{ value: '', label: NO_BGM_LABEL }];
  for (const { asset, packName } of choices) {
    if (opts.some((o) => o.value === asset.id)) continue;
    opts.push({ value: asset.id, label: asset.enabled ? asset.label : `${asset.label}(已停用)`, sub: packName });
  }
  if (currentId && !opts.some((o) => o.value === currentId)) {
    opts.push(knownName ? { value: currentId, label: FOREIGN_BGM_LABEL, sub: knownName } : { value: currentId, label: FOREIGN_BGM_LABEL });
  }
  return opts;
}

/**
 * 切到这张背景时游戏里放什么(网格里「♪ 甜蜜」、舞台左下角那条用):
 *   ok      换成这首
 *   none    没设,不换
 *   off     设了,但曲子停用了 / 没传文件:游戏里放不出来,等于不换
 *   foreign 设的曲子在这张卡没绑的包里:游戏里找不到,等于不换
 */
export interface BgmTag {
  state: 'ok' | 'none' | 'off' | 'foreign';
  text: string;
  choice: BgmChoice | null;
}

export function bgmTag(bg: Pick<SceneAsset, 'bgm_id'>, choices: readonly BgmChoice[]): BgmTag {
  if (!bg.bgm_id) return { state: 'none', text: '不换', choice: null };
  const choice = choices.find((c) => c.asset.id === bg.bgm_id) ?? null;
  if (!choice) return { state: 'foreign', text: '没绑的曲子', choice: null };
  const playable = choice.asset.enabled && choice.asset.has_file;
  return { state: playable ? 'ok' : 'off', text: choice.asset.label, choice };
}

/** 把一首曲子当默认 BGM 的一张背景 */
export interface BgmUser {
  id: string;
  label: string;
  packName: string;
  asset: SceneAsset;
}

/** 每首曲子 → 把它当默认 BGM 的背景(按来源顺序,同一张背景只算一次);背景可以指向别的包里的曲子 */
export function defaultBgmUsers(
  sources: readonly { packName: string; list: readonly SceneAsset[] }[],
): Map<string, BgmUser[]> {
  const out = new Map<string, BgmUser[]>();
  const seen = new Set<string>();
  for (const { packName, list } of sources) {
    for (const a of list) {
      if (a.kind !== 'bg' || !a.bgm_id || seen.has(a.id)) continue;
      seen.add(a.id);
      const users = out.get(a.bgm_id) ?? [];
      users.push({ id: a.id, label: a.label, packName, asset: a });
      out.set(a.bgm_id, users);
    }
  }
  return out;
}

/** 这个包的封面曲:设了的那首(还在、没停用)= explicit;否则排第一的、没停用的那首;一首能放的都没有是 null */
export function coverTrack(
  tracks: readonly Pick<SceneAsset, 'id' | 'enabled'>[],
  titleBgmId: string | null,
): { id: string; explicit: boolean } | null {
  const chosen = titleBgmId ? tracks.find((t) => t.id === titleBgmId && t.enabled) : undefined;
  if (chosen) return { id: chosen.id, explicit: true };
  const first = tracks.find((t) => t.enabled);
  return first ? { id: first.id, explicit: false } : null;
}

/** 只往一边加一个包(接在后面);已经在那边了原样返回 */
export function bindSide(binding: SceneBinding, side: SceneSide, packId: string): SceneBinding {
  if (binding[side].includes(packId)) return binding;
  return { ...binding, [side]: [...binding[side], packId] };
}

/** 只从一边拿掉一个包;另一边还用着就留着 */
export function unbindSide(binding: SceneBinding, side: SceneSide, packId: string): SceneBinding {
  return { ...binding, [side]: binding[side].filter((id) => id !== packId) };
}

/** 曲子删了:后端把所有背景上指向它的默认 BGM 清掉,本地列表照着改;没有指向它的原样返回 */
export function clearBgmRefs(list: SceneAsset[], trackId: string): SceneAsset[] {
  if (!list.some((a) => a.bgm_id === trackId)) return list;
  return list.map((a) => (a.bgm_id === trackId ? { ...a, bgm_id: null } : a));
}

/**
 * 排序接口只回这一类(背景 / 曲子)的新顺序:换进包的完整列表里原来那几个位置,别的类不动。
 * 对不上(数目不一样)就原样返回,外面会重新读
 */
export function withKindOrder(list: SceneAsset[], kind: SceneSide, rows: readonly SceneAsset[]): SceneAsset[] {
  const slots = list.filter((a) => a.kind === kind && !a.parent_id).length;
  if (slots !== rows.length) return list;
  let i = 0;
  return list.map((a) => (a.kind === kind && !a.parent_id ? rows[i++] : a));
}

/** 一个包这一边有几张背景 / 几首曲子:读到了包内容按它数,否则看包列表里的数 */
export function sideCount(
  side: SceneSide,
  list: readonly Pick<SceneAsset, 'kind'>[] | undefined,
  pack: Pick<ScenePack, 'bg_count' | 'bgm_count'> | undefined,
): number {
  if (list) return list.filter((a) => a.kind === side).length;
  return (side === 'bg' ? pack?.bg_count : pack?.bgm_count) ?? 0;
}

/** 删一张背景 / 一首曲子前的提醒:包被两张以上的卡用时才说 */
export function sharedDeleteNote(cardCount: number | undefined, unit: '张' | '首'): string | null {
  return cardCount && cardCount >= 2 ? `这个包被 ${cardCount} 张卡用,删了它们都没有这${unit}了` : null;
}
