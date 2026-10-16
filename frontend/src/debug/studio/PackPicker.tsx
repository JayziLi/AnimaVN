/**
 * 「＋」点开的「从素材库选」弹窗:搜索框、库里的全部包(和这张卡同名、名字相近的排前面,标「可能想用」),
 * 点一行就绑上;底部「上传图片新建一套」。立绘栏、背景栏、BGM 栏、CG 栏共用,包长什么样由用的地方给。
 * 已经绑在这张卡上的也列出来(灰的、标「已绑定」),免得找不到以为丢了。
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { matchesQuery, rankForCard } from './packRanking';
import { Btn, Chip, Modal } from './ui';

export interface PickerPack {
  id: string;
  name: string;
  /** 一行灰字:「14 张」「16 张背景 · 7 首」 */
  count: string;
  /** 绑着它的卡有几张 */
  cardCount: number;
  /** 40px 的方块缩略图;不给画 icon */
  media?: ReactNode;
  /** 名字后面的小牌子(「AI 生成」这类) */
  tag?: string;
}

export interface PackPickerProps {
  /** 弹窗标题:「添加服装」 */
  title: string;
  packs: readonly PickerPack[];
  /** 按它排「可能想用」 */
  cardName: string;
  /** 这张卡(这一栏)已经绑着的 */
  boundIds: readonly string[];
  onPick: (id: string) => void;
  /** 底部按钮的字:「上传图片新建一套」;不给就没有这个按钮 */
  createLabel?: string;
  onCreate?: () => void;
  onCancel: () => void;
  /** 列表还在读 */
  loading?: boolean;
  /** 没有缩略图时画的图标 */
  icon?: Parameters<typeof Icon>[0]['name'];
}

export function PackPicker({
  title,
  packs,
  cardName,
  boundIds,
  onPick,
  createLabel,
  onCreate,
  onCancel,
  loading,
  icon = 'image',
}: PackPickerProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const bound = new Set(boundIds);
    const ranked = rankForCard(
      packs.filter((p) => matchesQuery(p.name, query)),
      cardName,
    );
    // 已经绑着的沉到最后
    return [...ranked.filter((r) => !bound.has(r.item.id)), ...ranked.filter((r) => bound.has(r.item.id))].map((r) => ({
      ...r,
      bound: bound.has(r.item.id),
    }));
  }, [packs, query, cardName, boundIds]);

  return (
    <Modal
      title={title}
      onCancel={onCancel}
      className="st-picker"
      footer={
        <>
          {createLabel && onCreate && (
            <Btn icon="upload" onClick={onCreate}>
              {createLabel}
            </Btn>
          )}
          <span className="st-flex" />
          <Btn onClick={onCancel}>取消</Btn>
        </>
      }
    >
      <label className="st-picker-search">
        <Icon name="search" size={15} />
        <input
          className="st-input"
          autoFocus
          value={query}
          placeholder="搜索名字"
          aria-label="搜索名字"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="st-picker-list" role="listbox" aria-label={title}>
        {rows.map(({ item, hint, bound }) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={false}
            aria-disabled={bound}
            className={`st-picker-row${bound ? ' bound' : ''}`}
            disabled={bound}
            onClick={() => onPick(item.id)}
          >
            <span className="st-picker-media">{item.media ?? <Icon name={icon} size={18} />}</span>
            <span className="st-picker-text">
              <span className="st-picker-name">
                <span className="st-picker-title">{item.name}</span>
                {item.tag && <Chip>{item.tag}</Chip>}
                {hint && !bound && <Chip strong>可能想用</Chip>}
              </span>
              <span className="st-picker-sub">
                {item.count} · {item.cardCount > 0 ? `被 ${item.cardCount} 张卡用` : '没有卡在用'}
              </span>
            </span>
            {bound ? <span className="st-picker-state">已绑定</span> : <Icon name="plus" size={16} />}
          </button>
        ))}
        {rows.length === 0 && (
          <div className="st-picker-empty">
            {loading ? '读取中…' : query.trim() ? `没有名字里带「${query.trim()}」的` : '素材库里还没有'}
          </div>
        )}
      </div>
    </Modal>
  );
}
