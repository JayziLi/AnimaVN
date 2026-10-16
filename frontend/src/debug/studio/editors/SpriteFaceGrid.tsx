/**
 * 立绘编辑器下半截:表情差分的网格。每格一个按脸裁的小头像 + 名字;
 * 排第一的(没停用的)右上角 ★ = 默认差分,设了入场动效的 ✦,停用的半透明、标「停用」;
 * 正在传的图先占一格(本地预览 + 转圈);最后一格「添加差分」。拖动排序(HTML5 拖放,放在目标的左半边 = 前面)。
 */

import { useState, type DragEvent } from 'react';
import type { PackSprite } from '../../lib/api';
import { normalizeEffect } from '../../plugins/spriteFx';
import type { FaceBox } from '../../plugins/spriteLayout';
import { FaceThumb } from '../FaceThumb';
import { Icon } from '../icons';
import { defaultSpriteId, moveId } from './spriteEdit';

/** 正在上传的一张:wait 排队、up 正在传、fail 没传上(过几秒消失) */
export interface UploadTile {
  key: string;
  name: string;
  /** 本地预览(URL.createObjectURL) */
  url: string;
  state: 'wait' | 'up' | 'fail';
}

type Place = 'before' | 'after';

export function SpriteFaceGrid({
  sprites,
  faces,
  selectedId,
  onSelect,
  onReorder,
  uploads,
  onAdd,
  locked,
}: {
  sprites: readonly PackSprite[];
  faces: ReadonlyMap<string, FaceBox>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 拖完的新顺序(全部 id) */
  onReorder: (ids: string[]) => void;
  uploads: readonly UploadTile[];
  /** 「添加差分」:选图上传 */
  onAdd: () => void;
  /** 正在排序 / 上传时不让拖 */
  locked?: boolean;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: Place } | null>(null);
  const defaultId = defaultSpriteId(sprites);
  const ids = sprites.map((s) => s.id);

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
      className="st-faces"
      role="group"
      aria-label="表情差分"
      onDragLeave={(e) => {
        // 拖出整个网格才清掉落点提示
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
    >
      {sprites.map((s) => {
        const selected = s.id === selectedId;
        const fx = normalizeEffect(s.effect);
        const mark = drop?.id === s.id && drag !== s.id ? ` drop-${drop.place}` : '';
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={selected}
            className={`st-face-tile${selected ? ' selected' : ''}${s.enabled ? '' : ' off'}${drag === s.id ? ' dragging' : ''}${mark}`}
            title={s.description || s.label}
            draggable={!locked}
            onClick={() => onSelect(s.id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', s.label);
              setDrag(s.id);
            }}
            onDragOver={(e) => over(e, s.id)}
            onDrop={land}
            onDragEnd={clear}
          >
            <FaceThumb sprite={s} face={faces.get(s.id) ?? null} className="st-face-56" />
            {s.id === defaultId ? (
              <span className="st-face-badge star" title="默认差分">
                <Icon name="star" size={11} fill />
              </span>
            ) : fx ? (
              <span className="st-face-badge fx" title="设了入场动效">
                <Icon name="spark" size={12} strokeWidth={2} />
              </span>
            ) : null}
            {!s.enabled && <span className="st-face-off">停用</span>}
            <span className="st-face-label">{s.label}</span>
          </button>
        );
      })}
      {uploads.map((u) => (
        <div key={u.key} className={`st-face-tile uploading ${u.state}`} aria-label={`${u.name}:${UPLOAD_STATE[u.state]}`}>
          <FaceThumb sprite={null} face={null} src={u.url} className="st-face-56" />
          <span className="st-face-progress">
            {u.state === 'up' ? <span className="spinner tiny" /> : u.state === 'fail' ? <Icon name="alert" size={16} /> : null}
            <span>{UPLOAD_STATE[u.state]}</span>
          </span>
          <span className="st-face-label">{u.name}</span>
        </div>
      ))}
      <button type="button" className="st-face-add" onClick={onAdd}>
        <Icon name="plus" size={20} />
        <span>添加差分</span>
      </button>
    </div>
  );
}

const UPLOAD_STATE: Record<UploadTile['state'], string> = { wait: '等待上传', up: '上传中', fail: '没传上' };
