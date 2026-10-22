/**
 * 插件抽屉每一页的骨架(第 2 步第四版,plans/2026-10-16-asset-arch-step2-impl.md D2):
 *   PageHead    页头:名字(+ BETA)、「{卡}在用」小块、右边的控件(AI 写 / Jev 标);下面一排小标签
 *   Section     一块(快速预览、常用……):标题 + 问号;能收起的记住收起没有
 *   Advanced    「高级」:页签,默认收起;展开没有、选的哪一页按页记住
 *   PageFooter  底部链接:去卡编辑器、素材管理
 * 收起状态记在这台设备的 localStorage(读写包 try/catch:隐私窗口、存满了都当没记)。样子在 drawer.css。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Tip } from './Tip';
import type { TipKey } from './tips';

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就只在这次打开里记
  }
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className={`dw-chev${up ? ' up' : ''}`}>
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className="dw-arrow">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function PageHead(p: {
  title: string;
  /** 名字旁的问号(全局页、卡带页用):内核问号的键,或者卡带自己带的一句话(卡带的字不进内核 tips.ts) */
  tip?: TipKey | { text: string };
  beta?: boolean;
  /** 页头的「{卡}在用」小块;null = 不画 */
  inUse: { on: boolean; text: string } | null;
  tags: readonly string[];
  /** 小标签后面的问号 */
  tagTip?: TipKey;
  /** 右边:AI 写 / Jev 标 */
  right?: ReactNode;
  /** 页头下面一行小字(Jev 还没填 key · 去填) */
  note?: ReactNode;
}) {
  return (
    <div className="dw-page-head">
      <div className="dw-page-row">
        <h2 className="dw-page-title">{p.title}</h2>
        {p.beta && <span className="dw-beta">BETA</span>}
        {p.tip && (typeof p.tip === 'string' ? <Tip k={p.tip} /> : <Tip text={p.tip.text} />)}
        {p.inUse &&<span className={`dw-inuse${p.inUse.on ? ' on' : ''}`}>{p.inUse.text}</span>}
        <span className="dw-flex" />
        {p.right}
      </div>
      {(p.tags.length > 0 || p.tagTip) && (
        <div className="dw-tags">
          {p.tags.map((t) => (
            <span key={t} className="dw-chip">
              {t}
            </span>
          ))}
          {p.tagTip && <Tip k={p.tagTip} />}
        </div>
      )}
      {p.note && <div className="dw-page-note">{p.note}</div>}
    </div>
  );
}

export function Section(p: {
  title: string;
  tip?: TipKey;
  children: ReactNode;
  /** 标题行右边多放的东西 */
  right?: ReactNode;
  /** 能收起;收起状态按 storageKey 记在 localStorage */
  collapsible?: boolean;
  storageKey?: string;
}) {
  const key = p.storageKey ? `drawer.section.${p.storageKey}` : null;
  const [folded, setFolded] = useState(() => (p.collapsible && key ? readStore(key, false) : false));
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    if (key) writeStore(key, next);
  };
  return (
    <section className="dw-card" aria-label={p.title}>
      <div className="dw-card-head">
        <span className="dw-card-title">{p.title}</span>
        {p.tip && <Tip k={p.tip} />}
        <span className="dw-flex" />
        {p.right}
        {p.collapsible && (
          <button type="button" className="dw-fold" aria-expanded={!folded} onClick={toggle}>
            {folded ? '展开' : '收起'}
            <Chevron up={!folded} />
          </button>
        )}
      </div>
      {!folded && <div className="dw-card-body">{p.children}</div>}
    </section>
  );
}

export interface AdvTab {
  id: string;
  name: string;
  /** 页签上的小字:条数、「改过」 */
  badge?: string;
}

export function Advanced(p: {
  pageId: string;
  tabs: readonly AdvTab[];
  render: (tabId: string) => ReactNode;
  /** 外面要求打开到某个页签(点预设里的插件块时);nonce 变了就再开一次 */
  open?: { tab: string; nonce: number } | null;
}) {
  const key = `drawer.adv.${p.pageId}`;
  const [state, setState] = useState<{ expanded: boolean; tab: string | null }>(() =>
    readStore(key, { expanded: false, tab: null }),
  );
  const save = (next: { expanded: boolean; tab: string | null }) => {
    setState(next);
    writeStore(key, next);
  };
  // 只看 nonce:外面每次重画都会给一个新对象,不能因此把收起的又打开
  const wantTab = p.open?.tab ?? null;
  const wantNonce = p.open?.nonce ?? null;
  useEffect(() => {
    if (wantNonce === null || wantTab === null) return;
    setState({ expanded: true, tab: wantTab });
  }, [wantNonce, wantTab]);

  const tab = p.tabs.find((t) => t.id === state.tab)?.id ?? p.tabs[0]?.id ?? null;
  const expanded = state.expanded && tab !== null;
  return (
    <section className="dw-card dw-adv" aria-label="高级">
      <div className="dw-card-head">
        <span className="dw-card-title">高级</span>
        <Tip k="advanced" />
        <span className="dw-flex" />
        <button type="button" className="dw-fold" aria-expanded={expanded} onClick={() => save({ expanded: !expanded, tab })}>
          {expanded ? '收起' : '展开'}
          <Chevron up={expanded} />
        </button>
      </div>
      <div className={`dw-tabs${expanded ? ' open' : ''}`} role="tablist" aria-label="高级">
        {p.tabs.map((t) => {
          const on = expanded && t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`dw-tab${on ? ' on' : ''}`}
              onClick={() => save({ expanded: !on, tab: t.id })}
            >
              {t.name}
              {t.badge && <span className={`dw-tab-badge${t.badge === '改过' ? ' changed' : ''}`}>{t.badge}</span>}
            </button>
          );
        })}
      </div>
      {expanded && tab !== null && (
        <div className="dw-tab-body" role="tabpanel">
          {p.render(tab)}
        </div>
      )}
    </section>
  );
}

export function PageFooter(p: { links: readonly { text: string; onClick: () => void }[] }) {
  if (p.links.length === 0) return null;
  return (
    <div className="dw-footer">
      {p.links.map((l) => (
        <button key={l.text} type="button" className="dw-link" onClick={l.onClick}>
          {l.text}
          <Arrow />
        </button>
      ))}
    </div>
  );
}
