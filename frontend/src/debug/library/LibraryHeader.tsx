/**
 * 素材管理页主区顶上那一行(照 V4Library):包名(点一下改名)、下面一行小字
 * 「16 张差分 · 18 MB · 已绑定 2 张卡:卡名、卡名」(卡名点了打开那张卡的卡编辑器素材页)、
 * 和别的包重复的写出来(点了选那个包)、来自哪次导入(点了看导入记录);
 * 右边「绑定到角色卡…」和「⋯」(重命名、创建副本、删除)。
 */

import { Fragment } from 'react';
import { Btn, Chip, MoreMenu, TitleEdit, type MenuItem } from '../studio/ui';
import { headerSummary, type LibraryItem, type LibraryKind } from './libraryModel';

/** 卡名最多列几个,多的写「等 N 张」 */
const MAX_CARDS = 4;

export interface LibraryHeaderProps {
  kind: LibraryKind;
  item: LibraryItem;
  /** 卡 id → 卡名(不在的卡不列) */
  cardNames: ReadonlyMap<string, string>;
  /** 和它是同一份文件的包 */
  sameAs: readonly LibraryItem[];
  /** 来自的那次导入的标题;没有是 null */
  jobTitle: string | null;
  onRename: (name: string) => Promise<boolean> | void;
  onBind: () => void;
  onOpenCard: (cardId: string) => void;
  onSelect: (id: string) => void;
  onOpenJob: (jobId: string) => void;
  menu: readonly MenuItem[];
}

export function LibraryHeader({
  kind,
  item,
  cardNames,
  sameAs,
  jobTitle,
  onRename,
  onBind,
  onOpenCard,
  onSelect,
  onOpenJob,
  menu,
}: LibraryHeaderProps) {
  const cards = item.card_ids.filter((id) => cardNames.has(id));
  const shown = cards.slice(0, MAX_CARDS);
  const all = cards.map((id) => cardNames.get(id)).join('、');
  return (
    <div className="lib-head">
      <div className="lib-head-text">
        <span className="lib-head-name">
          <TitleEdit value={item.name} label="名字" onCommit={onRename} />
          {item.generated && <Chip>AI 生成</Chip>}
        </span>
        <span className="lib-head-sub">
          <span>{headerSummary(kind, item)}</span>
          {cards.length === 0 ? (
            <span>未绑定</span>
          ) : (
            <span title={cards.length > MAX_CARDS ? all : undefined}>
              已绑定 {cards.length} 张卡:
              {shown.map((id, i) => (
                <Fragment key={id}>
                  {i > 0 && '、'}
                  <button
                    type="button"
                    className="st-link lib-card-link"
                    title={`打开「${cardNames.get(id)}」的卡编辑器`}
                    onClick={() => onOpenCard(id)}
                  >
                    {cardNames.get(id)}
                  </button>
                </Fragment>
              ))}
              {cards.length > MAX_CARDS && ` 等 ${cards.length} 张`}
            </span>
          )}
          {sameAs.length > 0 && (
            <span>
              和
              {sameAs.map((o, i) => (
                <Fragment key={o.id}>
                  {i > 0 && '、'}
                  <button type="button" className="st-link lib-card-link" onClick={() => onSelect(o.id)}>
                    「{o.name}」
                  </button>
                </Fragment>
              ))}
              一模一样
            </span>
          )}
          {item.import_job_id && jobTitle !== null && (
            <span>
              来自导入
              <button
                type="button"
                className="st-link lib-card-link"
                onClick={() => item.import_job_id && onOpenJob(item.import_job_id)}
              >
                「{jobTitle}」
              </button>
            </span>
          )}
        </span>
      </div>
      <Btn icon="link" onClick={onBind}>
        绑定到角色卡…
      </Btn>
      <MoreMenu label={`更多:${menu.map((m) => m.label).join('、')}`} items={menu} />
    </div>
  );
}
