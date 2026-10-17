/** 能拖宽、能收起的两栏用的三个小组件(逻辑和宽度在 sidePanels.ts) */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './icons';
import type { Side } from './sidePanels';

/** 收起后的竖条:竖着写栏名,点一下摊开 */
export function PanelRail({ side, label, onOpen }: { side: Side; label: string; onOpen: () => void }) {
  return (
    <button type="button" className={`st-rail ${side}`} title={`展开${label}`} aria-label={`展开${label}`} onClick={onOpen}>
      <span className="st-rail-glyph" aria-hidden="true">
        {side === 'left' ? '▸' : '◂'}
      </span>
      <span className="st-rail-text">{label}</span>
    </button>
  );
}

/** 栏和中间之间的分隔线,按住拖 */
export function PanelResizer({
  side,
  dragging,
  onPointerDown,
}: {
  side: Side;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '拖动调整左栏宽度' : '拖动调整右栏宽度'}
      title="拖动调整宽度"
      className={`st-resizer ${side}${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
    />
  );
}

/** 展开着的栏上的收起按钮(箭头朝栏收进去的方向) */
export function PanelCollapseButton({ side, label, onClick }: { side: Side; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`st-panel-collapse ${side}`} title={`收起${label}`} aria-label={`收起${label}`} onClick={onClick}>
      <Icon name="chev" size={14} />
    </button>
  );
}
