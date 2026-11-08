/**
 * 素材页顶栏的「导入」按钮(画布 voice-import 的 A):点开两项 ——
 *   选文件    角色包、声音包、压缩包
 *   选文件夹  模型和参考音频放在一起的
 * 没给 onFolder 时就是原来的一个按钮,直接选文件。
 */

import { useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchored, useDismiss } from '../studio/floating';
import { LayerSkin } from '../studio/layerSkin';
import { Btn } from '../studio/ui';

export const IMPORT_MENU_ITEMS = [
  { key: 'files', label: '选文件', note: '角色包、声音包、压缩包' },
  { key: 'folder', label: '选文件夹', note: '模型和参考音频放在一起的' },
] as const;

export function ImportMenuButton({ onFiles, onFolder }: { onFiles?: () => void; onFolder?: () => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const skin = useContext(LayerSkin);
  const style = useAnchored(open, btn, menu, 'end', 6);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [btn, menu], close);
  if (!onFolder) {
    return (
      <Btn kind="primary" icon="upload" disabled={!onFiles} onClick={onFiles}>
        导入
      </Btn>
    );
  }
  const run = { files: onFiles, folder: onFolder };
  return (
    <>
      <Btn
        ref={btn}
        kind="primary"
        icon="upload"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!onFiles}
        onClick={() => setOpen((v) => !v)}
      >
        导入
      </Btn>
      {open &&
        createPortal(
          <div ref={menu} role="menu" className={`st-menu st-layer${skin ? ` ${skin}` : ''}`} style={style}>
            {IMPORT_MENU_ITEMS.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className="st-menu-item has-note"
                onClick={() => {
                  setOpen(false);
                  run[it.key]?.();
                }}
              >
                {it.label}
                <span className="st-menu-note">{it.note}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
