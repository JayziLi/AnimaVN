import { useMemo, useState } from 'react';
import { ExportMenu } from '../../components/export/ExportMenu';
import type { PackSprite } from '../../lib/api';
import type { TavernCard } from '../../lib/cardParser';
import { estimateTokens, formatTokens } from '../../lib/tokens';
import { facesByCanvas } from '../../plugins/spriteLayout';
import { bookCount, cardBlurb, greetingCount, specLabel } from '../cardInfo';
import { FaceThumb } from '../FaceThumb';
import { Icon, type IconName } from '../icons';
import { CardAvatar } from '../StudioAside';
import { TERMS } from '../terms';
import { Btn, HelpTip } from '../ui';
import { ArmedBtn } from './ArmedBtn';
import type { ProfileBinding } from './ProfileSide';

/**
 * 局内菜单「角色」页的右栏(设计稿 kit/cardedit.js 的 .ce-her,10-24 用户:「之前的点击角色不是有一些描述什么的吗
 * 做进角色里 角色卡大页的右边 让玩家可以看到和绑定素材」):
 *
 *   她        头像(点了换)、卡名(就地改)、格式 · 作者 · 版本;简介三行;开场白 / 世界书 / 描述多少
 *   表情差分   当前立绘包里没禁用的那些,按脸裁的小圆头像
 *   绑定      玩家身份、预设 —— 一行一个,点开是下拉;改了当场就换(和卡编辑器右栏的「绑定」是同一份数据)
 *   底部      导出(角色包 / 只导卡)· 复制这张卡 …… 删除角色卡(点两下)
 *
 * 手机上(设计稿 phone.js 的 cardPage)整栏挪到字段上面,收成一行「头像 · 卡名 资料 · 绑定 …… 展开」,点开才是上面这些。
 *
 * 卡编辑器(全屏)那份右栏还是 ProfileSide(绑定 + Token 分布 + 上下文预算);菜单里预算在「预设」页底下那条。
 */

export interface ProfileHerProps {
  card: TavernCard;
  /** 卡面头像;读不出来时退回按脸裁的那张 */
  avatarUrl: string | null;
  faceSrc: string | null;
  /** 表情差分(当前包里没禁用的) */
  sprites: readonly PackSprite[];
  binding: ProfileBinding;
  busy: boolean;
  onChangeName: (name: string) => void;
  onPickAvatar: () => void;
  onExport: () => void;
  onExportBundle?: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
}

/** 绑定那一行:左边图标方块、两行字、右边小箭头;整行盖一个透明的原生下拉,点哪都是选 */
function BindRow({
  icon,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  icon: IconName;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const shown = options.find((o) => o.value === value)?.label ?? '';
  return (
    <label className={`pf-her-bind${disabled ? ' disabled' : ''}`}>
      <span className="pf-her-bico" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="pf-her-btx">
        <small>{label}</small>
        <b title={shown}>{shown}</b>
      </span>
      <Icon name="chev" size={14} />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 「复制这张卡」前面的两张叠纸(studio 的图标库里没有这一个) */
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </svg>
);

export function ProfileHer(props: ProfileHerProps) {
  const { card, binding, busy } = props;
  const name = card.name.trim() || '(无名)';
  const spec = [specLabel(card.spec), card.creator.trim(), card.character_version.trim() && `v${card.character_version.trim()}`]
    .filter(Boolean)
    .join(' · ');
  const blurb = cardBlurb(card);
  const faces = useMemo(() => facesByCanvas(props.sprites), [props.sprites]);
  const shownSprites = props.sprites.filter((s) => s.has_image);
  // 手机上那一行收着(电脑上这一行藏着,下面整块一直在)
  const [open, setOpen] = useState(false);
  const summary = [
    shownSprites.length > 0 && `${shownSprites.length} 张表情`,
    `${greetingCount(card)} 条开场白`,
    `${bookCount(card)} 条世界书`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <aside className={`pf-her${open ? ' open' : ''}`} aria-label="她的资料和绑定">
      <button type="button" className="pf-her-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <CardAvatar className="pf-her-hava" sources={[props.avatarUrl, props.faceSrc]} name={name} />
        <span className="pf-her-ht">
          {name}
          <em>资料 · 绑定</em>
        </span>
        <span className="pf-her-hsum">{summary}</span>
        <span className="pf-her-htg">{open ? '收起' : '展开'}</span>
      </button>
      <div className="pf-her-body">
        <div className="pf-her-id">
          <button type="button" className="pf-her-ava" title="点击更换头像(裁成 1:1 · 512×512)" aria-label="更换头像" onClick={props.onPickAvatar}>
            <CardAvatar className="pf-her-img" sources={[props.avatarUrl, props.faceSrc]} name={name} />
          </button>
          <div className="pf-her-idt">
            <input
              className="pf-her-name"
              value={card.name}
              placeholder="(无名)"
              aria-label="卡名"
              title="卡名,点一下就能改"
              spellCheck={false}
              onChange={(e) => props.onChangeName(e.target.value)}
            />
            <span className="pf-her-spec" title={spec}>
              {spec}
            </span>
          </div>
        </div>
        {blurb && <p className="pf-her-intro">{blurb}</p>}
        <div className="pf-her-stats">
          <span>
            <b>{greetingCount(card)}</b> 条开场白
          </span>
          <span>
            <b>{bookCount(card)}</b> 条世界书
          </span>
          <span>
            描述约 <b>{formatTokens(estimateTokens(card.description))}</b> tok
          </span>
        </div>

        {shownSprites.length > 0 && (
          <>
            <div className="pf-her-hs">
              <span className="pf-her-hh">表情差分</span>
              <span className="pf-her-dim">{shownSprites.length} 张</span>
            </div>
            <div className="pf-her-faces" role="list" aria-label="表情差分">
              {shownSprites.map((s) => (
                <span key={s.id} className="pf-her-face" role="listitem" title={s.label} aria-label={s.label}>
                  <FaceThumb sprite={s} face={faces.get(s.id) ?? null} className="pf-her-fimg" />
                </span>
              ))}
            </div>
          </>
        )}

        <div className="pf-her-hs">
          <span className="pf-her-hh">绑定</span>
          <HelpTip text={TERMS.bind} />
        </div>
        <div className="pf-her-binds">
          <BindRow
            icon="person"
            label="玩家身份"
            value={binding.personaId ?? ''}
            disabled={busy}
            options={[
              {
                value: '',
                label: binding.defaultPersonaName ? `不绑定(用默认人设「${binding.defaultPersonaName}」)` : '不绑定(不自动切换)',
              },
              ...binding.personas.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(v) => binding.onPersona(v || null)}
          />
          <BindRow
            icon="preset"
            label="预设"
            value={binding.presetId ?? ''}
            disabled={busy}
            options={[{ value: '', label: '不绑定(用对话记的预设)' }, ...binding.presets.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(v) => binding.onPreset(v || null)}
          />
        </div>

        <div className="pf-her-sp" />
        <footer className="pf-her-foot">
          <ExportMenu
            variant="button"
            disabled={busy}
            bundleDisabled={!props.onExportBundle}
            onBundle={() => props.onExportBundle?.()}
            onJson={props.onExport}
          />
          {props.onDuplicate && (
            <Btn small onClick={props.onDuplicate} disabled={busy}>
              <CopyIcon />
              复制这张卡
            </Btn>
          )}
          <span className="st-flex" />
          <ArmedBtn small label="删除角色卡" disabled={busy} onConfirm={props.onDelete} />
        </footer>
      </div>
    </aside>
  );
}
