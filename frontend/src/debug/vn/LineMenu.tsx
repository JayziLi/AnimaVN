import { useEffect, useRef } from 'react';
import { placeMenu, popThemeClass, type PopTheme } from './ui/logic';
import { GameIcon } from './ui/GameIcon';
import { usePhone } from './settings/usePhone';
import './vnCtx.css';

/**
 * 菜单大概多大(px),只用来不让它出界;样子在 vnCtx.css。每项 36 高(手机 44),上下 5 + 分隔线那 5。
 * 三项 = 改原文 · 复制 · 详情,没有改原文时矮一截
 */
const menuSize = (items: number, phone: boolean) =>
  phone ? { w: 188, h: items * 44 + 15 } : { w: 176, h: items * 36 + 15 };

// 图标照设计稿 .ga-ctx:kit/icons.js 的 edit / copy / info,17px
const EDIT = <GameIcon name="edit" size={17} />;
const COPY = <GameIcon name="copy" size={17} />;
const INFO = <GameIcon name="info" size={17} />;

/**
 * 对着台词右键 / 长按先出的小菜单(设计稿 kit/scene.js 的 .ga-ctx):改原文 / 复制这句 / 这句的详情。
 * 「改原文」= 打开历史小窗口,这条回复已经在改;你自己说的那句(和还在写、不能改的)没有这一项(不给 onEdit)。
 * 在整层透明的接点击层里(VNScreen 那边接着:点外面、再右键、Esc 都是关),这里只画菜单本身。
 * at 是光标在画面根里的位置,bounds 是画面根的大小。
 */
export function LineMenu({
  at,
  bounds,
  theme = 'white',
  leaving,
  onEdit,
  onCopy,
  onInfo,
}: {
  at: { x: number; y: number };
  bounds: { w: number; h: number };
  theme?: PopTheme;
  leaving?: boolean;
  onEdit?: () => void;
  onCopy: () => void;
  onInfo: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  useEffect(() => {
    if (!leaving) ref.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [leaving]);
  // 照设计稿(scene.js openCtx):菜单开在光标上方 8px,手指 / 光标不挡住它;上面放不下再往下挪。
  // 手机(phone.js phoneFit):以手指为中、往上留 16px,顶上让开那排按钮(58),底下让开输入那行(30)
  const size = menuSize(onEdit ? 3 : 2, phone);
  const pos = phone
    ? {
        left: Math.round(Math.min(bounds.w - size.w - 12, Math.max(12, at.x - size.w / 2))),
        top: Math.round(Math.min(bounds.h - size.h - 30, Math.max(58, at.y - size.h - 16))),
      }
    : placeMenu({ x: at.x, y: at.y - size.h - 8 }, size, bounds);
  return (
    <div
      ref={ref}
      className={`vn-ctx av-pcard ${popThemeClass(theme)} ${leaving ? 'av-pop-out' : 'av-pop-in'}`}
      role="menu"
      aria-label="这一句"
      style={pos}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 上下键在几项之间走(到头绕回去)
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll('button') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const n = items.length;
        const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        items[next]?.focus();
      }}
    >
      {onEdit && (
        <button type="button" role="menuitem" onClick={onEdit}>
          {EDIT}
          <span>改原文</span>
        </button>
      )}
      <button type="button" role="menuitem" onClick={onCopy}>
        {COPY}
        <span>复制这句</span>
      </button>
      <button type="button" role="menuitem" onClick={onInfo}>
        {INFO}
        <span>这句的详情</span>
      </button>
    </div>
  );
}
