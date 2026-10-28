/**
 * 插件抽屉每一页的骨架(第 2 步第四版,plans/2026-10-16-asset-arch-step2-impl.md D2):
 *   PageHead    页头:名字(+ BETA)、「{卡}在用」小块、右边的控件(AI 写 / Jev 标);下面一排小标签
 *   Section     一块(快速预览、常用……):标题 + 问号;能收起的记住收起没有
 *   Advanced    「高级」:页签,默认收起;展开没有、选的哪一页按页记住
 *   PageFooter  底部链接:去卡编辑器、素材管理
 *   PageShell   一页怎么摆:调试台 / 卡编辑器里一列(页头 → 预览 → 常用 → 高级 → 底部链接);游戏皮里三栏(中间页头 + 舞台,右边常用 + 高级)
 * 收起状态记在这台设备的 localStorage(读写包 try/catch:隐私窗口、存满了都当没记)。样子在 drawer.css。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../studio/icons';
import { Switch } from '../../vn/ui/Switch';
import { useDrawerSkin } from './skinContext';
import { betaShown, pageEn } from './skinModel';
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
  const { game, page, power } = useDrawerSkin();
  const tip = p.tip && (typeof p.tip === 'string' ? <Tip k={p.tip} /> : <Tip text={p.tip.text} />);
  const beta = betaShown(game, page, Boolean(p.beta));
  if (game) {
    // 游戏皮:一行 = 名字 + 斜体英文 + 问号 + 开关 + 在用 + 小标签 ……(右边)AI 写 / Jev 标;开关从左栏挪到了这里
    const en = pageEn(page);
    return (
      <div className="dw-page-head">
        <div className="dw-page-row">
          <h2 className="dw-page-title">{p.title}</h2>
          {en && <span className="dw-page-en">{en}</span>}
          {beta && <span className="dw-beta">BETA</span>}
          {tip}
          {power && <Switch checked={power.on} onChange={power.onToggle} label={power.label} />}
          {/* 插件关着时这块写「关着」(设计稿),别的时候是这张卡在不在用 */}
          {power && !power.on ? (
            <span className="dw-inuse">关着</span>
          ) : (
            p.inUse && (
              <span className={`dw-inuse${p.inUse.on ? ' on' : ''}`}>
                {p.inUse.on && <i className="dw-inuse-dot" aria-hidden="true" />}
                {p.inUse.on ? '在用' : '没在用'}
              </span>
            )
          )}
          {p.tags.map((t) => (
            <span key={t} className="dw-chip">
              {t}
            </span>
          ))}
          {p.tagTip && <Tip k={p.tagTip} />}
          <span className="dw-flex" />
          {p.right}
        </div>
        {p.note && <div className="dw-page-note">{p.note}</div>}
      </div>
    );
  }
  return (
    <div className="dw-page-head">
      <div className="dw-page-row">
        <h2 className="dw-page-title">{p.title}</h2>
        {p.beta && <span className="dw-beta">BETA</span>}
        {tip}
        {p.inUse && <span className={`dw-inuse${p.inUse.on ? ' on' : ''}`}>{p.inUse.text}</span>}
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
  /** 游戏皮里标题后面的斜体英文小标(常用 Common) */
  en?: string;
  tip?: TipKey;
  children: ReactNode;
  /** 标题行右边多放的东西 */
  right?: ReactNode;
  /** 能收起;收起状态按 storageKey 记在 localStorage */
  collapsible?: boolean;
  storageKey?: string;
}) {
  const { game } = useDrawerSkin();
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
        {game && p.en && <span className="dw-card-en">{p.en}</span>}
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

/**
 * 中间那块纸面板(设计稿 .pl-panel):试判、连接、这次会补、本地小模型这类不是游戏画面的中间区。
 * 调试台里照旧是一块 Section。
 */
export function Panel(p: { title: string; en?: string; tip?: TipKey; right?: ReactNode; children: ReactNode; className?: string }) {
  const { game } = useDrawerSkin();
  if (!game) {
    return (
      <Section title={p.title} tip={p.tip} right={p.right}>
        {p.children}
      </Section>
    );
  }
  return (
    <section className={`dw-panel${p.className ? ` ${p.className}` : ''}`} aria-label={p.title}>
      <div className="dw-panel-h">
        <span className="zh">{p.title}</span>
        {p.en && <span className="en">{p.en}</span>}
        {p.tip && <Tip k={p.tip} />}
        <span className="dw-flex" />
        {p.right}
      </div>
      {p.children}
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
  const { game } = useDrawerSkin();
  const key = `drawer.adv.${p.pageId}`;
  const [state, setState] = useState<{ expanded: boolean; tab: string | null }>(() => readStore(key, { expanded: false, tab: null }));
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
  if (game) {
    // 游戏皮(设计稿 .pl-adv-line):标题下一行「› 标签格式 · 问法 · 提示词模板 · 认词记录 · 配对表」,
    // 点哪个展开哪个(选中 = 墨色下划线),再点一下收起;最前面的 › 收起 / 展开上次那个
    return (
      <section className={`dw-card dw-adv${expanded ? ' open' : ''}`} aria-label="高级">
        <div className="dw-card-head">
          <span className="dw-card-title">高级</span>
          <span className="dw-card-en">Advanced</span>
          <Tip k="advanced" />
        </div>
        <div className="dw-adv-line" role="tablist" aria-label="高级">
          <button
            type="button"
            className="dw-adv-fold"
            aria-expanded={expanded}
            aria-label={expanded ? '收起高级' : '展开高级'}
            onClick={() => save({ expanded: !expanded, tab })}
          >
            <Icon name="chev_r" size={16} />
          </button>
          {p.tabs.map((t, i) => {
            const on = expanded && t.id === tab;
            return (
              <span key={t.id} className={`dw-adv-u${i > 0 ? ' sep' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`dw-tab${on ? ' on' : ''}`}
                  onClick={() => save({ expanded: !on, tab: t.id })}
                >
                  {t.name}
                  {t.badge && <span className={`dw-tab-badge${t.badge === '改过' ? ' changed' : ''}`}>{t.badge}</span>}
                </button>
              </span>
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
  return (
    <section className="dw-card dw-adv" aria-label="高级">
      <div className="dw-card-head">
        <span className="dw-card-title">高级</span>
        {game && <span className="dw-card-en">Advanced</span>}
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

/**
 * 一页怎么摆。有实机预览舞台的页(立绘、语音、背景、BGM、CG)用它:
 *   调试台 / 卡编辑器  老样子,一列:页头 → 空着时的提示 → 快速预览 → 常用 → 高级 → 底部链接
 *   游戏皮            三栏:中间 = 页头 + 提示 + 预览(舞台、差分、试一下);右边 = 常用 + 高级 + 底部链接
 * preview 由页自己按 useDrawerSkin().game 选画哪一种(老的「快速预览」一块,还是舞台)。
 */
export function PageShell(p: {
  head: ReactNode;
  empty?: ReactNode;
  preview?: ReactNode;
  common: ReactNode;
  advanced?: ReactNode;
  footer?: ReactNode;
  /** 调试台里「常用」排在 preview 前面(全局页原来的顺序);游戏皮不管它 */
  commonFirst?: boolean;
  /** 插件关着时小卡上写的名字(「立绘关着」) */
  title?: string;
}) {
  const { game, power } = useDrawerSkin();
  const title = p.title ?? '插件';
  if (!game) {
    return (
      <>
        {p.head}
        {p.empty}
        {p.commonFirst && p.common}
        {p.preview}
        {!p.commonFirst && p.common}
        {p.advanced}
        {p.footer}
      </>
    );
  }
  // 插件关着(设计稿 .pl-off / .pl-offcard):中间变灰,正中一张小卡「立绘关着 [打开]」;右边的设置也淡下去
  const off = power !== null && !power.on;
  return (
    <div className={`dw-page${off ? ' is-off' : ''}`}>
      <div className="dw-mid">
        {p.head}
        <div className={`dw-midbody${off ? ' dw-off' : ''}`}>
          {p.empty}
          {p.preview}
          {off && (
            <div className="dw-offcard">
              <svg className="av-star" viewBox="-10 -10 20 20" aria-hidden="true">
                <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
              </svg>
              <b>{title}关着</b>
              <button type="button" className="btn small" onClick={power.onToggle}>
                打开
              </button>
            </div>
          )}
        </div>
      </div>
      <aside className="dw-side">
        <div className="dw-side-scroll">
          {p.common}
          {p.advanced}
        </div>
        {p.footer}
      </aside>
    </div>
  );
}
