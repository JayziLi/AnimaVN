import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BookEntryList } from '../../components/BookEntryList';
import { CommentTextarea } from '../../components/CommentTextarea';
import type { MarkerSource } from '../../lib/cardFields';
import { countCommentLines, stripComments } from '../../lib/comments';
import { findUnresolvedMacros, substituteMacros, type MacroContext } from '../../lib/macros';
import type { PresetPrompt } from '../../lib/presetParser';
import { estimateTokens, formatTokens } from '../../lib/tokens';
import { OVERRIDABLE, ROLES, type BlockDraft } from './blockDraft';

/**
 * 预设块的编辑区 —— 不带外框、不带确定 / 取消,只画字段。
 * 草稿在外面(blockDraft.ts):弹窗(components/BlockEditorModal)攥着它,点「确定」才写回;
 * 资料页右栏(BlockEditorSide)每改一下就写回内存里的预设。
 *
 * 两种排法(layout):
 *   split —— 弹窗:上面一行是属性,下面左右分栏,左边改原文、右边实时预览真正发出去的字
 *            (注释去掉、宏展开)
 *   stack —— 资料页右栏(340px):字段一个一行往下排,原文 / 预览挤不下两栏,改成切页签
 *
 * 两类块在这里长得不一样:
 *   文本块  —— 改 name / role / content / forbid_overrides,正文就是发出去的字
 *   marker —— 块本身是空的,真正的内容在别处(卡的字段 / 人设库 / 聊天记录)。
 *             内容在卡里的那几个(角色描述、性格、场景、示例对话)直接在这儿改,
 *             写回角色卡;不在卡里的只指路,不给改。
 *
 * 位置那一栏对应酒馆的 injection_position / depth / order:「绝对深度」的块不按编排
 * 排,而是插进聊天记录里倒数第 N 条(2026-09-30 起,为了社区预设能直接导入)。
 *
 * 刻意不做的一件事:注释行语法高亮 —— 原生 textarea 无法给部分行上色,要做得换掉
 * 整个编辑器。原文上方那行「N 行注释已排除」已经把信息说清楚了。
 */

export interface BlockEditorPaneProps {
  /** split = 弹窗里左右分栏(默认);stack = 窄栏里竖排、原文 / 预览切页签 */
  layout?: 'split' | 'stack';
  prompt: PresetPrompt;
  /** 这一块此刻正被角色卡顶替 */
  overridden: boolean;
  /** marker 块的内容来源;非 marker、或预设自定义的未知 marker 时为 null */
  markerSource: MarkerSource | null;
  /** 正在改的样子 */
  draft: BlockDraft;
  /** 改了草稿里的几个字段 */
  onChange: (patch: Partial<BlockDraft>) => void;
  /** 预览展开宏用的取值 —— 和聊天区显示同一份 */
  macros: MacroContext;
}

/** 发出去的样子。随机宏用块 id 定种子,不然每敲一个字骰子就重掷一次 */
function PreviewPane({
  text,
  macros,
  seed,
  bare,
  children,
}: {
  text: string;
  macros: MacroContext;
  seed: string;
  /** 页签上已经写了「预览 · 实际发送」,这里就不再写一遍 */
  bare?: boolean;
  children?: ReactNode;
}) {
  const rendered = useMemo(
    () => substituteMacros(stripComments(text), macros, { seed }),
    [text, macros, seed],
  );
  const unresolved = findUnresolvedMacros(rendered);
  return (
    <section className="bm-pane">
      <div className="bm-pane-head">
        {!bare && <span className="bm-label">预览 · 实际发送</span>}
        <span className="bm-hint">注释已去 · 宏已展开 · ~{formatTokens(estimateTokens(rendered))} tokens</span>
      </div>
      <pre className="bm-preview">{rendered || '(空 —— 这一块不会发出任何内容)'}</pre>
      {unresolved.length > 0 && (
        <span className="bm-unresolved">没解析掉的宏:{unresolved.join(' ')}</span>
      )}
      {children}
    </section>
  );
}

/**
 * 正文区:编辑框 + 发出去的样子。split 左右并排;stack 两个页签切着看。
 * 文本块和卡填的 marker 共用 —— 只是编辑框和标题不一样
 */
function ContentArea({
  layout,
  rawLabel,
  rawHint,
  editor,
  text,
  macros,
  seed,
  previewExtra,
}: {
  layout: 'split' | 'stack';
  /** split 时编辑框上方的标题 */
  rawLabel: string;
  rawHint: ReactNode;
  editor: ReactNode;
  /** 拿去预览的原文 */
  text: string;
  macros: MacroContext;
  seed: string;
  /** 预览下面再补的东西(套的模板) */
  previewExtra?: ReactNode;
}) {
  const [tab, setTab] = useState<'raw' | 'preview'>('raw');

  if (layout === 'split') {
    return (
      <div className="bm-split">
        <section className="bm-pane">
          <div className="bm-pane-head">
            <span className="bm-label">{rawLabel}</span>
            <span className="bm-hint">{rawHint}</span>
          </div>
          {editor}
        </section>
        <PreviewPane text={text} macros={macros} seed={seed}>
          {previewExtra}
        </PreviewPane>
      </div>
    );
  }

  return (
    <div className="bes-content">
      <div className="bes-seg" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'raw'}
          className={tab === 'raw' ? 'on' : ''}
          onClick={() => setTab('raw')}
        >
          原文
        </button>
        <button
          role="tab"
          aria-selected={tab === 'preview'}
          className={tab === 'preview' ? 'on' : ''}
          onClick={() => setTab('preview')}
          title="注释去掉、宏展开以后真正发出去的字"
        >
          预览 · 实际发送
        </button>
      </div>
      {tab === 'raw' ? (
        <section className="bm-pane">
          <div className="bm-pane-head">
            <span className="bm-hint">{rawHint}</span>
          </div>
          {editor}
        </section>
      ) : (
        <PreviewPane text={text} macros={macros} seed={seed} bare>
          {previewExtra}
        </PreviewPane>
      )}
    </div>
  );
}

export function BlockEditorPane({
  layout = 'split',
  prompt,
  overridden,
  markerSource,
  draft,
  onChange,
  macros,
}: BlockEditorPaneProps) {
  const { name, role, content, forbidOverrides, absolute, depth, order } = draft;
  const commentLines = countCommentLines(content);
  const netTokens = estimateTokens(stripComments(content));
  // 弹窗一打开光标就进正文;右栏不抢 —— 焦点得留在左边的块列表上
  const autoFocus = layout === 'split';

  return (
    <>
      <div className="bm-props">
        <div className="bm-field bm-name">
          <span className="bm-label">名称</span>
          <input
            className="text-input"
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>

        {!prompt.marker && (
          <div className="bm-field">
            <span className="bm-label">角色</span>
            <div className="bm-roles">
              {ROLES.map((r) => (
                <button
                  key={r}
                  className={`bm-role${role === r ? ' on' : ''}`}
                  onClick={() => onChange({ role: r })}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {!prompt.marker && (
          <div className="bm-field">
            <span className="bm-label">位置</span>
            <div className="bm-depth-row">
              <div className="bm-roles">
                <button
                  className={`bm-role${absolute ? '' : ' on'}`}
                  onClick={() => onChange({ absolute: false })}
                  title="按左栏的顺序排"
                >
                  按编排
                </button>
                <button
                  className={`bm-role${absolute ? ' on' : ''}`}
                  onClick={() => onChange({ absolute: true })}
                  title="插进聊天记录里,倒数第 N 条消息之前"
                >
                  绝对深度
                </button>
              </div>
              {absolute && (
                <>
                  <label className="bm-inline">
                    <span className="bm-label">深度</span>
                    <input
                      className="text-input bm-num"
                      inputMode="numeric"
                      value={depth}
                      onChange={(e) => onChange({ depth: e.target.value })}
                      title="0 = 最后一条消息之后,1 = 它之前,依此类推"
                    />
                  </label>
                  <label className="bm-inline">
                    <span className="bm-label">顺序</span>
                    <input
                      className="text-input bm-num"
                      inputMode="numeric"
                      value={order}
                      onChange={(e) => onChange({ order: e.target.value })}
                      title="同一深度里数大的更靠近对话末尾。酒馆默认 100"
                    />
                  </label>
                </>
              )}
            </div>
            {absolute && (
              <span className="bm-hint">
                深度 0 = 最后一条之后;1 = 它之前。聊天记录不够长就垫在最前面。同深度同身份的块合成一条
              </span>
            )}
          </div>
        )}

        {!prompt.marker && OVERRIDABLE.has(prompt.identifier) && (
          <div className="bm-field">
            <label className="bm-check">
              <input
                type="checkbox"
                checked={forbidOverrides}
                onChange={(e) => onChange({ forbidOverrides: e.target.checked })}
              />
              禁止角色卡覆盖
            </label>
            <span className="bm-hint">
              勾上之后,就算角色卡自带
              {prompt.identifier === 'main' ? ' system_prompt' : ' post_history_instructions'}
              ,也用预设这一块的原文
            </span>
          </div>
        )}
      </div>

      {prompt.marker ? (
        <MarkerBody
          prompt={prompt}
          source={markerSource}
          value={draft.cardValue}
          onValueChange={(cardValue) => onChange({ cardValue })}
          macros={macros}
          layout={layout}
        />
      ) : (
        <>
          {overridden && (
            <div className="bm-note">
              这一块此刻正被角色卡顶替 —— 真正发出去的是卡里的字,不是下面这段。
              勾上「禁止角色卡覆盖」可以挡掉。
            </div>
          )}

          <ContentArea
            layout={layout}
            rawLabel="原文"
            rawHint={
              <>
                {commentLines > 0 && `${commentLines} 行注释已排除 · `}
                净 ~{formatTokens(netTokens)} tokens
                {commentLines === 0 && ' · 行首 // 的整行不会发出去'}
              </>
            }
            editor={
              <CommentTextarea
                value={content}
                onChange={(v) => onChange({ content: v })}
                autoFocus={autoFocus}
              />
            }
            text={content}
            macros={macros}
            seed={prompt.identifier}
          />
        </>
      )}
    </>
  );
}

/** marker 块的正文区 —— 三种情况长得完全不一样,拆出来免得上面那坨嵌套太深 */
function MarkerBody({
  prompt,
  source,
  value,
  onValueChange,
  macros,
  layout,
}: {
  prompt: PresetPrompt;
  source: MarkerSource | null;
  value: string;
  onValueChange: (v: string) => void;
  macros: MacroContext;
  layout: 'split' | 'stack';
}) {
  // 预设作者自定义的 marker —— 酒馆里也是空的,我们同样不认
  if (!source) {
    return (
      <div className="bm-marker-note">
        【占位符】这一块不存文本,运行时由组装器按 identifier 填入内容。
        <br />
        但 <code>{prompt.identifier}</code> 不是已知的 marker —— 组装时会被跳过,
        什么都不会填。这里只能改显示名。
      </div>
    );
  }

  // 内容不在卡里(人设 / 聊天记录 / 世界书):只指路
  if (source.kind === 'elsewhere') {
    return (
      <div className="bm-marker-note">
        <b>{source.label}</b>
        <br />
        {source.hint}
      </div>
    );
  }

  // 世界书:列出卡上的条目,点开看正文
  if (source.kind === 'book') {
    const constant = source.entries.filter((e) => e.enabled && e.constant);
    return (
      <>
        <div className="bm-note">
          <b>{source.label}</b> —— 角色卡的世界书里有 {source.entries.length}{' '}
          条放在这个位置,其中 {constant.length} 条常驻,其余的要聊天里提到关键词才进提示词。
          要改去角色卡编辑里的「世界书」。
        </div>
        <div className="bm-book">
          <BookEntryList entries={source.entries} />
        </div>
      </>
    );
  }

  // 内容是卡的某个字段:直接在这儿改,写回卡(弹窗是点确定以后写;右栏改了就写,卡自己会自动保存)
  return (
    <>
      <div className="bm-note">
        这一块的内容来自<b>角色卡</b>的「{source.def.label}」。
        {layout === 'split' ? '在这里改，确定后直接写回卡。' : '在这里改会直接写回卡,自动保存。'}
      </div>

      <ContentArea
        layout={layout}
        rawLabel={`内容 · 角色卡 ${source.def.key}`}
        rawHint={`~${formatTokens(estimateTokens(value))} tokens`}
        editor={
          <>
            <textarea
              className="bm-textarea"
              value={value}
              autoFocus={layout === 'split'}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder={source.def.hint}
            />
            <span className="bm-hint">{source.def.hint}</span>
          </>
        }
        text={value}
        macros={macros}
        seed={prompt.identifier}
        previewExtra={
          source.wrapTemplate && (
            <>
              <span className="bm-label">发出去之前会套进这个模板</span>
              <pre className="bm-wrap">{source.wrapTemplate}</pre>
              <span className="bm-hint">
                模板来自预设,不是卡的一部分 —— 所以最终那条消息比上面这段字长
              </span>
            </>
          )
        }
      />
    </>
  );
}
