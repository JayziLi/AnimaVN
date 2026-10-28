import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { BookEditor } from '../../components/BookEditor';
import { ExportMenu } from '../../components/export/ExportMenu';
import type { AssemblyResult } from '../../lib/assembler';
import type { TavernCard } from '../../lib/cardParser';
import type { PresetOrderEntry, TavernPreset } from '../../lib/presetParser';
import { estimateTokens, formatTokens } from '../../lib/tokens';
import { Icon } from '../icons';
import { specLabel } from '../cardInfo';
import { CardAvatar } from '../StudioAside';
import { Btn, HelpTip, IconBtn, TagsField } from '../ui';
import { ArmedBtn } from './ArmedBtn';
import { blockedNote, seqLabel, type FieldState } from './fieldStatus';
import type { ProfileKey } from './tocRows';

/**
 * 资料页 · 角色卡的主区(照 V4CardInfo.png 的中间那栏):原来资料编辑抽屉的全部字段区。
 *
 *   进提示词的六个字段   按预设编排的真实顺序;每块标「覆盖 main」/「标记位 charDescription」、
 *                       排第几、占多少 token,发不出去的说清为什么;包裹模板、「预览发出去的样子」
 *   世界书               BookEditor,每条下一次会不会触发
 *   不进提示词的         开场白(翻页、加、删)、创作者注释、标签 / 元数据
 *
 * 每个字都直接交给 onChange(DebugApp 的 changeCard,停手 0.6 秒后自动保存),
 * 目录的 token、右栏的分布跟着就变。
 */

export interface CardFieldsViewProps {
  card: TavernCard;
  preset: TavernPreset | null;
  order: PresetOrderEntry[];
  result: AssemblyResult;
  /** 目录顺序的字段状态(ProfileTab 算好,目录和这里共用一份) */
  fields: readonly FieldState[];
  /** 加亮边框的那一节(目录点的、或滚到的) */
  active: ProfileKey;
  /** 每一节挂上来:目录跳转、滚动联动要用 */
  bindSection: (key: ProfileKey) => (el: HTMLElement | null) => void;
  mainRef: Ref<HTMLElement>;
  busy: boolean;
  onChange: (patch: Partial<TavernCard>) => void;
  /** 「导出 → 只导卡(.json)」 */
  onExport: () => void;
  /** 「导出 → 角色包(.animavn)…」;不给 = 这一项灰着(卡还没存进库) */
  onExportBundle?: () => void;
  /** 卡面头像(最上面那块的大头像);点它换头像 */
  avatarUrl?: string | null;
  onPickAvatar?: () => void;
  /** 「从这条开始新故事」(菜单「角色」页、卡编辑器资料页都有):不给就不显示这个按钮 */
  onStartGreeting?: (index: number) => void;
  /**
   * 局内菜单「角色」页(设计稿 kit/cardedit.js 的 .ce-main):最上面那块头像 / 元数据和「进入提示词」标题行不要
   * (头像、卡名、导出在右栏 ProfileHer),空字段也直接是一行输入框,「第 N 条 · X tok」写在标题行右边;
   * 创作者注释、标签 / 元数据排在开场白后面
   */
  menu?: boolean;
}

/** 一节的外框:圆角卡片,目录选中的那节边框亮一点 */
function Sec({
  id,
  active,
  bind,
  head,
  children,
  empty,
}: {
  id: ProfileKey;
  active: ProfileKey;
  bind: (key: ProfileKey) => (el: HTMLElement | null) => void;
  head: ReactNode;
  children?: ReactNode;
  /** 空字段收成一行(设计稿 .sd-field.empty):只有标题行,点「填写」才展开 */
  empty?: boolean;
}) {
  return (
    <section ref={bind(id)} className={`pf-sec${active === id ? ' active' : ''}${empty ? ' empty' : ''}`} data-key={id}>
      <div className="pf-sec-head">{head}</div>
      {children}
    </section>
  );
}

/** 「主提示词覆盖 · System Prompt」→ 宋体中文 + 斜体英文(设计稿 .sd-field .nm em) */
function SecTitle({ label }: { label: string }) {
  const at = label.indexOf(' · ');
  if (at < 0) return <span className="pf-sec-title">{label}</span>;
  return (
    <span className="pf-sec-title">
      {label.slice(0, at)}
      <em>{label.slice(at + 3)}</em>
    </span>
  );
}

/** 字段标题右边那个小灰牌:「覆盖 main」「标记位 charDescription」 */
const Badge = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="pf-badge" title={title}>
    {children}
  </span>
);

/** 一行黄字提醒:「这块在当前编排里被关掉了 —— 填了也不会发出去」 */
const Warn = ({ children }: { children: ReactNode }) => (
  <div className="pf-warn" role="note">
    <Icon name="alert" size={14} />
    <span>{children}</span>
  </div>
);

/** 多行输入:内容多高框就多高(最高 60% 屏),空的只有一行;不认 field-sizing 的浏览器按 rows 给高度 */
function FieldText({
  value,
  rows,
  placeholder,
  label,
  onChange,
  autoFocus,
}: {
  value: string;
  rows: number;
  placeholder: string;
  label: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const lines = value.trim() ? 2 : 1;
  return (
    <textarea
      className="pf-textarea"
      aria-label={label}
      rows={value.trim() ? rows : 1}
      style={{ minHeight: lines * 23 + 24 }}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function CardFieldsView(props: CardFieldsViewProps) {
  const { card, preset, order, result, fields, active, bindSection, busy, onChange, menu } = props;
  const [openPreview, setOpenPreview] = useState<Partial<Record<ProfileKey, boolean>>>({});
  const [greetingAt, setGreetingAt] = useState(0);
  // 空字段点过「填写」的:展开成输入框(这次打开期间记着,填了字以后本来就是展开的)
  const [filling, setFilling] = useState<Partial<Record<ProfileKey, boolean>>>({});
  const totalTokens = fields.reduce((n, f) => n + f.tokens, 0);
  // 卡编辑器(纸面皮)里「导出」挂到顶栏的空位上(设计稿 C:已自动保存 · 导出 · 开始);菜单「角色」页里没有顶栏,照旧放在这一行
  const titleRef = useRef<HTMLDivElement | null>(null);
  const [exportSlot, setExportSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setExportSlot(titleRef.current?.closest('.st-studio')?.querySelector<HTMLElement>('.st-header-slot') ?? null);
  }, []);
  const exportMenu = (
    <ExportMenu
      variant="button"
      disabled={busy}
      bundleDisabled={!props.onExportBundle}
      onBundle={() => props.onExportBundle?.()}
      onJson={props.onExport}
    />
  );

  const bookRows = result.worldInfo?.rows ?? [];
  const bookTotal = card.character_book?.entries.length ?? 0;
  const bookPlaced = bookRows.filter((r) => r.placed).length;

  // ---- 开场白:主开场 + 其他开场合成一个能翻页的列表(删到最后一条时序号往回收) ----
  const greetings = [card.first_mes, ...card.alternate_greetings];
  const gi = Math.min(greetingAt, greetings.length - 1);
  const greeting = greetings[gi] ?? '';
  const setGreeting = (v: string) => {
    if (gi === 0) {
      onChange({ first_mes: v });
      return;
    }
    const next = [...card.alternate_greetings];
    next[gi - 1] = v;
    onChange({ alternate_greetings: next });
  };

  return (
    <main ref={props.mainRef} className="st-main pf-main" aria-label="角色卡">
      {/* 最上面一块基本信息(设计稿 studio.html .sd-id):大头像、卡名、创作者 · 版本、标签、创作者注释 ——
          目录「标签 / 元数据」「创作者注释」跳到这里 */}
      {!menu && (
        <section ref={bindSection('meta')} className="pf-hero" data-key="meta">
          <button
            type="button"
            className="pf-hero-avatar"
            title="点击更换头像(裁成 1:1 · 512×512)"
            aria-label="更换头像"
            disabled={!props.onPickAvatar}
            onClick={props.onPickAvatar}
          >
            <CardAvatar className="pf-hero-img" sources={[props.avatarUrl]} name={card.name} />
            <i aria-hidden="true">
              <Icon name="image" size={12} />
            </i>
          </button>
          <div className="pf-hero-main">
            <input
              className="pf-hero-name"
              value={card.name}
              placeholder="(无名)"
              aria-label="卡名"
              title="卡名,点一下就能改"
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <div className="pf-hero-spec" title={card.spec || 'spec 未知'}>
              {[specLabel(card.spec), card.creator.trim(), card.character_version.trim() && `v${card.character_version.trim()}`]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="pf-hero-meta">
            <label>
              <span>创作者 · Creator</span>
              <input className="st-input" value={card.creator} onChange={(e) => onChange({ creator: e.target.value })} />
            </label>
            <label>
              <span>版本 · Version</span>
              <input className="st-input" value={card.character_version} onChange={(e) => onChange({ character_version: e.target.value })} />
            </label>
          </div>
          <div className="pf-hero-tags">
            <span className="pf-hero-cap">标签 · Tags</span>
            <TagsField values={card.tags} onChange={(tags) => onChange({ tags })} placeholder="输入后回车,逗号隔开可一次加几个" />
          </div>
          <div ref={bindSection('notes')} className="pf-hero-notes" data-key="notes">
            <span className="pf-hero-cap">
              创作者注释 · Creator Notes<small>给玩家看的说明,不会发给 AI</small>
            </span>
            <FieldText
              label="创作者注释"
              value={card.creator_notes}
              rows={4}
              placeholder="(给玩家看的说明)"
              onChange={(creator_notes) => onChange({ creator_notes })}
            />
          </div>
        </section>
      )}

      {/* 设计稿 .sd-doc-h:进入提示词 In the prompt ? …… 卡片合计 N tok;「复制这张卡」在右栏底下(ProfileSide) */}
      {!menu && (
        <div ref={titleRef} className="pf-title-row">
          <h2 className="pf-title">进入提示词</h2>
          <span className="pf-title-en">In the prompt</span>
          <HelpTip text="目录按这张卡绑定的预设里的真实顺序排;右边是粗估的 token(中文 1 字约 1 个)。空 = 没填;! = 填了也发不出去。改了 0.6 秒后自动保存。" />
          <span className="st-flex" />
          <span className="pf-title-tok">卡片合计 {formatTokens(totalTokens)} tok</span>
          {exportSlot ? createPortal(exportMenu, exportSlot) : exportMenu}
        </div>
      )}

      {fields.map((f) => {
        const { def } = f;
        const wrap = def.wrap && preset ? preset.formats[def.wrap] : null;
        const open = openPreview[def.key] ?? false;
        const note = f.status === 'empty' ? blockedNote(def, preset, order) : f.note;
        const tokens =
          f.status === 'empty'
            ? '空'
            : `${menu && f.seq !== null ? `第 ${f.seq + 1} 条 · ` : ''}${f.status === 'active' ? f.tokens : estimateTokens(f.value)} tok`;
        const badge = (
          <Badge title={def.mode === 'override' ? `填了就顶替预设里 ${def.target} 块的正文` : `填进预设里 ${def.target} 这个标记位`}>
            {def.mode === 'override' ? '覆盖' : '标记位'} {def.target}
          </Badge>
        );
        if (!menu && !f.value.trim() && !filling[def.key]) {
          return (
            <Sec
              key={def.key}
              id={def.key}
              active={active}
              bind={bindSection}
              empty
              head={
                <>
                  <SecTitle label={def.label} />
                  <HelpTip text={def.hint} />
                  {badge}
                  {note && (
                    <span className="pf-warn-inline" role="note">
                      <Icon name="alert" size={13} />
                      {note}
                    </span>
                  )}
                  <span className="st-flex" />
                  <span className="pf-sec-tok">空</span>
                  <button type="button" className="pf-fill" onClick={() => setFilling((m) => ({ ...m, [def.key]: true }))}>
                    填写
                  </button>
                </>
              }
            />
          );
        }
        return (
          <Sec
            key={def.key}
            id={def.key}
            active={active}
            bind={bindSection}
            head={
              <>
                {!menu && f.seq !== null && (
                  <span className="pf-seq" title={`在发出去的消息里排第 ${f.seq + 1} 条`}>
                    {seqLabel(f.seq)}
                  </span>
                )}
                <SecTitle label={def.label} />
                <HelpTip text={def.hint} />
                {badge}
                <span className="st-flex" />
                <span
                  className="pf-sec-tok"
                  title={
                    f.status === 'active'
                      ? '下一次请求里实际占的 token;「第几条」= 在发出去的消息里排第几'
                      : f.status === 'empty'
                        ? '没填'
                        : '粗估;这次不会发出去'
                  }
                >
                  {tokens}
                </span>
              </>
            }
          >
            {note && <Warn>{note}</Warn>}
            <FieldText
              label={def.label}
              value={f.value}
              rows={def.rows}
              autoFocus={Boolean(filling[def.key]) && !f.value}
              placeholder={`(${def.hint})`}
              onChange={(v) => onChange({ [def.key]: v } as Partial<TavernCard>)}
            />
            {(f.produced.length > 0 || wrap) && (
              <div className="pf-sec-foot">
                {f.produced.length > 0 && (
                  <button
                    type="button"
                    className="st-link"
                    aria-expanded={open}
                    onClick={() => setOpenPreview((m) => ({ ...m, [def.key]: !open }))}
                  >
                    {open ? '收起预览' : `预览发出去的样子${f.produced.length > 1 ? ` (${f.produced.length} 条)` : ''}`}
                  </button>
                )}
                {wrap && (
                  <span className="pf-wrap" title="发出去之前套进预设里的这个模板">
                    包裹模板
                    <code>{wrap}</code>
                  </span>
                )}
              </div>
            )}
            {open &&
              f.produced.map((m, i) => (
                <div key={i} className="pf-preview">
                  <div className="pf-preview-role">{m.role.toUpperCase()}</div>
                  <pre className="pf-preview-body">{m.content}</pre>
                </div>
              ))}
          </Sec>
        );
      })}

      <Sec
        id="book"
        active={active}
        bind={bindSection}
        head={
          <>
            <SecTitle label="世界书 · Character Book" />
            <HelpTip text="聊天里提到关键词时才进提示词的设定;标成「常驻」的每一轮都进。每行右边写着这条下一次会不会触发、为什么。规则和酒馆一样,扫描条数、预算在「设置 › 世界书」" />
            <Badge>
              下一次请求 {bookPlaced}/{bookTotal} 条
            </Badge>
            <span className="st-flex" />
            <span className="pf-sec-tok">{formatTokens(result.budget.parts.worldInfo)} tok</span>
          </>
        }
      >
        {result.worldInfo?.overflowed && (
          <Warn>世界书超出预算({formatTokens(result.worldInfo.budget ?? 0)} tok),排在后面的条目没有进提示词</Warn>
        )}
        <div className="pf-book">
          <BookEditor book={card.character_book} rows={bookRows} onChange={(character_book) => onChange({ character_book })} />
        </div>
      </Sec>

      <div className="pf-divider">
        <b>以下内容不会进入提示词</b>
        <span>开场白进对话,其余只给人看</span>
      </div>

      <Sec
        id="greetings"
        active={active}
        bind={bindSection}
        head={
          <>
            <SecTitle label="开场白 · First Message" />
            {greetings.length > 1 && (
              <span className="pf-pager">
                <IconBtn icon="back" label="上一条" size={24} disabled={gi === 0} onClick={() => setGreetingAt(gi - 1)} />
                <span className="pf-pager-at">
                  {gi + 1}/{greetings.length}
                </span>
                <IconBtn
                  icon="chev_r"
                  label="下一条"
                  size={24}
                  disabled={gi >= greetings.length - 1}
                  onClick={() => setGreetingAt(gi + 1)}
                />
              </span>
            )}
            <span className="st-flex" />
            <span className="pf-sec-tok">{greeting.trim() ? `${estimateTokens(greeting)} tok` : '空'}</span>
          </>
        }
      >
        <div className="pf-sec-note">{gi === 0 ? '新建对话时角色说的第一句话' : `其他开场 ${gi} —— 建对话时可以挑这条`}</div>
        <FieldText
          label={gi === 0 ? '开场白' : `其他开场 ${gi}`}
          value={greeting}
          rows={8}
          placeholder="(角色说的第一句话)"
          onChange={setGreeting}
        />
        <div className="pf-sec-foot">
          {props.onStartGreeting && (
            <Btn small icon="play" onClick={() => props.onStartGreeting?.(gi)} title="新建一段对话,直接从这一条开场白开始">
              从这条开始新故事
            </Btn>
          )}
          <Btn
            small
            icon="plus"
            onClick={() => {
              onChange({ alternate_greetings: [...card.alternate_greetings, ''] });
              setGreetingAt(greetings.length);
            }}
          >
            其他开场
          </Btn>
          {gi > 0 && (
            <ArmedBtn
              key={gi}
              small
              label="删除这条"
              onConfirm={() => {
                onChange({ alternate_greetings: card.alternate_greetings.filter((_, i) => i !== gi - 1) });
                setGreetingAt(gi - 1);
              }}
            />
          )}
        </div>
      </Sec>

      {menu && (
        <>
          <Sec id="notes" active={active} bind={bindSection} head={<SecTitle label="创作者注释 · Creator Notes" />}>
            <FieldText
              label="创作者注释"
              value={card.creator_notes}
              rows={4}
              placeholder="(给玩家看的说明,不会发给 AI)"
              onChange={(creator_notes) => onChange({ creator_notes })}
            />
          </Sec>
          <Sec
            id="meta"
            active={active}
            bind={bindSection}
            head={
              <>
                <SecTitle label="标签 / 元数据" />
                <Badge title="卡的格式">{card.spec || 'spec 未知'}</Badge>
              </>
            }
          >
            <div className="pf-meta-grid">
              <label>
                <span>
                  创作者<em>Creator</em>
                </span>
                <input className="st-input" value={card.creator} onChange={(e) => onChange({ creator: e.target.value })} />
              </label>
              <label>
                <span>
                  版本<em>Version</em>
                </span>
                <input className="st-input" value={card.character_version} onChange={(e) => onChange({ character_version: e.target.value })} />
              </label>
            </div>
            <div className="pf-meta-tags">
              <span className="pf-meta-cap">
                标签<em>Tags</em>
              </span>
              <TagsField values={card.tags} onChange={(tags) => onChange({ tags })} placeholder="输入后回车,逗号隔开可一次加几个" />
            </div>
          </Sec>
        </>
      )}
    </main>
  );
}
