/**
 * 「导出」点开是三选一(画布 step3 ExportMenu):
 *
 *   角色包(.animavn)…        连立绘、背景、BGM、CG 一起,发给别人或换电脑用
 *   只导卡(.json)            和现在一样,只有卡本身
 *   给酒馆用户(PNG + 表情 zip) 以后做(灰着)
 *
 * 卡编辑器资料页标题行是带字的按钮(variant="button"),调试台右栏是图标(variant="icon")。
 * 菜单挂到 body 上(和「⋯」菜单同一套,studio/floating)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimaIcon } from '../AnimaIcon';
import { useAnchored, useDismiss } from '../../studio/floating';
import { Icon } from '../../studio/icons';
import './export.css';

interface Props {
  variant: 'button' | 'icon';
  disabled?: boolean;
  /** 卡还没存进库(没有编号)时角色包导不了 */
  bundleDisabled?: boolean;
  onBundle: () => void;
  onJson: () => void;
}

interface Entry {
  key: string;
  label: string;
  note: string;
  disabled: boolean;
  onClick?: () => void;
}

export function ExportMenu({ variant, disabled, bundleDisabled, onBundle, onJson }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const style = useAnchored(open, btn, menu, 'end', 6);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [btn, menu], close);
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const entries: Entry[] = [
    {
      key: 'bundle',
      label: '角色包(.animavn)…',
      note: bundleDisabled ? '这张卡还没存好,稍等再导' : '连立绘、背景、BGM、CG 一起,发给别人或换电脑用',
      disabled: !!bundleDisabled,
      onClick: onBundle,
    },
    { key: 'json', label: '只导卡(.json)', note: '和现在一样,只有卡本身', onClick: onJson, disabled: false },
    { key: 'tavern', label: '给酒馆用户(PNG + 表情 zip)', note: '以后做', disabled: true },
  ];

  const toggle = () => setOpen((v) => !v);
  return (
    <>
      {variant === 'button' ? (
        <button
          ref={btn}
          type="button"
          className={`st-btn st-btn-secondary exp-trigger${open ? ' open' : ''}`}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <Icon name="export" size={15} />
          导出
          <Icon name="chev" size={12} />
        </button>
      ) : (
        <button
          ref={btn}
          type="button"
          className={`icon-btn${open ? ' accent' : ''}`}
          disabled={disabled}
          title="导出:角色包 / 只导卡"
          aria-label="导出"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <AnimaIcon name="export" size={16} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label="导出"
            className="st-menu st-layer exp-menu"
            style={style}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
              const at = all.indexOf(document.activeElement as HTMLButtonElement);
              all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
            }}
          >
            {entries.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className="exp-menu-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  btn.current?.focus();
                  it.onClick?.();
                }}
              >
                <span className="exp-menu-label">{it.label}</span>
                <span className="exp-menu-note">{it.note}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
