import { useState } from 'react';
import { DeleteButton } from '../../components/pluginFields';
import type { MarkerSource } from '../../lib/cardFields';
import type { TavernCard } from '../../lib/cardParser';
import { stripComments } from '../../lib/comments';
import type { MacroContext } from '../../lib/macros';
import { MARKER_LABELS, type PresetPrompt } from '../../lib/presetParser';
import { estimateTokens, formatTokens } from '../../lib/tokens';
import { Btn } from '../ui';
import { BlockEditorPane } from './BlockEditorPane';
import {
  canDeleteBlock,
  cardPatchOf,
  changedFields,
  draftOf,
  shownCount,
  type BlockDraft,
} from './blockDraft';
import './blockEditor.css';

/**
 * 资料页 · 预设 · 右栏:选中那一块的编辑(照 V4CardPreset.png 的右栏)。
 *
 * 和弹窗不一样,这里没有「确定」:改一下就把变了的字段写回内存里的预设
 * (DebugApp 的 updateBlock,预设标脏),点左上「存」才写进库;左上「恢复」整套丢掉。
 * 所以这里不攥草稿 —— 每次都从块现在的样子现算,外面恢复、换预设,这里自然跟着变。
 * 只有深度 / 顺序两个数字框自己记原样文字(打到一半是空串,不能马上写回块)。
 *
 * marker 块改卡的字段时走 onUpdateCard(DebugApp 的 changeCard),卡是自动保存的,不等「存」。
 *
 * 每改一下就是 DebugApp 重渲染一次,和角色卡编辑每个字都走 changeCard 是同一个量级。
 */

export interface BlockEditorSideProps {
  /** 选中的块;null = 没选(或者选的块已经被删了),显示一句怎么用 */
  prompt: PresetPrompt | null;
  /** 这一块此刻正被角色卡顶替(DebugApp 的 overriddenIdentifiers) */
  overridden: boolean;
  /** marker 块的内容来源(DebugApp 的 resolveMarker);非 marker 传 null */
  markerSource: MarkerSource | null;
  /** 预览展开宏用的取值 —— 和聊天区显示同一份 */
  macros: MacroContext;
  /** 改了块:写回内存里的预设、标脏(DebugApp 的 updateBlock) */
  onUpdateBlock: (identifier: string, patch: Partial<PresetPrompt>) => void;
  /** marker 块改了卡的字段:写回角色卡(DebugApp 的 changeCard,自动保存) */
  onUpdateCard: (patch: Partial<TavernCard>) => void;
  /** 删块(DebugApp 的 deleteBlock);删完外面记得把选中清掉 */
  onDeleteBlock: (identifier: string) => void;
  /**
   * 10-25 晚用户定的原话:插件块点开只说一句「该块属于插件块,可在插件内修改」,
   * 旁边「去插件页」点了才跳 —— 不给这两个就照旧显示正常的字段编辑(调试台弹窗变体不传)
   */
  isPluginBlock?: (identifier: string) => boolean;
  onOpenPlugin?: (identifier: string) => void;
}

export function BlockEditorSide(props: BlockEditorSideProps) {
  if (!props.prompt) {
    return (
      <aside className="bes bes-empty" aria-label="编辑块">
        <p>点左边列表里的一块,在这里改它的名称、角色、位置和正文。</p>
        <p>插件块(立绘、场景、音乐指令)的正文由插件决定,要去插件页改。</p>
        <p>改完点左上「存」才写进预设。</p>
      </aside>
    );
  }
  // 换了块就整个重来:数字框记的原样文字、原文 / 预览页签都不带到下一块
  return <SideEditor key={props.prompt.identifier} {...props} prompt={props.prompt} />;
}

function SideEditor({
  prompt,
  overridden,
  markerSource,
  macros,
  onUpdateBlock,
  onUpdateCard,
  onDeleteBlock,
  isPluginBlock,
  onOpenPlugin,
}: BlockEditorSideProps & { prompt: PresetPrompt }) {
  const [depthText, setDepthText] = useState(String(prompt.injectionDepth));
  const [orderText, setOrderText] = useState(String(prompt.injectionOrder));

  const draft: BlockDraft = {
    ...draftOf(prompt, markerSource),
    depth: shownCount(depthText, prompt.injectionDepth),
    order: shownCount(orderText, prompt.injectionOrder),
  };

  const change = (patch: Partial<BlockDraft>) => {
    const next = { ...draft, ...patch };
    if (patch.depth !== undefined) setDepthText(patch.depth);
    if (patch.order !== undefined) setOrderText(patch.order);
    const blockPatch = changedFields(prompt, next);
    if (blockPatch) onUpdateBlock(prompt.identifier, blockPatch);
    const cardPatch = cardPatchOf(prompt, markerSource, next);
    if (cardPatch) onUpdateCard(cardPatch);
  };

  // 标题和左边列表里那一行叫法一致:marker 用中文名
  const title =
    prompt.marker && MARKER_LABELS[prompt.identifier]
      ? MARKER_LABELS[prompt.identifier]
      : prompt.name || prompt.identifier;
  const badge = prompt.marker
    ? { cls: 'badge-marker', text: 'MARKER' }
    : { cls: `badge-${prompt.role}`, text: prompt.role.toUpperCase() };
  // 文本块算净正文(注释不发);卡填的 marker 算卡里那段;别的 marker 算不出来
  const tokens = !prompt.marker
    ? estimateTokens(stripComments(prompt.content))
    : markerSource?.kind === 'card'
      ? estimateTokens(markerSource.value)
      : null;
  const note =
    markerSource?.kind === 'card'
      ? '正文改的是角色卡,自动保存;名称改完点左上「存」才写进预设'
      : '改完点左上「存」才写进预设';
  const plugin = isPluginBlock?.(prompt.identifier) ?? false;

  return (
    <aside className="bes" aria-label="编辑块">
      <div className="bes-head">
        <span className="bes-title" title={title}>
          {title}
        </span>
        <span className={`block-badge ${badge.cls}`}>{badge.text}</span>
        <span className="bes-spacer" />
        {tokens !== null && <span className="bes-tok">{formatTokens(tokens)} tok</span>}
      </div>

      <div className="bes-body">
        {plugin ? (
          <p className="bes-note bes-plugin-note">
            该块属于插件块,可在插件内修改
            <Btn small icon="link" onClick={() => onOpenPlugin?.(prompt.identifier)}>
              去插件页
            </Btn>
          </p>
        ) : (
          <>
            <BlockEditorPane
              layout="stack"
              prompt={prompt}
              overridden={overridden}
              markerSource={markerSource}
              draft={draft}
              onChange={change}
              macros={macros}
            />
            <p className="bes-note">{note}</p>
          </>
        )}
      </div>

      <div className="bes-foot">
        <span className="bm-id bes-id" title={prompt.identifier}>
          {prompt.identifier}
        </span>
        {prompt.systemPrompt && <span className="bm-builtin">内置块</span>}
        <span className="bes-spacer" />
        {canDeleteBlock(prompt) && (
          <DeleteButton
            disabled={false}
            label="删除块"
            onConfirm={() => onDeleteBlock(prompt.identifier)}
          />
        )}
      </div>
    </aside>
  );
}
