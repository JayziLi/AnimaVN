import { useEffect, useRef, useState } from 'react';
import type { StoredPreset } from '../lib/api';
import type { MarkerSource } from '../lib/cardFields';
import type { TavernCard } from '../lib/cardParser';
import { stripComments } from '../lib/comments';
import type { MacroContext } from '../lib/macros';
import {
  MARKER_LABELS,
  orderGroupLabel,
  type PresetOrderEntry,
  type PresetPrompt,
  type TavernPreset,
} from '../lib/presetParser';
import { estimateTokens, formatTokens } from '../lib/tokens';
import { sendBadge, type BlockSend, type SendBadge } from '../core/sendPlan';
import { PLAYER_BLOCK_ID } from '../plugins/player';
import { BlockEditorModal } from './BlockEditorModal';
import { AnimaIcon } from './AnimaIcon';
import { Tip } from './drawer/Tip';

const NO_PLAN: readonly BlockSend[] = [];

/** 插件块的名字去掉「 · 插件」:后面已经有「插件」小块了,左栏窄,省出地方给名字(悬停看全名) */
const pluginLabel = (name: string) => name.replace(/\s*·\s*插件$/, '');

/** 插件块这次怎么发的小块(core/sendPlan.ts 的 sendBadge):字 + 问号 */
function SendChip({ badge }: { badge: SendBadge }) {
  return (
    <span className={`block-state ${badge.kind}`}>
      {badge.text}
      <Tip k={badge.tip} />
    </span>
  );
}

/** 左栏里一块自动补的块 */
export interface AutoBlockRow {
  identifier: string;
  name: string;
  /** ai:那一路是 AI 写;no-key:选的是 Jev,但 Jev 没 key */
  reason: 'ai' | 'no-key';
  /** 它后面紧挨着的那一块;null = 排在最后 */
  before: string | null;
}

export interface PresetPanelProps {
  /**
   * 怎么摆。panel(默认)= 调试台左栏 / 视觉小说菜单里那一整块:标题、预设行、绑定、编排、新建块、块列表。
   * page = 资料页 · 预设(studio/profile/PresetView)里的块列表:只要表头和列表,
   * 预设行、绑定、编排、新建块由 PresetView 摆在上面;不收起,没有预设时什么都不画
   */
  variant?: 'panel' | 'page';
  preset: TavernPreset | null;
  order: PresetOrderEntry[];
  activeGroupIndex: number;
  collapsed: boolean;
  /** 后端存着的预设列表,下拉用 */
  saved: StoredPreset[];
  selectedId: string | null;
  /** 有未保存改动 */
  dirty: boolean;
  busy: boolean;
  onToggleCollapse: () => void;
  onPickGroup: (index: number) => void;
  onToggleBlock: (identifier: string) => void;
  onUpdateBlock: (identifier: string, patch: Partial<PresetPrompt>) => void;
  /** 拖拽改编排顺序。to = 移除源项之后的目标下标 */
  onReorder: (from: number, to: number) => void;
  /** 新建块,返回新块的 identifier(没有预设时返回 null) */
  onAddBlock: () => string | null;
  /** 删块 —— 只有用户自建的块能删,内置的只能关 */
  onDeleteBlock: (identifier: string) => void;
  /**
   * 插件块(立绘 / 场景 / 音乐指令):正文由插件的提示词模板决定,预设里不能单独改。
   * 左栏只给它们开关和排序,点开就跳到插件抽屉里对应的模板
   */
  isPluginBlock: (identifier: string) => boolean;
  onOpenPlugin: (identifier: string) => void;
  /**
   * 这次组装自动补上的插件块(core/assembly.ts):不在预设里,灰色显示在它实际的位置上,不能拖、不能开关。
   * before = 它后面紧挨着的那一块(null = 排在最后)
   */
  autoBlocks?: readonly AutoBlockRow[];
  /**
   * 每个插件块这次怎么发(core/sendPlan.ts 的 blockSendPlan,和组装用的是同一份):名字后面写「先按 AI 写 /
   * 精简版 / 自动补 / 这次不发」+ 问号;这次不发的开关画灰、点不动(预设里的开关值不变)
   */
  sendPlan?: readonly BlockSend[];
  /** 「固定到预设」:变成预设里的普通块(和插件页的「加入当前预设」一样,要保存) */
  onPinAuto?: (identifier: string) => void;
  /** 正被角色卡顶替的块 identifier */
  overridden: Set<string>;
  /**
   * marker 块的内容来源。左栏不直接认识角色卡 —— 只拿一个查询函数,
   * 卡和预设的耦合留在 DebugApp 那一层
   */
  resolveMarker: (identifier: string) => MarkerSource | null;
  /** marker 块在详情弹窗里改了卡的字段 */
  onUpdateCard: (patch: Partial<TavernCard>) => void;
  /** 弹窗右侧预览展开宏用的取值 —— 和聊天区显示同一份 */
  macros: MacroContext;
  onSelectPreset: (id: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** 从标准骨架新建预设(库里一个都没有时也能用) */
  onNewPreset: () => void;
  onRename: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onImport: () => void;
  onExport: () => void;
  /**
   * 点块(行头、✎,还有新建块之后)交给外面,不开弹窗 —— 资料页把编辑放在右栏。
   * 不传就照旧开 BlockEditorModal。插件块照旧走 onOpenPlugin
   */
  onOpenBlock?: (identifier: string) => void;
  /** 外面正在编辑的那一块:这一行加亮 */
  selectedIdentifier?: string | null;
  /** 「绑定到当前角色卡」的快捷勾选;没选卡、没选预设时不传 */
  cardBinding?: {
    cardName: string;
    /** 这张卡绑的预设名;没绑是 null */
    boundName: string | null;
    /** 当前这套就是这张卡绑的 */
    bound: boolean;
    onToggle: (on: boolean) => void;
  };
}

/**
 * 预设面板和资料页 · 预设共用的那一套:状态、块操作、预设增删改。
 * 两处拿的是 DebugApp 同一份内存里的预设,哪边改了另一边跟着变
 */
export type PresetBaseProps = Omit<
  PresetPanelProps,
  'variant' | 'collapsed' | 'onToggleCollapse' | 'onOpenPlugin' | 'onOpenBlock' | 'selectedIdentifier'
>;

function badgeFor(prompt: PresetPrompt | undefined): { cls: string; text: string } {
  if (!prompt) return { cls: 'badge-missing', text: 'MISSING' };
  if (prompt.marker) return { cls: 'badge-marker', text: 'MARKER' };
  return { cls: `badge-${prompt.role}`, text: prompt.role.toUpperCase() };
}

export function PresetPanel({
  variant = 'panel',
  preset,
  order,
  activeGroupIndex,
  collapsed,
  saved,
  selectedId,
  dirty,
  busy,
  onToggleCollapse,
  onPickGroup,
  onToggleBlock,
  onUpdateBlock,
  onReorder,
  onAddBlock,
  onDeleteBlock,
  isPluginBlock,
  onOpenPlugin,
  autoBlocks = [],
  sendPlan = NO_PLAN,
  onPinAuto,
  overridden,
  resolveMarker,
  onUpdateCard,
  macros,
  onSelectPreset,
  onSave,
  onSaveAs,
  onNewPreset,
  onRename,
  onRestore,
  onDelete,
  onImport,
  onExport,
  onOpenBlock,
  selectedIdentifier = null,
  cardBinding,
}: PresetPanelProps) {
  const page = variant === 'page';
  /** 编辑弹窗开在哪个块上 —— 点行头或 ✎ 都开它 */
  const [detailOf, setDetailOf] = useState<string | null>(null);
  /** 预设行的 ⋯ 菜单 */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 按住把手才允许拖 —— 否则会和「点行头展开」以及文本选择打架 */
  const [dragArmed, setDragArmed] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; before: boolean } | null>(null);

  /** —— 触屏拖拽:HTML5 draggable 手指不触发,触屏这套走 Pointer Events —— */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 拖拽会话的真值放 ref:rAF 循环 / pointerup 里读 state 拿到的是上一帧的 */
  const dragFromRef = useRef<number | null>(null);
  const dropRef = useRef<{ index: number; before: boolean } | null>(null);
  /** 进行中的触屏拖拽(记 pointerId,第二根手指不抢) */
  const touchDrag = useRef<{ pointerId: number } | null>(null);
  const pointerY = useRef(0);
  const scrollRaf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

  /** 外面选中了哪一块(新建块之后也是):那一行在列表外面就滚进来,已经看得见就不动 */
  useEffect(() => {
    if (!selectedIdentifier) return;
    bodyRef.current?.querySelector('.block-row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdentifier]);

  /** 菜单开着时:点外面或 Esc 关掉 */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /** 打开块的编辑:外面接管了就交给外面,不然开弹窗 */
  const openBlock = (identifier: string) => {
    if (onOpenBlock) onOpenBlock(identifier);
    else setDetailOf(identifier);
  };

  /** 菜单项统一入口:先关菜单再干活 */
  const runMenu = (fn: () => void) => {
    setMenuOpen(false);
    fn();
  };

  if (page && !preset) return null;
  if (collapsed && !page) {
    return (
      <div className="panel left">
        <button className="panel-rail" onClick={onToggleCollapse}>
          ▸ 预设 PRESET
        </button>
      </div>
    );
  }

  const byIdentifier = new Map(preset?.prompts.map((p) => [p.identifier, p]) ?? []);
  // 换预设时 detailOf 可能指向一个已经不存在的块 —— 查不到就当没开
  const detailPrompt = detailOf ? byIdentifier.get(detailOf) ?? null : null;
  /** 插件块这次怎么发(只有在编排里的和这次自动补的) */
  const planOf = new Map(sendPlan.map((b) => [b.identifier, b]));
  const skipped = (identifier: string) => planOf.get(identifier)?.state === 'skip';
  /** 这块这次发不发:开着、而且不是这次不发的插件块 */
  const sent = (o: PresetOrderEntry) => o.enabled && !skipped(o.identifier);
  const enabledCount = order.filter(sent).length;
  // 只统计实际会进请求的文本块;marker 的内容来自卡和历史,这里算不出来
  const totalTokens = order
    .filter(sent)
    .reduce((sum, o) => {
      const p = byIdentifier.get(o.identifier);
      return sum + (p && !p.marker ? estimateTokens(stripComments(p.content)) : 0);
    }, 0);

  /** 落点的真值在 ref,state 只负责画那条指示线 —— 没变就不触发重渲染 */
  const setDrop = (next: { index: number; before: boolean } | null) => {
    dropRef.current = next;
    setDropAt((prev) =>
      prev && next && prev.index === next.index && prev.before === next.before ? prev : next,
    );
  };

  const endDrag = () => {
    setDragArmed(null);
    setDragFrom(null);
    setDrop(null);
    dragFromRef.current = null;
    touchDrag.current = null;
    cancelAnimationFrame(scrollRaf.current);
  };

  /** 落点换算 —— 这里最容易差一位:onReorder 的 to 是「移除源项之后」的下标 */
  const finishDrop = () => {
    const from = dragFromRef.current;
    const drop = dropRef.current;
    if (from === null || !drop) return endDrag();
    let insertAt = drop.before ? drop.index : drop.index + 1;
    // 源项在插入点之前,移除后整体左移一位
    if (from < insertAt) insertAt -= 1;
    if (insertAt !== from) onReorder(from, insertAt);
    endDrag();
  };

  /** 指针(或自动滚动)动一次就算一次落点 —— 和桌面 onDragOver 同一套 before/after 语义 */
  const updateTouchDrop = (clientY: number) => {
    const rows = bodyRef.current?.querySelectorAll<HTMLElement>('.block-row');
    if (!rows?.length) return;
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        setDrop({ index: idx, before: true });
        return;
      }
    }
    setDrop({ index: rows.length - 1, before: false });
  };

  /** 手指停在列表上/下边缘时继续滚 —— 长预设(20+ 块)不自动滚,屏外的位置永远拖不到 */
  const touchScrollLoop = () => {
    // 面板中途被收起(第二根手指点了 ◂)之类:列表没了就自己收尾,别空转
    const body = bodyRef.current;
    if (!body || !touchDrag.current) {
      if (touchDrag.current) endDrag();
      return;
    }
    const r = body.getBoundingClientRect();
    if (pointerY.current < r.top + 40) body.scrollTop -= 9;
    else if (pointerY.current > r.bottom - 40) body.scrollTop += 9;
    updateTouchDrop(pointerY.current);
    scrollRaf.current = requestAnimationFrame(touchScrollLoop);
  };

  /** 排在 before 前面的那几块自动补的块;before 是 null 时是排在最后的 */
  const autoRowsBefore = (before: string | null) =>
    autoBlocks
      .filter((a) => a.before === before)
      .map((a) => {
        const plan = planOf.get(a.identifier);
        const badge = plan ? sendBadge(plan) : null;
        return (
        <div key={`auto:${a.identifier}`} className="block-row auto">
          <div
            className="block-head"
            onClick={() => onOpenPlugin(a.identifier)}
            title="这次组装自动补上的插件块,不在预设里(不保存、不导出);点开去插件里看正文"
          >
            <span className="block-grip" aria-hidden>
              ·
            </span>
            <span className="block-name" title={a.name}>
              {pluginLabel(a.name)}
            </span>
            {a.identifier === PLAYER_BLOCK_ID && <Tip k="no_user_block" />}
            <span className="block-badge badge-plugin">插件</span>
            {badge ? (
              <SendChip badge={badge} />
            ) : (
              <span className="block-state auto">
                自动补
                <Tip k="auto_fill" />
              </span>
            )}
            {a.reason === 'no-key' && <SendChip badge={{ text: '先按 AI 写', tip: 'skip_nokey', kind: 'note' }} />}
            {onPinAuto && (
              <button
                className="btn small"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinAuto(a.identifier);
                }}
                title="固定到预设:变成预设里的普通块,之后能拖能改;改完记得保存预设"
              >
                固定
              </button>
            )}
          </div>
        </div>
        );
      });

  /** 左栏自己的那几行:标题、预设行、绑定、新建块、没预设时的提示。资料页这几样由 PresetView 摆 */
  const chrome = (
    <>
      {/* 标题行只留名字 —— 预设级操作全收进下面预设行的 ⋯ 菜单,
          不再单独摆一排导入/导出/删除 */}
      <div className="panel-head">
        <span className="panel-title">预设 · Preset</span>
        {dirty && <span className="dirty-dot" title="有未保存的改动">●</span>}
        <div style={{ flex: 1 }} />
        <button className="panel-collapse" onClick={onToggleCollapse} title="收起">
          <AnimaIcon name="panel-left" size={16} />
        </button>
      </div>

      {/* 下拉行:选择 / 存 / 导入 / ⋯。导入是开局必经动作,手机上也要直达;
          新建/重命名/另存/恢复/导出/删除才是低频,收进 ⋯ 菜单 —— 之前平铺两排图标,
          看到块列表之前要先过四行 chrome */}
      <div className="preset-bar">
        <select
          className="select preset-select"
          value={selectedId ?? ''}
          onChange={(e) => onSelectPreset(e.target.value)}
          disabled={busy}
        >
          {saved.length === 0 && <option value="">(还没有预设)</option>}
          {saved.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className={`icon-btn${dirty ? ' accent' : ''}`}
          onClick={onSave}
          disabled={busy || !selectedId || !dirty}
          title="更新当前预设"
        >
          <AnimaIcon name="save" size={15} />
        </button>
        <button className="icon-btn" onClick={onImport} disabled={busy} title="导入预设">
          <AnimaIcon name="import" size={15} />
        </button>
        <div className="preset-menu" ref={menuRef}>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title="更多预设操作"
          >
            <AnimaIcon name="more" size={16} />
          </button>
          {menuOpen && (
            <div className="preset-menu-pop">
              <button onClick={() => runMenu(onNewPreset)} disabled={busy}>
                <AnimaIcon name="add" size={15} />
                <span>新建预设</span>
              </button>
              <button onClick={() => runMenu(onRename)} disabled={busy || !selectedId}>
                <AnimaIcon name="edit" size={15} />
                <span>重命名</span>
              </button>
              <button onClick={() => runMenu(onSaveAs)} disabled={busy || !preset}>
                <AnimaIcon name="copy" size={15} />
                <span>另存为</span>
              </button>
              <button
                onClick={() => runMenu(onRestore)}
                disabled={busy || !selectedId || !dirty}
                title="丢弃未保存的改动"
              >
                <AnimaIcon name="restore" size={15} />
                <span>恢复</span>
              </button>
              <button onClick={() => runMenu(onExport)} disabled={busy || !preset}>
                <AnimaIcon name="export" size={15} />
                <span>导出</span>
              </button>
              <div className="preset-menu-sep" />
              <button
                className="danger"
                onClick={() => runMenu(onDelete)}
                disabled={busy || !selectedId}
              >
                <AnimaIcon name="delete" size={15} />
                <span>删除预设</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {cardBinding && (
        <div className="preset-bind">
          <label className="vp-check">
            <input
              type="checkbox"
              checked={cardBinding.bound}
              disabled={busy}
              onChange={(e) => cardBinding.onToggle(e.target.checked)}
            />
            绑定到当前角色卡「{cardBinding.cardName}」
          </label>
          {cardBinding.boundName && !cardBinding.bound && (
            <span className="preset-bind-note">
              这张卡绑的是「{cardBinding.boundName}」,现在临时用的这套;勾上就改绑成这套
            </span>
          )}
        </div>
      )}

      {preset && (
        <button
          className="block-add"
          onClick={() => {
            const identifier = onAddBlock();
            if (identifier) openBlock(identifier);
          }}
          disabled={busy}
        >
          ＋ 新建块
        </button>
      )}

      {!preset && (
        <div className="panel-empty">
          还没有载入预设
          <br />
          <button className="btn small panel-empty-cta" onClick={onNewPreset} disabled={busy}>
            ＋ 新建预设
          </button>
          <br />
          <span style={{ fontSize: 11 }}>生成酒馆默认的 10 个标准块;⋯ 菜单里也能导入现成的</span>
        </div>
      )}
    </>
  );

  return (
    <div className={page ? 'pp-list' : 'panel left'}>
      {!page && chrome}

      {preset && (
        <>
          {!page && preset.orderGroups.length > 1 && (
            <div className="order-picker">
              <span className="topbar-label">编排</span>
              <select
                className="select"
                value={activeGroupIndex}
                onChange={(e) => onPickGroup(Number(e.target.value))}
              >
                {preset.orderGroups.map((g, i) => (
                  <option key={g.characterId} value={i}>
                    {orderGroupLabel(g)} · {g.order.filter((o) => o.enabled).length} 启用
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 表头:名称 / Token —— 酒馆提示词管理器也有这一行 */}
          <div className="block-header">
            <span className="block-header-name">
              名称 <span className="block-header-count">{enabledCount}/{order.length}</span>
            </span>
            <span className="block-header-token">
              {page ? (
                <>
                  Token
                  {totalTokens > 0 && <span className="block-header-sum">~{formatTokens(totalTokens)}</span>}
                </>
              ) : totalTokens ? (
                `~${formatTokens(totalTokens)}`
              ) : (
                'Token'
              )}
            </span>
          </div>

          <div className="panel-body" ref={bodyRef}>
            {order.flatMap((entry, i) => [...autoRowsBefore(entry.identifier), (() => {
              const prompt = byIdentifier.get(entry.identifier);
              const plugin = Boolean(prompt) && isPluginBlock(entry.identifier);
              // 插件块这次怎么发(core/sendPlan.ts):这次不发的(Jev 标的、插件关着的、没素材的、外语跟不上主声音的)
              // 开关画灰、点不动,预设里的值不变;预设里本来就关着的照常
              const plan = plugin ? planOf.get(entry.identifier) : undefined;
              const state = plan ? sendBadge(plan) : null;
              const skippedNow = state?.kind === 'skip';
              const on = entry.enabled && !skippedNow;
              const badge = plugin ? { cls: 'badge-plugin', text: '插件' } : badgeFor(prompt);
              const open = () => {
                if (!prompt) return;
                if (plugin) onOpenPlugin(entry.identifier);
                else openBlock(entry.identifier);
              };
              const key = `${entry.identifier}:${i}`;
              const label =
                prompt?.marker && MARKER_LABELS[entry.identifier]
                  ? MARKER_LABELS[entry.identifier]
                  : prompt?.name ?? entry.identifier;
              // 注释不发出去,自然也不该计进 token
              const tokens =
                prompt && !prompt.marker && !skippedNow ? estimateTokens(stripComments(prompt.content)) : 0;

              return (
                <div
                  key={key}
                  className={`block-row ${on ? 'on' : 'off'}${skippedNow ? ' skip' : ''}${plugin ? ' plugin' : ''}${
                    selectedIdentifier === entry.identifier ? ' selected' : ''
                  }${
                    dragFrom === i ? ' dragging' : ''
                  }${
                    dropAt?.index === i ? (dropAt.before ? ' drop-before' : ' drop-after') : ''
                  }`}
                  draggable={dragArmed === key}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    dragFromRef.current = i;
                    setDragFrom(i);
                  }}
                  onDragOver={(e) => {
                    if (dragFromRef.current === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const r = e.currentTarget.getBoundingClientRect();
                    setDrop({ index: i, before: e.clientY < r.top + r.height / 2 });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    finishDrop();
                  }}
                  onDragEnd={endDrag}
                >
                  <div
                    className="block-head"
                    onClick={open}
                    title={
                      plugin
                        ? '插件块:正文由插件的提示词模板决定,点击去插件里改'
                        : prompt
                          ? '点击打开编辑 / 预览'
                          : undefined
                    }
                  >
                    <span
                      className="block-grip"
                      title="拖动排序"
                      onMouseDown={() => setDragArmed(key)}
                      onMouseUp={endDrag}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse') return; // 桌面走上面的 HTML5 DnD
                        e.preventDefault(); // 挡兼容鼠标事件 —— 不然 touch 也会 arm 桌面拖拽
                        // 抓住指针:手指滑出把手后 move/up 还回到这里。
                        // 合成事件(测试)没有活动指针会抛,真机不会
                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch {
                          /* 没有可抓的活动指针就裸跑 */
                        }
                        touchDrag.current = { pointerId: e.pointerId };
                        dragFromRef.current = i;
                        setDragFrom(i);
                        pointerY.current = e.clientY;
                        scrollRaf.current = requestAnimationFrame(touchScrollLoop);
                      }}
                      onPointerMove={(e) => {
                        if (touchDrag.current?.pointerId !== e.pointerId) return;
                        pointerY.current = e.clientY;
                        updateTouchDrop(e.clientY);
                      }}
                      onPointerUp={(e) => {
                        if (touchDrag.current?.pointerId !== e.pointerId) return;
                        finishDrop();
                      }}
                      onPointerCancel={(e) => {
                        if (touchDrag.current?.pointerId !== e.pointerId) return;
                        endDrag();
                      }}
                    >
                      ⠿
                    </span>
                    <span className="block-name" title={label}>
                      {plugin ? pluginLabel(label) : label}
                    </span>
                    {plugin && entry.identifier === PLAYER_BLOCK_ID && <Tip k="no_user_block" />}
                    <span className={`block-badge ${badge.cls}`}>{badge.text}</span>
                    {state && <SendChip badge={state} />}

                    {prompt && !prompt.marker && prompt.injectionPosition === 1 && (
                      <span
                        className="block-badge badge-depth"
                        title={`绝对深度:插进聊天记录里倒数第 ${prompt.injectionDepth} 条之前,不按这里的顺序排`}
                      >
                        @{prompt.injectionDepth}
                      </span>
                    )}

                    {/* 覆盖是一直开着且静默的 —— 一张带 system_prompt 的卡会直接
                        顶掉你的 main 块,不标出来根本发现不了 */}
                    {overridden.has(entry.identifier) && (
                      <span
                        className="block-badge badge-override"
                        title="角色卡自带的字顶替了这一块的正文;在块详情里勾「禁止角色卡覆盖」可挡掉"
                      >
                        被卡覆盖
                      </span>
                    )}

                    {/* 整行都能点开;✎ 只是给「这里能改」一个显眼的记号。marker 也能开 —— 至少能改显示名 */}
                    {prompt && (
                      <button
                        className="icon-btn tiny"
                        onClick={(e) => {
                          e.stopPropagation();
                          open();
                        }}
                        title={plugin ? '去插件里改这一块' : '编辑 / 预览这一块'}
                      >
                        {plugin ? <AnimaIcon name="plugin" size={12} /> : '✎'}
                      </button>
                    )}

                    <button
                      className={`block-toggle${entry.enabled ? ' on' : ''}${skippedNow ? ' muted' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleBlock(entry.identifier);
                      }}
                      disabled={skippedNow}
                      title={
                        skippedNow
                          ? '这次不发,原因见旁边的问号;预设里的开关不变'
                          : entry.enabled
                            ? '关闭这一块'
                            : '启用这一块'
                      }
                    >
                      <span className="knob" />
                    </button>

                    <span className="block-tokens">{tokens ? formatTokens(tokens) : '—'}</span>
                  </div>
                </div>
              );
            })()])}
            {autoRowsBefore(null)}
          </div>
        </>
      )}

      {detailPrompt && (
        <BlockEditorModal
          prompt={detailPrompt}
          overridden={overridden.has(detailPrompt.identifier)}
          markerSource={detailPrompt.marker ? resolveMarker(detailPrompt.identifier) : null}
          macros={macros}
          onCancel={() => setDetailOf(null)}
          onSave={(patch) => {
            onUpdateBlock(detailPrompt.identifier, patch);
            setDetailOf(null);
          }}
          onSaveCard={(patch) => {
            onUpdateCard(patch);
            setDetailOf(null);
          }}
          onDelete={() => {
            onDeleteBlock(detailPrompt.identifier);
            setDetailOf(null);
          }}
        />
      )}
    </div>
  );
}
