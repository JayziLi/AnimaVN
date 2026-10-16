import { useState, type ReactNode, type Ref } from 'react';
import { BookEditor } from '../../components/BookEditor';
import type { AssemblyResult } from '../../lib/assembler';
import type { TavernCard } from '../../lib/cardParser';
import type { PresetOrderEntry, TavernPreset } from '../../lib/presetParser';
import { estimateTokens, formatTokens } from '../../lib/tokens';
import { Icon } from '../icons';
import { Btn, FieldLabel, HelpTip, IconBtn, TagsField } from '../ui';
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
  onExport: () => void;
  onDuplicate: () => void;
}

/** 一节的外框:圆角卡片,目录选中的那节边框亮一点 */
function Sec({
  id,
  active,
  bind,
  head,
  children,
}: {
  id: ProfileKey;
  active: ProfileKey;
  bind: (key: ProfileKey) => (el: HTMLElement | null) => void;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <section ref={bind(id)} className={`pf-sec${active === id ? ' active' : ''}`} data-key={id}>
      <div className="pf-sec-head">{head}</div>
      {children}
    </section>
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
}: {
  value: string;
  rows: number;
  placeholder: string;
  label: string;
  onChange: (v: string) => void;
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
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function CardFieldsView(props: CardFieldsViewProps) {
  const { card, preset, order, result, fields, active, bindSection, busy, onChange } = props;
  const [openPreview, setOpenPreview] = useState<Partial<Record<ProfileKey, boolean>>>({});
  const [greetingAt, setGreetingAt] = useState(0);

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
      <div className="pf-title-row">
        <h2 className="pf-title">角色卡</h2>
        <span className="pf-title-note">改了 0.6 秒后自动保存</span>
        <span className="st-flex" />
        <Btn icon="export" onClick={props.onExport} disabled={busy}>
          导出
        </Btn>
        <Btn onClick={props.onDuplicate} disabled={busy}>
          复制这张卡
        </Btn>
      </div>

      {fields.map((f) => {
        const { def } = f;
        const wrap = def.wrap && preset ? preset.formats[def.wrap] : null;
        const open = openPreview[def.key] ?? false;
        const note = f.status === 'empty' ? blockedNote(def, preset, order) : f.note;
        const tokens =
          f.status === 'empty'
            ? '空'
            : `${f.status === 'active' ? f.tokens : estimateTokens(f.value)} tok`;
        return (
          <Sec
            key={def.key}
            id={def.key}
            active={active}
            bind={bindSection}
            head={
              <>
                {f.seq !== null && (
                  <span className="pf-seq" title={`在发出去的消息里排第 ${f.seq + 1} 条`}>
                    {seqLabel(f.seq)}
                  </span>
                )}
                <span className="pf-sec-title">{def.label}</span>
                <HelpTip text={def.hint} />
                <Badge
                  title={
                    def.mode === 'override'
                      ? `填了就顶替预设里 ${def.target} 块的正文`
                      : `填进预设里 ${def.target} 这个标记位`
                  }
                >
                  {def.mode === 'override' ? '覆盖' : '标记位'} {def.target}
                </Badge>
                <span className="st-flex" />
                <span
                  className="pf-sec-tok"
                  title={f.status === 'active' ? '下一次请求里实际占的 token' : '粗估;这次不会发出去'}
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
                    {open
                      ? '收起预览'
                      : `预览发出去的样子${f.produced.length > 1 ? ` (${f.produced.length} 条)` : ''}`}
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
            <span className="pf-sec-title">世界书 · Character Book</span>
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
          <Warn>
            世界书超出预算({formatTokens(result.worldInfo.budget ?? 0)} tok),排在后面的条目没有进提示词
          </Warn>
        )}
        <div className="pf-book">
          <BookEditor
            book={card.character_book}
            rows={bookRows}
            onChange={(character_book) => onChange({ character_book })}
          />
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
            <span className="pf-sec-title">开场白 · First Message</span>
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
        <div className="pf-sec-note">
          {gi === 0 ? '新建对话时角色说的第一句话' : `其他开场 ${gi} —— 建对话时可以挑这条`}
        </div>
        <FieldText
          label={gi === 0 ? '开场白' : `其他开场 ${gi}`}
          value={greeting}
          rows={8}
          placeholder="(角色说的第一句话)"
          onChange={setGreeting}
        />
        <div className="pf-sec-foot">
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

      <Sec
        id="notes"
        active={active}
        bind={bindSection}
        head={<span className="pf-sec-title">创作者注释 · Creator Notes</span>}
      >
        <div className="pf-sec-note">给玩家看的说明,不会发给 AI</div>
        <FieldText
          label="创作者注释"
          value={card.creator_notes}
          rows={5}
          placeholder="(给玩家看的说明)"
          onChange={(creator_notes) => onChange({ creator_notes })}
        />
      </Sec>

      <Sec
        id="meta"
        active={active}
        bind={bindSection}
        head={
          <>
            <span className="pf-sec-title">标签 / 元数据</span>
            <Badge title="卡的格式">{card.spec || 'spec 未知'}</Badge>
          </>
        }
      >
        <div className="pf-meta">
          <label>
            <FieldLabel text="创作者 · Creator" />
            <input className="st-input" value={card.creator} onChange={(e) => onChange({ creator: e.target.value })} />
          </label>
          <label>
            <FieldLabel text="版本 · Version" />
            <input
              className="st-input"
              value={card.character_version}
              onChange={(e) => onChange({ character_version: e.target.value })}
            />
          </label>
        </div>
        <FieldLabel text="标签 · Tags" />
        <TagsField values={card.tags} onChange={(tags) => onChange({ tags })} placeholder="输入后回车,逗号隔开可一次加几个" />
      </Sec>
    </main>
  );
}
