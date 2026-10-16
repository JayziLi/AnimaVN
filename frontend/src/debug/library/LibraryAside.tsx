/**
 * 素材管理页左栏(照 V4Library 的 lib_aside):「立绘包 27 个」+ 排序、筛选小按钮、包列表、底部占用空间。
 * 列表按包列、不按角色分组(一个角色可能绑别人的包);每行缩略图、名字、「22 张 · 58 MB」、「2 张卡」/「未绑定」,
 * CG 页 AI 生成的包标「AI 生成」。
 * 底部:文件仓库总共多大、这一类大约占多少、有重复的包时「重复 N 套」(点了筛出来),「清理」由外面接(先确认)。
 * 窄屏时列表变成一排横着滚的小卡片(library.css)。
 */

import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '../studio/icons';
import { Chip } from '../studio/ui';
import { blobThumbUrl } from './libraryApi';
import {
  KIND_INFO,
  SORT_LABELS,
  boundLabel,
  formatSize,
  itemSub,
  sortOptions,
  type FilterChip,
  type LibraryFilter,
  type LibraryItem,
  type LibraryKind,
  type SortBy,
  type StorageSummary,
} from './libraryModel';

const ICONS: Record<LibraryKind, IconName> = {
  sprite: 'person',
  voice: 'mic',
  bg: 'scene',
  bgm: 'music',
  cg: 'cg',
};

export interface LibraryAsideProps {
  kind: LibraryKind;
  /** 这一类全部的(左栏标题的个数) */
  total: number;
  /** 排好、筛好的 */
  items: readonly LibraryItem[];
  /** 还在读 */
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  sort: SortBy;
  onSort: (by: SortBy) => void;
  chips: readonly FilterChip[];
  filter: LibraryFilter;
  onFilter: (f: LibraryFilter) => void;
  /** 搜索框里的字(列表空的时候说「没有名字里带…」) */
  query: string;
  storage: StorageSummary;
  cleaning: boolean;
  onClean: () => void;
}

export function LibraryAside({
  kind,
  total,
  items,
  loading,
  selectedId,
  onSelect,
  sort,
  onSort,
  chips,
  filter,
  onFilter,
  query,
  storage,
  cleaning,
  onClean,
}: LibraryAsideProps) {
  const info = KIND_INFO[kind];
  // 中文里夹的英文前后空一格:「立绘约 210 MB」「BGM 约 40 MB」
  const about = `${info.tab}${/[A-Za-z]$/.test(info.tab) ? ' ' : ''}约 ${formatSize(storage.kindBytes)}`;
  // 选中的那行滚进来(从顶上的卡名、「一模一样」跳过来时可能在下面)
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, kind]);

  return (
    <aside className="lib-aside" aria-label={info.pack}>
      <div className="lib-aside-head">
        <span className="lib-aside-title">{info.pack}</span>
        <span className="lib-aside-count">{total} 个</span>
        <span className="st-flex" />
        <label className="lib-sort" title="排序">
          <span>{SORT_LABELS[sort]}</span>
          <Icon name="chev" size={13} />
          <select aria-label="排序" value={sort} onChange={(e) => onSort(e.target.value as SortBy)}>
            {sortOptions(kind).map((by) => (
              <option key={by} value={by}>
                {SORT_LABELS[by]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="lib-chips" role="group" aria-label="筛选">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="lib-chip"
            aria-pressed={filter === c.key}
            onClick={() => onFilter(c.key)}
          >
            {c.label} {c.count}
          </button>
        ))}
      </div>
      <div ref={list} className="lib-list" role="list">
        {items.map((it) => {
          const selected = it.id === selectedId;
          return (
            <button
              key={it.id}
              type="button"
              role="listitem"
              aria-current={selected ? 'true' : undefined}
              className={`lib-row${selected ? ' selected' : ''}`}
              title={it.name}
              onClick={() => onSelect(it.id)}
            >
              {it.cover_sha ? (
                <img
                  className={`lib-row-thumb ${kind}`}
                  src={blobThumbUrl(it.cover_sha, kind === 'sprite' ? 96 : 120)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                />
              ) : (
                <span className="lib-row-thumb blank">
                  <Icon name={ICONS[kind]} size={16} />
                </span>
              )}
              <span className="lib-row-text">
                <span className="lib-row-name">
                  <span className="lib-row-title">{it.name}</span>
                  {it.generated && <Chip>AI 生成</Chip>}
                </span>
                <span className="lib-row-sub">{itemSub(kind, it)}</span>
              </span>
              <span className={`lib-row-bound${it.card_ids.length ? '' : ' none'}`}>{boundLabel(it)}</span>
            </button>
          );
        })}
        {items.length === 0 && (
          <div className="lib-list-empty">
            {loading
              ? '读取中…'
              : total === 0
                ? `还没有${info.pack}`
                : query.trim()
                  ? `没有和「${query.trim()}」对得上的`
                  : '这一项下面没有'}
          </div>
        )}
      </div>
      <div className="lib-foot">
        <div className="lib-foot-row">
          <span>占用空间</span>
          <span className="lib-foot-total">{storage.total === null ? '…' : formatSize(storage.total)}</span>
        </div>
        <div
          className="lib-bar"
          role="img"
          aria-label={about}
          title={`${about}(重复的包共用文件,只算一份)`}
        >
          <span style={{ width: `${Math.round(storage.share * 1000) / 10}%` }} />
        </div>
        <div className="lib-foot-row">
          <span className="lib-foot-key" />
          {kind === 'voice' ? (
            <span className="lib-foot-note">参考音频在语音机上,不占这里</span>
          ) : (
            <span className="lib-foot-note">{about}</span>
          )}
          {storage.dupes > 0 && (
            <button type="button" className="st-link lib-foot-link" onClick={() => onFilter('dupes')}>
              重复 {storage.dupes} 套
            </button>
          )}
          <span className="st-flex" />
          <button
            type="button"
            className="st-link lib-foot-link"
            disabled={cleaning}
            title="把没有任何包、卡和备份用到的文件挪进回收区(30 天后才真删)"
            onClick={onClean}
          >
            {cleaning ? '清理中…' : '清理'}
          </button>
        </div>
      </div>
    </aside>
  );
}
