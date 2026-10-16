import { useEffect, useRef } from 'react';
import type { TavernCard } from '../../lib/cardParser';
import { formatTokens } from '../../lib/tokens';
import { specLabel } from '../cardInfo';
import { Icon } from '../icons';
import { CardAvatar } from '../StudioAside';
import { TERMS } from '../terms';
import { HelpTip } from '../ui';
import type { ProfileKey, TocRow } from './tocRows';

/**
 * 资料页的左栏(照 V4CardInfo.png):头像(点了换)、卡名(就地改)、格式;
 * 目录三组 —— 进入提示词 / 不进提示词 / 预设;底部卡片合计。
 * 窄屏时整栏拆开:头像一行,目录变成贴在顶栏下面、横着滚的一排(profile.css)。
 */

interface Props {
  card: TavernCard;
  avatarUrl: string | null;
  prompt: readonly TocRow[];
  other: readonly TocRow[];
  preset: TocRow;
  /** 亮着的那一行 */
  active: ProfileKey;
  /** 进提示词的字段一共多少 token(只算真发出去的) */
  totalTokens: number;
  /** 填了也发不出去的字段有几个 */
  warnCount: number;
  onJump: (key: ProfileKey) => void;
  onChangeName: (name: string) => void;
  onPickAvatar: () => void;
}

/** 把亮着的那一行挪进目录的可见范围:只滚目录自己(竖着或横着),不碰外面正在滚的主区 / 整页 */
function reveal(el: HTMLElement, stop: HTMLElement) {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (box.scrollWidth > box.clientWidth) {
      if (r.left < b.left) box.scrollLeft -= b.left - r.left + 12;
      else if (r.right > b.right) box.scrollLeft += r.right - b.right + 12;
    }
    if (box.scrollHeight > box.clientHeight) {
      if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
      else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
    }
    if (box === stop) break;
  }
}

export function ProfileToc(props: Props) {
  const { card, active, onJump } = props;
  const name = card.name.trim() || '(无名)';
  const spec = [specLabel(card.spec), card.creator.trim(), card.character_version.trim() && `v${card.character_version.trim()}`]
    .filter(Boolean)
    .join(' · ');

  const root = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const box = root.current;
    const row = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (box && row) reveal(row, box);
  }, [active]);

  const row = (r: TocRow) => (
    <button
      key={r.key}
      type="button"
      className="pf-row"
      aria-current={r.key === active ? 'true' : undefined}
      onClick={() => onJump(r.key)}
    >
      <span className="pf-row-label" title={r.label}>
        {r.label}
      </span>
      {r.badge && <span className={`pf-row-badge${r.warn ? ' warn' : ''}`}>{r.badge}</span>}
    </button>
  );

  return (
    <aside ref={root} className="pf-toc" aria-label="资料目录">
      <div className="pf-id">
        <button
          type="button"
          className="pf-avatar-btn"
          title="点击更换头像(裁成 1:1 · 512×512)"
          aria-label="更换头像"
          onClick={props.onPickAvatar}
        >
          <CardAvatar className="pf-avatar" sources={[props.avatarUrl]} name={name} />
          <span className="pf-avatar-badge" aria-hidden="true">
            <Icon name="image" size={12} />
          </span>
        </button>
        <div className="pf-id-text">
          <input
            className="pf-name"
            value={card.name}
            placeholder="(无名)"
            aria-label="卡名"
            title="卡名,点一下就能改"
            onChange={(e) => props.onChangeName(e.target.value)}
          />
          <span className="pf-spec" title={spec}>
            {spec}
          </span>
        </div>
      </div>

      <nav className="pf-nav" aria-label="资料目录">
        <div className="pf-group">
          进入提示词
          <HelpTip text={TERMS.order} />
        </div>
        {props.prompt.map(row)}
        <div className="pf-group">不进提示词</div>
        {props.other.map(row)}
        <div className="pf-group">预设</div>
        {row(props.preset)}
      </nav>

      <div className="pf-toc-foot">
        <div className="pf-toc-sum">
          <span>卡片合计</span>
          <span className="pf-toc-tok">{formatTokens(props.totalTokens)} tok</span>
        </div>
        {props.warnCount > 0 && <div className="pf-toc-warn">{props.warnCount} 个字段填了也不会发出去</div>}
      </div>
    </aside>
  );
}
