/**
 * 卡编辑器:调试台里的全屏页,编辑的永远是「当前这张卡」。
 *
 *   顶栏     ← 回去 · 头像 · 卡名 · 「资料 / 素材」页签 · 保存状态 · 主按钮「开始」
 *   提示条   导入完成后才有(importer/ImportBanner:一行提示,没认出来的文件点「查看」就地选类型)
 *   资料页   renderProfile() 整块(第 2 段换成目录 + 字段 + 右栏)
 *   素材页   左栏(角色信息 + 在用的素材)+ renderSlot(这一栏) —— 每一栏自己画主区和右栏
 *
 * 开在哪(页签、栏、提示)由 DebugApp 管(StudioRoute),这里只画和回报。
 * 拖放落点(importer/dropTarget):左栏 = 给这张卡加素材;立绘 / 背景 / BGM / CG 栏 = 都按这一栏的类型导入给这张卡。
 * 盖在视觉小说上面(studio.css 的层级);Esc 或左上角「←」关。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { cardFaceUrl, type ClassifyKind } from '../lib/api';
import { ImportBanner } from '../importer/ImportBanner';
import { dropTarget, slotKind } from '../importer/dropTarget';
import type { TavernCard } from '../lib/cardParser';
import type { SaveState } from '../components/CardPanel';
import { EnvBadge } from '../components/EnvBadge';
import { specLabel } from './cardInfo';
import { CardAvatar, StudioAside } from './StudioAside';
import { Icon } from './icons';
import { LayerSkin } from './layerSkin';
import { Btn, SaveIndicator } from './ui';
import type { Notify, SlotKey, SlotRow, StudioRoute, StudioTab } from './types';
import './studio.css';
import './studioPaper.css';

export interface CardStudioProps {
  cardId: string;
  card: TavernCard;
  /** 卡面头像(data URL);按脸裁的小图读不到时用它 */
  avatarUrl: string | null;
  /** 当前立绘包:换了包,按脸裁的头像换个地址重新拉 */
  faceVersion?: string | null;
  route: StudioRoute;
  onRoute: (next: StudioRoute) => void;
  onClose: () => void;
  /** 「开始」:关掉卡编辑器进游戏 */
  onStart: () => void;
  saveState: SaveState;
  renderProfile: () => ReactNode;
  /** 素材页的一栏:主区 + 右栏(<main className="st-main"> + <Inspector>) */
  renderSlot: (slot: SlotKey) => ReactNode;
  /** 左栏「在用的素材」(slotSummary.ts 的 summarizeSlots) */
  slots: readonly SlotRow[];
  notify: Notify;
  /** 提示条里认领一个没认出来的文件(DebugApp 调接口、换上新的提示);不给就不显示「查看」 */
  onClassifyUnknown?: (path: string, kind: ClassifyKind) => Promise<void>;
  /** 左栏底下那个框:选文件导入给这张卡 */
  onImport?: () => void;
}

/** 浮在卡编辑器上面、自己管 Esc 的东西:我们的「?」/「⋯」/ 确认框,和从这里打开的旧抽屉、弹窗 */
const OWN_LAYERS = '.st-layer';
const OTHER_LAYERS = '.ce-backdrop, .inspector-backdrop';

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(t.type);
}

/** 两个页签各带一个线条图标(设计稿 studio.html C,10-25 用户:「给个 icon 方便玩家区分」) */
const TABS: { key: StudioTab; label: string; en: string; icon: 'profile' | 'assets' }[] = [
  { key: 'profile', label: '资料', en: 'Profile', icon: 'profile' },
  { key: 'assets', label: '素材', en: 'Assets', icon: 'assets' },
];

export function CardStudio(props: CardStudioProps) {
  const { cardId, card, avatarUrl, faceVersion, route, onRoute, onClose, onStart, saveState, slots } = props;
  const name = card.name.trim() || '(无名)';
  const avatars = [cardFaceUrl(cardId, 144, faceVersion ?? undefined), avatarUrl];
  // 没装生图卡带时没有「AI 生成」那一栏:要开它就退回立绘
  const slot = slots.some((s) => s.key === route.slot) ? route.slot : 'sprite';
  const notice = route.notice ?? null;

  const root = useRef<HTMLDivElement | null>(null);
  // 打开时焦点挪进来:键盘不再落在底下调试台 / 视觉小说的按钮上
  useEffect(() => {
    root.current?.focus();
  }, []);

  // Esc 关整页。挂在捕获阶段、抢在视觉小说前面(它也在窗口上听 Esc,会开关菜单);
  // 「?」、「⋯」、确认框开着时交给它们自己关;输入框里的 Esc 只是不让视觉小说收到
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      if (document.querySelector(OWN_LAYERS)) return;
      e.preventDefault();
      if (document.querySelector(OTHER_LAYERS) || isTextField(e.target)) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 纸面皮(设计稿 studio.html C):顶栏 = 返回 Esc | 卡编辑器 Card Studio | 头像 + 卡名 | 两个页签 …… 已自动保存 · 开始
  return (
    <LayerSkin.Provider value="st-paper">
      <div ref={root} className="st-root st-studio" role="dialog" aria-modal="true" aria-label={`卡编辑器 · ${name}`} tabIndex={-1}>
        <header className="st-header">
          <button type="button" className="st-back" onClick={onClose} title="回到打开卡编辑器的地方">
            <Icon name="back" size={16} />
            返回
            <kbd>Esc</kbd>
          </button>
          <EnvBadge />
          <div className="st-ttl">
            <span className="zh">卡编辑器</span>
            <span className="en">Card Studio</span>
          </div>
          <div className="st-who">
            <CardAvatar className="st-header-avatar" sources={avatars} name={name} />
            <div>
              <b className="st-header-name" title={name}>
                {name}
              </b>
              <span>
                {specLabel(card.spec)}
                {card.character_version ? ` · ${card.character_version}` : ''}
              </span>
            </div>
          </div>
          <nav className="st-tabs" aria-label="卡编辑器">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className="st-tab"
                aria-current={route.tab === t.key ? 'page' : undefined}
                onClick={() => onRoute({ ...route, tab: t.key })}
              >
                <Icon name={t.icon} size={18} strokeWidth={1.5} />
                <span className="zh">{t.label}</span>
                <span className="en">{t.en}</span>
              </button>
            ))}
          </nav>
          <span className="st-flex" />
          <SaveIndicator state={saveState} />
          {/* 资料页的「导出」挂在这里(CardFieldsView 用 portal 放进来) */}
          <span className="st-header-slot" />
          <Btn kind="primary" icon="play" onClick={onStart}>
            开 始
          </Btn>
        </header>

        {notice && (
          <ImportBanner notice={notice} onClose={() => onRoute({ ...route, notice: null })} onClassify={props.onClassifyUnknown} />
        )}

        <div className="st-body">
          {route.tab === 'profile' ? (
            props.renderProfile()
          ) : (
            <>
              <StudioAside
                cardId={cardId}
                card={card}
                avatars={avatars}
                slots={slots}
                active={slot}
                onSlot={(next) => onRoute({ ...route, slot: next })}
                onEditProfile={() => onRoute({ ...route, tab: 'profile' })}
                onImport={props.onImport}
              />
              <div className="st-slot" {...dropTarget(cardId, name, slotKind(slot))}>
                {props.renderSlot(slot)}
              </div>
            </>
          )}
        </div>
      </div>
    </LayerSkin.Provider>
  );
}
