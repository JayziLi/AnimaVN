/**
 * CG 包编辑器下半截:构图网格。每格一张 16:9 缩略图 + 名字 +「3 张差分」;停用的半透明、标「停用」;
 * 还没传图的画个占位;正在传的图先占一格(本地预览 + 转圈);最后一格「添加构图」。
 * 拖动排序(HTML5 拖放,放在目标的左半边 = 前面),和立绘的差分网格一样。
 */

import { useState, type DragEvent } from 'react';
import { sceneThumbUrl } from '../../lib/api';
import { Icon } from '../icons';
import { variantCountLabel, type CgGroup } from './cgEdit';
import type { UploadTile } from './SpriteFaceGrid';
import { moveId } from './spriteEdit';

type Place = 'before' | 'after';

const UPLOAD_STATE: Record<UploadTile['state'], string> = { wait: '等待上传', up: '上传中', fail: '没传上' };

export function CgGrid({
  groups,
  selectedId,
  onSelect,
  onReorder,
  uploads,
  onAdd,
  locked,
}: {
  groups: readonly CgGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 拖完的新顺序(全部构图的 id) */
  onReorder: (ids: string[]) => void;
  uploads: readonly UploadTile[];
  /** 「添加构图」:选图上传 */
  onAdd: () => void;
  /** 正在排序 / 上传时不让拖 */
  locked?: boolean;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: Place } | null>(null);
  const ids = groups.map((g) => g.cg.id);

  const clear = () => {
    setDrag(null);
    setDrop(null);
  };
  // 只认这个网格里拖出来的(从桌面拖进来的文件归导入那边管)
  const over = (e: DragEvent<HTMLElement>, id: string) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const place: Place = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
    if (drop?.id !== id || drop.place !== place) setDrop({ id, place });
  };
  const land = (e: DragEvent<HTMLElement>) => {
    if (!drag) return;
    e.preventDefault();
    const next = drop ? moveId(ids, drag, drop.id, drop.place) : null;
    clear();
    if (next) onReorder(next);
  };

  return (
    <div
      className="cg-grid"
      role="group"
      aria-label="构图"
      onDragLeave={(e) => {
        // 拖出整个网格才清掉落点提示
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
    >
      {groups.map(({ cg, variants }) => {
        const selected = cg.id === selectedId;
        // 构图本身还没传图:用第一张有图的差分(游戏里也是这样)
        const frame = cg.has_file ? cg : variants.find((v) => v.has_file);
        const thumb = frame ? sceneThumbUrl(frame, 320) : null;
        const mark = drop?.id === cg.id && drag !== cg.id ? ` drop-${drop.place}` : '';
        return (
          <button
            key={cg.id}
            type="button"
            aria-pressed={selected}
            className={`cg-tile${selected ? ' selected' : ''}${cg.enabled ? '' : ' off'}${drag === cg.id ? ' dragging' : ''}${mark}`}
            title={cg.description || cg.label}
            draggable={!locked}
            onClick={() => onSelect(cg.id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', cg.label);
              setDrag(cg.id);
            }}
            onDragOver={(e) => over(e, cg.id)}
            onDrop={land}
            onDragEnd={clear}
          >
            <span className="cg-thumb">
              {thumb ? (
                <img src={thumb} alt="" draggable={false} loading="lazy" />
              ) : (
                <span className="cg-thumb-none">
                  <Icon name="image" size={18} />
                  没有图
                </span>
              )}
              {!cg.enabled && <span className="cg-off">停用</span>}
            </span>
            <span className="cg-tile-name">{cg.label}</span>
            <span className="cg-tile-sub">
              {variants.length > 0 && <Icon name="cg" size={12} />}
              {variantCountLabel(variants.length)}
            </span>
          </button>
        );
      })}
      {uploads.map((u) => (
        <div key={u.key} className={`cg-tile uploading ${u.state}`} aria-label={`${u.name}:${UPLOAD_STATE[u.state]}`}>
          <span className="cg-thumb">
            <img src={u.url} alt="" draggable={false} />
            <span className="cg-progress">
              {u.state === 'up' ? <span className="spinner tiny" /> : u.state === 'fail' ? <Icon name="alert" size={15} /> : null}
              <span>{UPLOAD_STATE[u.state]}</span>
            </span>
          </span>
          <span className="cg-tile-name">{u.name}</span>
          <span className="cg-tile-sub">&nbsp;</span>
        </div>
      ))}
      <button type="button" className="cg-add" onClick={onAdd}>
        <Icon name="plus" size={20} />
        <span>添加构图</span>
      </button>
    </div>
  );
}
