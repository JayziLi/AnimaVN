/**
 * 卡编辑器「素材」页的左栏:上面是角色信息(头像、名字、简介、标签、开场白 / 世界书条数),
 * 下面是「在用的素材」—— 每一栏一行,副标题由 slotSummary.ts 算好传进来。
 * 窄屏时只剩那一排栏目,横着滚(studio.css)。
 *
 * 整栏是拖放落点(给这张卡加素材,先问一句);立绘 / 背景 / BGM / CG 那几行 = 都按这一类导入;
 * 底下那个框也能点,选文件导入给这张卡。
 */

import { useState } from 'react';
import { dropTarget, slotKind } from '../importer/dropTarget';
import type { TavernCard } from '../lib/cardParser';
import { bookCount, cardBlurb, greetingCount, specLabel } from './cardInfo';
import { Icon } from './icons';
import { Chip, SlotIcon } from './ui';
import type { SlotKey, SlotRow } from './types';

/** 头像:按顺序试几个地址(按脸裁的小图 → 卡面图),都不行就画名字的第一个字 */
export function CardAvatar({
  sources,
  name,
  className,
}: {
  sources: readonly (string | null | undefined)[];
  name: string;
  className: string;
}) {
  const list = sources.filter((s): s is string => Boolean(s));
  const key = list.join('\n');
  // 第几个地址读不出来了;换了一组地址就从头试
  const [failed, setFailed] = useState({ key, count: 0 });
  const count = failed.key === key ? failed.count : 0;
  const src = list[count];
  if (!src) {
    return (
      <span className={`${className} blank`} aria-hidden="true">
        {name.trim().slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed({ key, count: count + 1 })}
    />
  );
}

interface Props {
  cardId: string;
  card: TavernCard;
  /** 头像地址,按顺序试 */
  avatars: readonly (string | null | undefined)[];
  slots: readonly SlotRow[];
  active: SlotKey;
  onSlot: (slot: SlotKey) => void;
  /** 「编辑资料」→ 资料页 */
  onEditProfile: () => void;
  /** 底下那个框:选文件导入给这张卡;不给就只是说明 */
  onImport?: () => void;
}

export function StudioAside({ cardId, card, avatars, slots, active, onSlot, onEditProfile, onImport }: Props) {
  const name = card.name.trim() || '(无名)';
  const blurb = cardBlurb(card);
  const tags = card.tags.map((t) => t.trim()).filter(Boolean);
  const drop = dropTarget(cardId, name);
  const hint = (
    <>
      <Icon name="upload" size={18} />
      <span>拖入素材文件,确认后给此角色用</span>
    </>
  );
  return (
    <aside className="st-aside" aria-label={name} {...drop}>
      <div className="st-card">
        <CardAvatar className="st-card-avatar" sources={avatars} name={name} />
        <div className="st-card-title">
          <span className="st-card-name" title={name}>
            {name}
          </span>
          <span className="st-card-spec">{specLabel(card.spec)}</span>
        </div>
        {blurb && (
          <p className="st-card-blurb" title={blurb}>
            {blurb}
          </p>
        )}
        {tags.length > 0 && (
          <div className="st-card-tags">
            {tags.slice(0, 6).map((t, i) => (
              <Chip key={`${i}:${t}`}>{t}</Chip>
            ))}
          </div>
        )}
        <div className="st-card-stats">
          <span>
            开场白 <b>{greetingCount(card)}</b>
          </span>
          <span>
            世界书 <b>{bookCount(card)} 条</b>
          </span>
          <button type="button" className="st-link" onClick={onEditProfile}>
            编辑资料
          </button>
        </div>
      </div>

      <div className="st-aside-head">在用的素材</div>
      <nav className="st-slots" aria-label="在用的素材">
        {slots.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`st-slotrow${s.state === 'empty' ? ' empty' : ''}`}
            {...dropTarget(cardId, name, slotKind(s.key))}
            aria-current={s.key === active ? 'true' : undefined}
            onClick={() => onSlot(s.key)}
          >
            <span className="st-slotrow-icon">
              <SlotIcon slot={s.key} />
            </span>
            <span className="st-slotrow-text">
              <span className="st-slotrow-name">{s.name}</span>
              <span className="st-slotrow-sub" title={s.sub}>
                {s.sub}
              </span>
            </span>
            <span className={`st-slot-status ${s.state}`} title={s.state === 'ok' ? '在用' : '还没有'}>
              <Icon name={s.state === 'ok' ? 'check' : 'plus'} size={s.state === 'ok' ? 12 : 10} strokeWidth={2.4} />
            </span>
          </button>
        ))}
      </nav>

      <span className="st-aside-fill" />
      {onImport ? (
        <button type="button" className="st-drop-hint" title="也可以点这里选文件" onClick={onImport} {...drop}>
          {hint}
        </button>
      ) : (
        <div className="st-drop-hint" {...drop}>
          {hint}
        </div>
      )}
    </aside>
  );
}
