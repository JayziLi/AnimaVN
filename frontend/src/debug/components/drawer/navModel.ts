/**
 * 插件抽屉左栏(第 2 步第四版,plans/2026-10-16-asset-arch-step2-impl.md D1):三组。
 *   角色  立绘、语音、背景、BGM、CG、外语(插件总表 plugins/registry.ts 的先后),再接角色组的卡带(按 after 插)
 *   全局  Jev 标注、语音服务、自动补块、表情认法 —— 所有卡共用,行尾写现在的状态
 *   实验  实验组的卡带;一个都没有(公开版)就整组不画
 * 一行 = 圆点(这张卡在不在用)、名字、BETA、行尾(总开关 / 状态字)。纯逻辑,画法在 PluginsDrawer.tsx。
 */

import type { CartridgePanel } from '../../plugins/cartridges';
import { isJaLang } from '../../plugins/lang';
import { navItems } from '../../plugins/registry';
import type { PluginSwitches, SwitchKind } from '../../plugins/switches';
import type { DrawerCardFacts } from './cardView';

export type NavGroupId = 'role' | 'global' | 'lab';
export type GlobalPageId = 'jev' | 'tts' | 'autofill' | 'engine';

export interface NavRow {
  /** 页面 id:插件总表的 id、GlobalPageId、卡带的 key */
  id: string;
  name: string;
  group: NavGroupId;
  beta: boolean;
  /** 圆点:true 实心 / false 空心 / null 不画(全局组、卡带没说) */
  inUse: boolean | null;
  end: { kind: 'switch'; on: boolean; label: string } | { kind: 'text'; text: string } | null;
}

export interface NavGroup {
  id: NavGroupId;
  title: string;
  rows: NavRow[];
}

export interface NavInput {
  panels: readonly CartridgePanel[];
  /** 抽屉里看的那张卡;还没有卡是 null */
  card: DrawerCardFacts | null;
  switches: PluginSwitches;
  /** plugin.voice.enabled */
  voiceOn: boolean;
  /** 全局组行尾的状态;engine 还没读到是 null */
  status: { jev: string; tts: string; autoFill: boolean; engine: 'legacy' | 'records' | null };
}

/** 全局组的四页,固定这个先后 */
export const GLOBAL_PAGES: readonly { id: GlobalPageId; name: string }[] = [
  { id: 'jev', name: 'Jev 标注' },
  { id: 'tts', name: '语音服务' },
  { id: 'autofill', name: '自动补块' },
  { id: 'engine', name: '表情认法' },
];

export const isGlobalPage = (id: string): id is GlobalPageId => GLOBAL_PAGES.some((p) => p.id === id);

const GROUP_TITLE: Record<NavGroupId, string> = { role: '角色', global: '全局', lab: '实验' };

/** 行尾是插件开关(plugins/switches.ts)的那几页 */
const SWITCH_OF: Partial<Record<string, SwitchKind>> = { sprite: 'sprite', bg: 'bg', bgm: 'bgm', cg: 'cg' };

const groupOf = (p: CartridgePanel) => p.group ?? 'role';

/** 内核的几页这张卡在不在用 */
function coreInUse(id: string, card: DrawerCardFacts): boolean {
  switch (id) {
    case 'sprite':
      return card.sprites > 0;
    case 'voice':
      return card.mainVoice !== null;
    case 'bg':
      return card.scene.bg > 0;
    case 'bgm':
      return card.scene.bgm > 0;
    case 'cg':
      return card.scene.cg > 0;
    case 'lang':
      return card.mainVoice !== null && isJaLang(card.mainVoice.text_lang);
    default:
      return false;
  }
}

const switchEnd = (name: string, on: boolean): NavRow['end'] => ({ kind: 'switch', on, label: `${name}开关` });

function coreEnd(id: string, name: string, i: NavInput): NavRow['end'] {
  const kind = SWITCH_OF[id];
  if (kind) return switchEnd(name, i.switches[kind]);
  if (id === 'voice') return switchEnd(name, i.voiceOn);
  if (id === 'lang') return { kind: 'text', text: '自动' };
  return null;
}

function panelRow(p: CartridgePanel, i: NavInput): NavRow {
  return {
    id: p.key,
    name: p.title,
    group: groupOf(p),
    beta: Boolean(p.beta),
    inUse: !p.inUse ? null : i.card ? p.inUse(i.card) : false,
    end: p.power ? switchEnd(p.title, i.switches[p.power]) : p.toggle ? switchEnd(p.title, p.toggle.on) : null,
  };
}

/**
 * 实验组:after 不指着组里别的页的,按传进来的先后排;指着组里另一页的插在它(和已经跟着它的)后面。
 * 传进来的先后反了也一样;绕成圈的接在最后
 */
function labOrder(panels: readonly CartridgePanel[]): CartridgePanel[] {
  const keys = new Set(panels.map((p) => p.key));
  const out = panels.filter((p) => !keys.has(p.after));
  let rest = panels.filter((p) => keys.has(p.after));
  while (rest.length > 0) {
    const ready = rest.filter((p) => out.some((q) => q.key === p.after));
    if (ready.length === 0) {
      out.push(...rest);
      break;
    }
    for (const p of ready) {
      let at = out.findIndex((q) => q.key === p.after);
      while (at + 1 < out.length && out[at + 1].after === p.after) at++;
      out.splice(at + 1, 0, p);
    }
    rest = rest.filter((p) => !ready.includes(p));
  }
  return out;
}

const ENGINE_TEXT = { legacy: '旧算法', records: '认词记录' } as const;

function globalEnd(id: GlobalPageId, s: NavInput['status']): string {
  switch (id) {
    case 'jev':
      return s.jev;
    case 'tts':
      return s.tts;
    case 'autofill':
      return s.autoFill ? '开' : '关';
    case 'engine':
      return s.engine ? ENGINE_TEXT[s.engine] : '…';
  }
}

/** 左栏的三组;空组不返回 */
export function drawerNav(i: NavInput): NavGroup[] {
  const rolePanels = i.panels.filter((p) => groupOf(p) === 'role');
  const role: NavRow[] = navItems(rolePanels).map((item) => {
    const panel = rolePanels.find((p) => p.key === item.id);
    if (panel) return panelRow(panel, i);
    return {
      id: item.id,
      name: item.name,
      group: 'role',
      beta: item.beta,
      inUse: i.card ? coreInUse(item.id, i.card) : false,
      end: coreEnd(item.id, item.name, i),
    };
  });
  const global: NavRow[] = GLOBAL_PAGES.map((p) => ({
    id: p.id,
    name: p.name,
    group: 'global',
    beta: false,
    inUse: null,
    end: { kind: 'text', text: globalEnd(p.id, i.status) },
  }));
  const lab = labOrder(i.panels.filter((p) => groupOf(p) === 'lab')).map((p) => panelRow(p, i));
  const groups: NavGroup[] = [
    { id: 'role', title: GROUP_TITLE.role, rows: role },
    { id: 'global', title: GROUP_TITLE.global, rows: global },
    { id: 'lab', title: GROUP_TITLE.lab, rows: lab },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** 行尾开关点了改哪一样 */
export type NavSwitchTarget = { kind: 'switch'; key: SwitchKind } | { kind: 'voice' } | { kind: 'panel'; key: string };

export function switchTargetOf(rowId: string, panels: readonly CartridgePanel[]): NavSwitchTarget | null {
  const kind = SWITCH_OF[rowId];
  if (kind) return { kind: 'switch', key: kind };
  if (rowId === 'voice') return { kind: 'voice' };
  const panel = panels.find((p) => p.key === rowId);
  if (panel?.power) return { kind: 'switch', key: panel.power };
  if (panel?.toggle) return { kind: 'panel', key: panel.key };
  return null;
}

/** 游戏皮左栏一行行尾画什么:全局组写状态字;角色 / 实验组开关关着写「关」,否则一个圆点(在用 = 实心)、没有圆点的页什么都不画 */
export type GameEnd = { kind: 'text'; text: string } | { kind: 'off' } | { kind: 'dot'; on: boolean } | null;

export function gameEnd(r: NavRow): GameEnd {
  if (r.group === 'global') return r.end?.kind === 'text' ? { kind: 'text', text: r.end.text } : null;
  if (r.end?.kind === 'switch' && !r.end.on) return { kind: 'off' };
  return r.inUse === null ? null : { kind: 'dot', on: r.inUse };
}
