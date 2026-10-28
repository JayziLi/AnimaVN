/**
 * 「看哪张卡」(游戏菜单里那份插件页):照设计稿 kit/plugins.js 的 pickEl —— 圆头像 + 名字(+「(当前)」)+ ▾,
 * 点开一个小菜单列出全部卡(头像、名字、创作者注释)。只换插件页里看的那张,不换正在聊的。
 * 放在菜单面板的页头右边(PluginsDrawer 用 portal 挂过去);调试台里还是原来那个下拉框。
 * 头像一张一张按需去取(列表接口不带头像),取过的记在模块里,这次打开期间不重复取。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi } from '../../lib/api';
import { Icon } from '../../studio/icons';
import { TIPS } from './tips';

const avatarCache = new Map<string, string | null>();

function useAvatar(id: string | null): string | null {
  const [src, setSrc] = useState<string | null>(() => (id ? (avatarCache.get(id) ?? null) : null));
  useEffect(() => {
    if (!id) {
      setSrc(null);
      return;
    }
    if (avatarCache.has(id)) {
      setSrc(avatarCache.get(id) ?? null);
      return;
    }
    let alive = true;
    debugApi
      .getCardAvatar(id)
      .catch(() => null)
      .then((v) => {
        avatarCache.set(id, v);
        if (alive) setSrc(v);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return src;
}

function Face({ id, name, size }: { id: string | null; name: string; size: number }) {
  const src = useAvatar(id);
  return (
    <span className={`dw-pick-face${src ? '' : ' none'}`} style={{ width: size, height: size }} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <i>{(name || '?').slice(0, 1)}</i>}
    </span>
  );
}

export function CardPick({
  cards,
  labels,
  viewId,
  currentId,
  onPick,
}: {
  cards: readonly { id: string; name: string; note?: string }[];
  labels: ReadonlyMap<string, string>;
  viewId: string | null;
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const view = cards.find((c) => c.id === viewId) ?? null;
  const nameOf = (c: { id: string; name: string }) => labels.get(c.id) ?? (c.name || '(未命名)');

  // 点外面、Esc 收起(Esc 只收小菜单,不往外传去关整个菜单)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="dw-pickbar">
      <span className="dw-pick-cap" title={TIPS.pick}>
        看哪张卡
      </span>
      <div className="dw-pick-wrap" ref={wrap}>
        <button
          type="button"
          className="dw-pick-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`看哪张卡:${view ? nameOf(view) : '还没有卡'}`}
          disabled={cards.length === 0}
          onClick={() => setOpen((o) => !o)}
        >
          <Face id={view?.id ?? null} name={view?.name ?? ''} size={22} />
          <span className="dw-pick-name">
            {view ? nameOf(view) : '还没有卡'}
            {view && view.id === currentId && <small>(当前)</small>}
          </span>
          <Icon name="chev" size={16} />
        </button>
        {open && (
          <div className="dw-pick-menu" role="menu" aria-label="看哪张卡">
            {cards.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                className={c.id === viewId ? 'on' : ''}
                onClick={() => {
                  setOpen(false);
                  if (c.id !== viewId) onPick(c.id);
                }}
              >
                <Face id={c.id} name={c.name} size={30} />
                <div>
                  <b>
                    {nameOf(c)}
                    {c.id === currentId ? '(当前)' : ''}
                  </b>
                  {c.note && <span>{c.note}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
