/**
 * 素材管理页主区顶上那一行(照 V4Library):包名(点一下改名)、下面一行小字
 * 「16 张差分 · 18 MB · 已绑定 2 张卡:卡名、卡名」(卡名点了打开那张卡的卡编辑器素材页)、
 * 和别的包重复的写出来(点了选那个包)、来自哪次导入(点了看导入记录);
 * 右边「绑定到角色卡…」和「⋯」(重命名、创建副本、删除)。
 * 游戏菜单里(embedded)不做绑定:右边只有「给她用」(整个替换),小字写「在用」不写「绑定」,没有「绑定到角色卡…」。
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
  /**
   * 「给「她」用」(10-26,菜单「素材」页才有):游戏里现在这张卡;调试台的素材管理页没有当前卡,不给就不显示这颗按钮,
   * 照旧只有「绑定到角色卡…」
   */
  active?: { id: string; name: string } | null;
  /** 这个包是不是已经是 active 这一样唯一在用的那个 */
  activeBound?: boolean;
  usingActive?: boolean;
  onUseForActive?: () => void;
  /** 游戏菜单里的素材页:没有「绑定到角色卡…」,小字写「在用」 */
  embedded?: boolean;
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
  active,
  activeBound,
  usingActive,
  onUseForActive,
  embedded,
}: LibraryHeaderProps) {
  const cards = item.card_ids.filter((id) => cardNames.has(id));
  const shown = cards.slice(0, MAX_CARDS);
  const all = cards.map((id) => cardNames.get(id)).join('、');
  // 包名和两个按钮一行,下面那行小字单独占满一行:中间窄的时候小字不会被按钮挤成一个字一行(library.css 的 .lib-head)
  return (
    <div className="lib-head">
      <span className="lib-head-name">
        <TitleEdit value={item.name} label="名字" onCommit={onRename} />
        {item.generated && <Chip>AI 生成</Chip>}
      </span>
      {active ? (
        <Btn
          icon={activeBound ? 'check' : 'link'}
          kind={activeBound ? 'secondary' : 'primary'}
          disabled={activeBound || usingActive}
          onClick={onUseForActive}
          title={activeBound ? undefined : `整个替换掉「${active.name}」现在用的那个`}
        >
          {activeBound ? `「${active.name}」在用` : usingActive ? '换中…' : `给「${active.name}」用`}
        </Btn>
      ) : (
        !embedded && (
          <Btn icon="link" onClick={onBind}>
            绑定到角色卡…
          </Btn>
        )
      )}
      <MoreMenu label={`更多:${menu.map((m) => m.label).join('、')}`} items={menu} />
      <span className="lib-head-sub">
        <span>{headerSummary(kind, item)}</span>
        {cards.length === 0 ? (
          <span>{embedded ? '没有卡在用' : '未绑定'}</span>
        ) : (
          <span title={cards.length > MAX_CARDS ? all : undefined}>
            {embedded ? `${cards.length} 张卡在用:` : `已绑定 ${cards.length} 张卡:`}
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
  );
}
