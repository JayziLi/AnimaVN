import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MarkerSource } from '../lib/cardFields';
import type { TavernCard } from '../lib/cardParser';
import type { MacroContext } from '../lib/macros';
import type { PresetPrompt } from '../lib/presetParser';
import { BlockEditorPane } from '../studio/profile/BlockEditorPane';
import {
  blockPatchOf,
  canDeleteBlock,
  cardPatchOf,
  draftOf,
  isDraftDirty,
  type BlockDraft,
} from '../studio/profile/blockDraft';

/**
 * 块编辑弹窗 —— 点预设里任意一块都开它。屏幕中间的大框,里面的字段在
 * studio/profile/BlockEditorPane(上面一行属性,下面左原文右预览)。
 * 左栏窄,在里面改长提示词太憋屈,所以不再有行内编辑。
 *
 * 这一层只管外框和草稿:改的都是弹窗自己手里的草稿,点「确定」才写回预设 / 角色卡;
 * 「取消」、Esc、点背景都丢掉草稿(改过的先问一句)。
 */

interface Props {
  prompt: PresetPrompt;
  /** 这一块此刻正被角色卡顶替 */
  overridden: boolean;
  /** marker 块的内容来源;非 marker、或预设自定义的未知 marker 时为 null */
  markerSource: MarkerSource | null;
  onCancel: () => void;
  onSave: (patch: Partial<PresetPrompt>) => void;
  /** marker 块改了卡的字段:写回角色卡 */
  onSaveCard: (patch: Partial<TavernCard>) => void;
  onDelete: () => void;
  /** 预览展开宏用的取值 —— 和聊天区显示同一份 */
  macros: MacroContext;
}

export function BlockEditorModal({
  prompt,
  overridden,
  markerSource,
  onCancel,
  onSave,
  onSaveCard,
  onDelete,
  macros,
}: Props) {
  const [draft, setDraft] = useState<BlockDraft>(() => draftOf(prompt, markerSource));
  const change = (patch: Partial<BlockDraft>) => setDraft((d) => ({ ...d, ...patch }));
  /** 删除要点两下 —— 和人设面板同一套,不弹 confirm */
  const [armed, setArmed] = useState(false);

  const canDelete = canDeleteBlock(prompt);
  const dirty = isDraftDirty(prompt, markerSource, draft);

  const commit = () => {
    const patch = blockPatchOf(prompt, draft);
    if (patch) onSave(patch);
    const cardPatch = cardPatchOf(prompt, markerSource, draft);
    if (cardPatch) onSaveCard(cardPatch);
  };

  // Esc / ✕ / 点背景:改过东西就先问一句 —— 顺手按的 Esc、在正文里拖选文字拖到弹窗外松手,
  // 都会把整块草稿丢掉。「取消」按钮是明说要丢的,不问
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const requestClose = useRef(() => {});
  requestClose.current = () => {
    if (!dirtyRef.current || window.confirm('这个块改过了还没确定,放弃这些改动?')) onCancel();
  };
  // 点背景要按下和松开都在背景上才算:从正文里拖选出来松手也会在背景上触发 click
  const downOnBackdrop = useRef(false);

  // Esc 挂在 window 上:容器的 onKeyDown 只在焦点还在弹窗内时才收得到,
  // 而页脚是白纸黑字承诺了 Esc 能关的
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation();
      requestClose.current();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, []);

  // Ctrl+Enter 留在容器上就够 —— 它只在正文里敲才有意义,那时焦点必然在弹窗内
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };

  // 挂到 body 上:手机端左栏会给 fixed 元素另起包含块,留在栏里弹窗就被
  // 困在栏内、底部的确定按钮被挤出屏幕
  return createPortal(
    <div
      className="inspector-backdrop block-modal-backdrop"
      onMouseDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) requestClose.current();
        downOnBackdrop.current = false;
      }}
    >
      <div
        className="inspector block-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="inspector-head">
          <span className="inspector-title">编辑块 · {prompt.name || prompt.identifier}</span>
          <div style={{ flex: 1 }} />
          <button className="btn small" onClick={() => requestClose.current()} title="关闭">
            ✕
          </button>
        </div>

        <div className="block-modal-body">
          <BlockEditorPane
            prompt={prompt}
            overridden={overridden}
            markerSource={markerSource}
            draft={draft}
            onChange={change}
            macros={macros}
          />
        </div>

        <div className="block-modal-foot">
          <span className="bm-id">{prompt.identifier}</span>
          {prompt.systemPrompt && <span className="bm-builtin">内置块</span>}
          {canDelete && (
            <button
              className={`btn small danger${armed ? ' armed' : ''}`}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                onDelete();
              }}
              onBlur={() => setArmed(false)}
              title="把这个块从预设里删掉"
            >
              {armed ? '再点一次删除' : '🗑 删除'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <span className="bm-hint">Ctrl+Enter 确定 · Esc 取消</span>
          <button className="btn small" onClick={onCancel}>
            取消
          </button>
          <button className="btn small accent" onClick={commit} disabled={!dirty}>
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
