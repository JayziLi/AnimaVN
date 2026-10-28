/**
 * 管理工具页的左右两栏:能拖宽、能收起,照调试台三栏的做法(DebugApp 的 startDrag / panel-rail)——
 *   收起 = 一条 44px 的竖条,竖着写栏名,点一下摊开;展开时栏头有个收起按钮
 *   两栏和中间之间的分隔线能拖;宽度、收没收起记在 localStorage(每个页面一个 key)
 *   窗口变小时两栏按占比一起收,中间至少留 middleMin;拖宽也不能把中间挤到它以下
 * 窄屏(< 900px,页面改成上下排)时不拖不收,分隔线、竖条、收起按钮由页面样式藏掉(library.css)。
 *
 * 竖条、分隔线、收起按钮三个小组件在 panelParts.tsx。
 * 右栏(Inspector)是各个编辑器自己画的:页面用 InspectorCollapse 把「收起右栏」递进去,Inspector 自己在右上角放按钮;
 * 不给(卡编辑器)就没有这个按钮。
 */

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type Side = 'left' | 'right';

export interface PanelPrefs {
  left: number;
  right: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

export const PANEL_LIMITS = {
  left: { min: 200, max: 480 },
  right: { min: 260, max: 560 },
  /** 中间至少留这么宽 */
  middleMin: 420,
} as const;
/** 收起后那条竖条的宽 */
export const RAIL_WIDTH = 44;
export const DEFAULT_PANELS: PanelPrefs = { left: 264, right: 340, leftOpen: true, rightOpen: true };

const clamp = (side: Side, w: number) => Math.min(PANEL_LIMITS[side].max, Math.max(PANEL_LIMITS[side].min, w));

/** 当前窗口下两栏实际画多宽:收起的算竖条宽;装不下时展开的按占比一起收,收到下限为止 */
export function fitWidths(p: PanelPrefs, viewport: number): { left: number; right: number } {
  let left = p.leftOpen ? clamp('left', p.left) : RAIL_WIDTH;
  let right = p.rightOpen ? clamp('right', p.right) : RAIL_WIDTH;
  const budget = viewport - PANEL_LIMITS.middleMin;
  if (left + right <= budget) return { left, right };
  if (p.leftOpen && p.rightOpen) {
    const scale = budget / (left + right);
    return { left: clamp('left', Math.floor(left * scale)), right: clamp('right', Math.floor(right * scale)) };
  }
  if (p.leftOpen) left = clamp('left', budget - right);
  if (p.rightOpen) right = clamp('right', budget - left);
  return { left, right };
}

/** 拖分隔线:从 start 拖了 delta(往中间拖为正)以后这一栏多宽 —— 夹在上下限之间,也不把中间挤到 middleMin 以下 */
export function dragWidth(side: Side, start: number, delta: number, other: number, viewport: number): number {
  const room = viewport - PANEL_LIMITS.middleMin - other;
  const max = Math.max(PANEL_LIMITS[side].min, Math.min(PANEL_LIMITS[side].max, room));
  return Math.min(max, Math.max(PANEL_LIMITS[side].min, start + delta));
}

/** localStorage 里存的;读不到、坏了、字段不对的用默认(不给就是 DEFAULT_PANELS) */
export function parsePanels(raw: string | null, d: PanelPrefs = DEFAULT_PANELS): PanelPrefs {
  if (!raw) return d;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return d;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return d;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  return {
    left: num(o.left, d.left),
    right: num(o.right, d.right),
    leftOpen: bool(o.leftOpen, d.leftOpen),
    rightOpen: bool(o.rightOpen, d.rightOpen),
  };
}

function load(key: string, defaults: PanelPrefs): PanelPrefs {
  try {
    return parsePanels(window.localStorage.getItem(key), defaults);
  } catch {
    return defaults;
  }
}

function save(key: string, p: PanelPrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(p));
  } catch {
    // 无痕窗口、存储满了:只是下次不记得
  }
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export interface SidePanels {
  leftOpen: boolean;
  rightOpen: boolean;
  /** 正在拖哪一边 */
  dragging: Side | null;
  toggle: (side: Side) => void;
  startDrag: (side: Side, e: ReactPointerEvent) => void;
  /** 放在页面根上:--st-left / --st-right 是两栏现在该画多宽 */
  style: CSSProperties;
}

export interface SidePanelOptions {
  /** 没存过时用的(比如游戏菜单里的素材页:右栏默认收起) */
  defaults?: PanelPrefs;
  /** 页面不是整个窗口宽时,窗口里别的东西占掉的宽(菜单的左栏和边距):两栏按剩下的宽来收 */
  reserved?: number;
}

export function useSidePanels(storageKey: string, options: SidePanelOptions = {}): SidePanels {
  const { defaults = DEFAULT_PANELS, reserved = 0 } = options;
  const [prefs, setPrefs] = useState<PanelPrefs>(() => load(storageKey, defaults));
  const latest = useRef(prefs);
  useEffect(() => {
    latest.current = prefs;
  });
  const viewport = useViewportWidth() - reserved;
  const widths = fitWidths(prefs, viewport);
  const [dragging, setDragging] = useState<Side | null>(null);

  const commit = (next: PanelPrefs) => {
    latest.current = next;
    setPrefs(next);
    save(storageKey, next);
  };

  // 不随渲染换:右栏的收起经 context 递下去
  const toggle = useCallback(
    (side: Side) => {
      const p = latest.current;
      const next = side === 'left' ? { ...p, leftOpen: !p.leftOpen } : { ...p, rightOpen: !p.rightOpen };
      latest.current = next;
      setPrefs(next);
      save(storageKey, next);
    },
    [storageKey],
  );

  const startDrag = (side: Side, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (side === 'left' ? !prefs.leftOpen : !prefs.rightOpen) return;
    e.preventDefault();
    const otherSide: Side = side === 'left' ? 'right' : 'left';
    const startX = e.clientX;
    const start = widths[side];
    const other = widths[otherSide];
    // 栏在整层缩放的菜单里(电脑上局内菜单按窗口等比缩放)时,屏幕上拖 1px 不是栏宽 1px:按外框换算
    const host = (e.currentTarget as HTMLElement).parentElement;
    const f = host && host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth || 1 : 1;
    const vw = window.innerWidth / f - reserved;
    // 另一栏按眼下画出来的宽定住:窗口小、两栏正被按占比收着时,拖完不会再跳一下
    let next: PanelPrefs = { ...latest.current, [side]: start, [otherSide]: prefsWidth(latest.current, otherSide, other) };
    const onMove = (ev: PointerEvent) => {
      const delta = (side === 'left' ? ev.clientX - startX : startX - ev.clientX) / f;
      next = { ...next, [side]: dragWidth(side, start, delta, other, vw) };
      latest.current = next;
      setPrefs(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('dragging-columns');
      setDragging(null);
      commit(next);
    };
    document.body.classList.add('dragging-columns');
    setDragging(side);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return {
    leftOpen: prefs.leftOpen,
    rightOpen: prefs.rightOpen,
    dragging,
    toggle,
    startDrag,
    style: { '--st-left': `${widths.left}px`, '--st-right': `${widths.right}px` } as CSSProperties,
  };
}

/** 另一栏收着时不动它存的宽度(摊开时还是原来那么宽);展开着就按画出来的定住 */
function prefsWidth(p: PanelPrefs, side: Side, drawn: number): number {
  return (side === 'left' ? p.leftOpen : p.rightOpen) ? drawn : p[side];
}

/** 页面递给右栏的「收起右栏」;没有 = 这页的右栏不能收(卡编辑器) */
export const InspectorCollapse = createContext<(() => void) | null>(null);
