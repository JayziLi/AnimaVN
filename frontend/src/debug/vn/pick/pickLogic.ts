/**
 * 选角色页的纯逻辑(不碰网络、不碰 React,好测):搜索、排序、右边「一条一条的素材」、名字下面「上次」那行。
 * 10-23 定的新版:不写作品名、不放角色台词、不按标签筛 —— 搜索只认名字和作者。
 */

import { relTime } from '../../lib/time';

/** 搜索:名字、作者(标签不参与,玩家不会自觉给角色建标签,10-20) */
export function matchCard(name: string, creator: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [name, creator ?? ''].some((s) => s.toLowerCase().includes(q));
}

export type PickSort = 'recent' | 'name';

export interface SortItem {
  id: string;
  name: string;
  /** 卡最近一次改动(后端 updated_at);还没拉到是空串 */
  updatedAt: string;
}

/** 「最近」:正在玩的排第一,其余按卡最近的改动;「名字」:按拼音 */
export function sortCards<T extends SortItem>(rows: readonly T[], sort: PickSort, currentId: string | null): T[] {
  const out = [...rows];
  if (sort === 'name') return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const t = (c: T) => (c.id === currentId ? '~' : c.updatedAt);
  return out.sort((a, b) => (t(a) < t(b) ? 1 : t(a) > t(b) ? -1 : 0));
}

/** 右边每一条素材能「更多」去哪一页:菜单里对应的页 */
export type PickMoreKind = 'sprite' | 'scene' | 'voice' | 'preset' | 'persona';

export interface PickRow {
  kind: PickMoreKind;
  /** 左边的名目(宋体)和斜体英文 */
  k: string;
  en: string;
  /** 值;sub 是值下面一行小字 */
  v: string;
  sub?: string;
}

/** 这张卡绑着的东西(vn/pick/pickBind.ts 拉回来的,名字都是库里真有的) */
export interface PickBind {
  /** 当前立绘包的名字;没挂包是 null */
  spritePack: string | null;
  scene: { name: string; bg: number; bgm: number; cg: number } | null;
  voice: string | null;
  preset: string | null;
  persona: string | null;
  /** 这张卡上次打开的那段对话:什么时候改的、几条 */
  lastChat: { at: string; count: number } | null;
}

export const EMPTY_BIND: PickBind = { spritePack: null, scene: null, voice: null, preset: null, persona: null, lastChat: null };

/**
 * 右边一条一条的素材:立绘、场景一定有(没绑就写「没有……」),声音、预设、人设有绑才写。
 * 还没拉到(bind 是 undefined)时只给立绘、场景两条占位,不闪:值留空,拉到了再填
 */
export function pickRows(bind: PickBind | undefined, spriteCount: number): PickRow[] {
  const b = bind ?? EMPTY_BIND;
  const rows: PickRow[] = [];
  if (spriteCount === 0) {
    rows.push({ kind: 'sprite', k: '立绘', en: 'Sprites', v: '没有立绘包', sub: '用卡里带的那张图' });
  } else {
    rows.push({
      kind: 'sprite',
      k: '立绘',
      en: 'Sprites',
      v: b.spritePack ? `「${b.spritePack}」· ${spriteCount} 张` : `${spriteCount} 张`,
    });
  }
  if (!b.scene) rows.push({ kind: 'scene', k: '场景', en: 'Scenes', v: '没有场景包' });
  else {
    const sub = [`背景 ${b.scene.bg}`, `BGM ${b.scene.bgm}`, b.scene.cg > 0 ? `CG ${b.scene.cg}` : ''].filter(Boolean).join(' · ');
    rows.push({ kind: 'scene', k: '场景', en: 'Scenes', v: `「${b.scene.name}」`, sub });
  }
  if (b.voice) rows.push({ kind: 'voice', k: '声音', en: 'Voice', v: b.voice });
  if (b.preset) rows.push({ kind: 'preset', k: '预设', en: 'Preset', v: b.preset });
  if (b.persona) rows.push({ kind: 'persona', k: '人设', en: 'Persona', v: b.persona });
  return rows;
}

/**
 * 名字下面那一行:只写什么时候、几条(不放角色台词、不写作品名)。
 * 当前这位的时间用游戏里的 lastPlayed,别人的用拉到的那段对话
 */
export function lastLineText(o: {
  isCurrent: boolean;
  hasLastChat: boolean;
  lastPlayed: string | null;
  bind: PickBind | undefined;
  /** 当前这位停在哪个场景(游戏里现在的背景名;设计稿「上次 · 客厅 · 3 周前 · 11 条」);别人的不知道,不写 */
  scene?: string | null;
}): string {
  const at = o.isCurrent && o.lastPlayed ? o.lastPlayed : (o.bind?.lastChat?.at ?? null);
  const n = o.bind?.lastChat?.count ?? 0;
  const where = o.isCurrent ? o.scene?.trim() || '' : '';
  if (at) {
    const when = relTime(at);
    if (when) return ['上次', where, when, n > 0 ? `${n} 条` : ''].filter(Boolean).join(' · ');
  }
  return o.isCurrent || o.hasLastChat ? '有上次的对话' : '还没开始';
}

/** 有没有玩过:决定按钮写「继续」还是「开始」 */
export const hasPlayed = (isCurrent: boolean, hasLastChat: boolean) => isCurrent || hasLastChat;
