/**
 * 历史页:一句一行的纸面列表(设计稿 kit/scene.js 的 AV.menuHistory,照星海的历史页)。
 * 菜单里的「历史」和游戏右上「历史」开的小窗口是同一份。
 *
 * - 一句一行:说话人名(她的名字用角色色)+ 台词;旁白没有名字;你说的话一行;日语小字在中文上方(字幕开着时)
 * - 每句右边:原文 · 重听 / 重新生成(要念的句子)· 回到这里
 * - 「显示原文」= 模型回来的原文(一个字不删,标签和宏露成浅色小字):点一下就地改,保存后从第一处改过的那句开始播
 * - 打开时停在最新那句;只先排最近几条回复,往上翻再接着载入;屏幕外的回复不排版(content-visibility)
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { currentText, type ChatEntry } from '../../lib/chatEntry';
import { substituteMacros, type MacroContext } from '../../lib/macros';
import type { TagKind } from '../script';
import { DEFAULT_AVATAR } from '../fallbacks';
import { stripTags } from '../tags';
import { VoiceButtons } from '../VoiceButtons';
import { FaceCrop } from '../ui/FaceCrop';
import { usePhone } from '../settings/usePhone';
import {
  FIRST_ENTRIES,
  MORE_ENTRIES,
  editNote,
  entryRows,
  firstChanged,
  rawSegments,
  revoiceCount,
  type HistoryData,
  type HistoryRow,
  type LogLines,
  type RowOptions,
} from './logic';
import '../ui/ui.css';
import './history.css';

/** 用户自己动了滚动:贴底的那几帧就撒手 */
const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
/** 离顶多近就接着载入更早的 */
const LOAD_NEAR = 320;

function Ic({ d, size = 17 }: { d: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d}
    </svg>
  );
}
// 线条图标照设计稿 kit/icons.js:回到这里(return)、原文(文 / A 对照)、改(笔)
const ICON_BACK = (
  <>
    <path d="M9 5.5 4.5 10 9 14.5" />
    <path d="M5 10h9.5a5 5 0 0 1 0 10H11" />
  </>
);
const ICON_RAW = (
  <>
    <path d="M4 6h8M8 4v2" />
    <path d="M5.5 6c.5 3 2.6 5.3 5.5 6.5M10.5 6c-.6 3.2-2.6 5.7-6 7" />
    <path d="M12.5 20l3.5-8 3.5 8M13.8 17h4.4" />
  </>
);
const ICON_EDIT = (
  <>
    <path d="M15.5 5.5l3 3L9 18H6v-3z" />
    <path d="M13.5 7.5l3 3" />
  </>
);

export interface VNHistoryProps {
  entries: ChatEntry[];
  /** 当前对话。换了(读档、新故事)就重新停在最底下 */
  chatKey: string | null;
  loading: boolean;
  /** 「显示原文」 */
  raw: boolean;
  data: HistoryData;
  tagKinds: readonly TagKind[];
  macros: MacroContext;
  charName: string;
  userName: string;
  charAvatar?: string | null;
  /** 在生成回复:原文先不给改 */
  sending: boolean;
  /** 回到这一句:关掉菜单 / 小窗口,游戏翻回去 */
  onJump: (entryId: string, line: number) => void;
  /** 改了某条回复的原文(存进这条回复当前分支) */
  onEdit: (entryId: string, text: string) => void;
  /**
   * 游戏里对着台词右键 / 长按「改原文」打开的:一打开这条回复就已经在改(设计稿 AV.menuHistory 的 edit)。
   * 只在打开(或换了对话)那一下看它
   */
  editFirst?: string | null;
  /** editFirst 那条保存完了(一个字没改也算;改过的等新句子回来、跳过去以后才给):外面关窗口回游戏 */
  onEditDone?: () => void;
}

interface Editing {
  id: string;
  draft: string;
  caret: number | null;
  err: string;
}

/** 「改原文」进来的那条:还在、是她的回复、写完了、没在等回复才能改;改不了就 null(照常停在最底下) */
function firstEdit(entries: readonly ChatEntry[], id: string | null | undefined, sending: boolean): { at: number; ed: Editing } | null {
  const at = id ? entries.findIndex((e) => e.id === id) : -1;
  const e = at >= 0 ? entries[at] : null;
  if (!e || e.role === 'user' || e.streaming || sending) return null;
  return { at, ed: { id: e.id, draft: currentText(e), caret: null, err: '' } };
}

export function VNHistory(p: VNHistoryProps) {
  const { entries, data, onJump } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  // 手机上没有悬停(设计稿 phone.css 的 .pf-hist):点一句才出 原文 / 重听 / 回到这里,再点收起;头像 34
  const phone = usePhone();
  const avSize = phone ? 34 : 40;
  const [openRow, setOpenRow] = useState<string | null>(null);
  const tapRow = (key: string) => (e: MouseEvent) => {
    if (!phone) return;
    if ((e.target as Element).closest('button, textarea, input, a, .vh-raw')) return;
    setOpenRow((k) => (k === key ? null : key));
  };
  const openCls = (key: string) => (phone && openRow === key ? ' open' : '');
  // 一打开就在改的那条(游戏里「改原文」进来的):第一帧就是打字框,不闪一下列表
  const [opening] = useState(() => firstEdit(entries, p.editFirst, p.sending));
  const [count, setCount] = useState(opening ? Math.max(FIRST_ENTRIES, entries.length - opening.at) : FIRST_ENTRIES);
  const [one, setOne] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing | null>(opening?.ed ?? null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const editingRef = useRef(editing);
  editingRef.current = editing;
  /** 存了但新的句子还没回来:回来以后比对,从第一处改过的那句开始播 */
  const pending = useRef<{ id: string; text: string; old: LogLines | null; fromGame: boolean } | null>(null);
  const atBottom = useRef(true);
  const anchor = useRef<{ id: string; off: number } | null>(null);
  const grow = useRef<{ h: number } | null>(null);

  const start = Math.max(0, entries.length - count);
  const hasEntries = entries.length > 0;

  // ---- 打开(或换了对话)时停在最新那句 ----
  // 屏幕外的回复按估计高度占位、不排版,滚到底以后底部才排出真的高度:接着几帧继续贴底,
  // 高度连着两帧不变就停;用户自己动了滚轮 / 键盘 / 手指就撒手
  // 「改原文」进来的:那条已经是打字框,停在它上面(长的顶头对齐,短的放在下半截,上面还看得到前文)
  const editFirst = useRef(p.editFirst ?? null);
  editFirst.current = p.editFirst ?? null;
  useLayoutEffect(() => {
    const first = firstEdit(entries, editFirst.current, p.sending);
    setCount(first ? Math.max(FIRST_ENTRIES, entries.length - first.at) : FIRST_ENTRIES);
    setOne(new Set());
    // 同一条已经在改(第一帧给的)就别重新给,打了的字留着
    setEditing((cur) => (first ? (cur?.id === first.ed.id ? cur : first.ed) : null));
    atBottom.current = !first;
    const el = scrollRef.current;
    if (!el || !hasEntries) return;
    const target = () => {
      const ed = el.querySelector<HTMLElement>('.vh-ln.editing');
      if (!ed) return el.scrollHeight;
      const h = ed.offsetHeight;
      const y = ed.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      return Math.max(0, y - (h > el.clientHeight * 0.6 ? 12 : el.clientHeight * 0.35));
    };
    el.scrollTop = target();
    let raf = 0;
    let last = -1;
    let still = 0;
    let frames = 0;
    let user = false;
    const stop = () => {
      user = true;
    };
    const pin = () => {
      if (user) return;
      const h = el.scrollHeight;
      el.scrollTop = target();
      still = h === last ? still + 1 : 0;
      last = h;
      if (still < 2 && ++frames < 60) raf = requestAnimationFrame(pin);
    };
    for (const t of USER_EVENTS) el.addEventListener(t, stop, { passive: true });
    raf = requestAnimationFrame(pin);
    return () => {
      cancelAnimationFrame(raf);
      for (const t of USER_EVENTS) el.removeEventListener(t, stop);
    };
    // 只在打开 / 换对话时摆一次;entries / sending 是那一刻的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.chatKey, hasEntries]);

  // ---- 往上翻:离顶近了就接着放出更早的;放出来以后把差值补回 scrollTop,视野不往上跳 ----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (grow.current && el) el.scrollTop += el.scrollHeight - grow.current.h;
    grow.current = null;
  }, [count]);
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (el.scrollTop < LOAD_NEAR && startRef.current > 0 && !grow.current) {
        grow.current = { h: el.scrollHeight };
        setCount((c) => c + MORE_ENTRIES);
      }
      // 记下看着的是哪一条、离顶多远:换「显示原文」整页重排时摁回原处
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          const top = el.getBoundingClientRect().top;
          for (const s of el.querySelectorAll<HTMLElement>('.vh-entry')) {
            const r = s.getBoundingClientRect();
            if (r.bottom > top + 8) {
              anchor.current = { id: s.dataset.id ?? '', off: r.top - top };
              return;
            }
          }
        });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 「显示原文」开关:整页重排,看着的那条别跑(贴着底的就继续贴底)
  const firstRaw = useRef(true);
  useLayoutEffect(() => {
    if (firstRaw.current) {
      firstRaw.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    setOne(new Set());
    const a = anchor.current;
    if (atBottom.current || !a) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const s = [...el.querySelectorAll<HTMLElement>('.vh-entry')].find((x) => x.dataset.id === a.id);
    if (s) el.scrollTop += s.getBoundingClientRect().top - el.getBoundingClientRect().top - a.off;
  }, [p.raw]);

  // 贴着底时,新来的回复 / 流式新字跟着滚
  const last = entries[entries.length - 1];
  const lastLen = last ? currentText(last).length : 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, lastLen]);

  // ---- 改原文 ----
  const entryOf = (id: string) => entries.find((e) => e.id === id);
  const startEdit = (id: string, caret: number | null) => {
    const e = entryOf(id);
    if (!e || e.streaming || p.sending) return;
    setEditing({ id, draft: currentText(e), caret, err: '' });
  };
  const cancelEdit = () => setEditing(null);
  const saveEdit = () => {
    const ed = editingRef.current;
    if (!ed) return;
    const e = entryOf(ed.id);
    if (!e) return setEditing(null);
    const fromGame = ed.id === editFirst.current;
    // 一个字没动就点了保存:不算改过(从游戏「改原文」进来的照样关窗口回游戏,停在原来那句)
    if (ed.draft === currentText(e)) {
      setEditing(null);
      if (fromGame) p.onEditDone?.();
      return;
    }
    if (!ed.draft.trim()) return setEditing({ ...ed, err: '回复不能是空的' });
    pending.current = { id: ed.id, text: ed.draft, old: data.of(e), fromGame };
    setEditing(null);
    p.onEdit(ed.id, ed.draft);
  };
  // 存下去的回复回来了(entries 换了新的):从第一处改过的那句开始播;句子没变(只动了写法)就留在列表里写一行「改过」
  const latest = useRef({ data, onJump, onEditDone: p.onEditDone });
  latest.current = { data, onJump, onEditDone: p.onEditDone };
  useEffect(() => {
    const pd = pending.current;
    if (!pd) return;
    const e = entries.find((x) => x.id === pd.id);
    if (!e || currentText(e) !== pd.text) return;
    pending.current = null;
    const nu = latest.current.data.of(e);
    const first = firstChanged(pd.old, nu);
    setNotes((s) => ({ ...s, [pd.id]: editNote(revoiceCount(pd.old, nu)) }));
    if (first >= 0) latest.current.onJump(pd.id, first);
    if (pd.fromGame) latest.current.onEditDone?.();
  }, [entries]);
  // 小窗口里按 Esc:在改原文就先退出编辑(PopWindow 在捕获阶段接 Esc,先问这里)
  const escRef = data.esc;
  useEffect(() => {
    escRef.current = () => {
      if (!editingRef.current) return false;
      setEditing(null);
      return true;
    };
    return () => {
      escRef.current = null;
    };
  }, [escRef]);

  // 改的那条放进视野里
  const editId = editing?.id ?? null;
  useEffect(() => {
    if (!editId) return;
    const s = [...(scrollRef.current?.querySelectorAll<HTMLElement>('.vh-ln.editing') ?? [])][0];
    s?.scrollIntoView({ block: 'nearest' });
  }, [editId]);

  // ---- 行 ----
  const rowOpts: RowOptions = {
    raw: p.raw,
    one,
    editingId: editId,
    data,
    sending: p.sending,
    expand: (e) => substituteMacros(currentText(e), p.macros, { seed: `${e.id}:${e.swipeIndex}` }),
    plain: (shown) => stripTags(shown, p.tagKinds),
  };
  const toggleOne = (id: string) =>
    setOne((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const avatar = (kind: 'char' | 'user' | 'narr', name: string | null, at?: { id: string; line: number }): ReactNode => {
    if (kind === 'narr') return <span className="vh-dia" aria-hidden="true" />;
    // 她的台词:那一句的表情差分按脸裁(设计稿 AV.menuHistory)
    const f = kind === 'char' && at && name === p.charName ? data.face?.(at.id, at.line) : null;
    if (f) return <FaceCrop src={f.src} face={f.face ?? undefined} aspect={f.aspect} size={avSize} />;
    if (kind === 'char' && p.charAvatar && p.charAvatar !== DEFAULT_AVATAR && name === p.charName) {
      return <img className="vh-face" src={p.charAvatar} alt="" draggable={false} />;
    }
    return (
      <span className={`vh-stamp${kind === 'user' ? ' me' : ''}`} aria-hidden="true">
        {(name ?? '').trim().slice(0, 1)}
      </span>
    );
  };

  const rawBtn = (id: string): ReactNode => (
    <button
      type="button"
      className="vh-act raw"
      aria-pressed={false}
      aria-label="看这条回复的原文"
      title="看这条回复的原文(模型回来的样子)"
      onClick={() => toggleOne(id)}
    >
      <Ic d={ICON_RAW} />
    </button>
  );
  const backBtn = (id: string, line: number): ReactNode => (
    <button type="button" className="vh-act back" title="回到这一句(关上这里,游戏翻回这一句)" onClick={() => onJump(id, line)}>
      <Ic d={ICON_BACK} size={15} />
      <span>回到这里</span>
    </button>
  );

  const renderRow = (row: HistoryRow): ReactNode => {
    switch (row.kind) {
      case 'user':
        return (
          <div key={row.key} className="vh-ln user">
            <span className="vh-av">{avatar('user', p.userName)}</span>
            <div className="vh-tx">
              <div className="vh-who">{p.userName}</div>
              <p className="vh-zh">{row.text}</p>
            </div>
          </div>
        );
      case 'line': {
        const kind = row.role === 'narr' ? 'narr' : row.role === 'player' ? 'user' : 'char';
        return (
          <div key={row.key} className={`vh-ln ${row.role}${row.current ? ' cur' : ''}${openCls(row.key)}`} onClick={tapRow(row.key)}>
            <span className="vh-av">{avatar(kind, row.speaker, { id: row.entryId, line: row.line })}</span>
            <div className="vh-tx">
              {row.role !== 'narr' && (
                <div className="vh-who">
                  {row.speaker}
                  {row.current && <em>现在</em>}
                </div>
              )}
              {row.ja && <p className="vh-ja">{row.ja}</p>}
              <p className="vh-zh">{row.text}</p>
            </div>
            <div className="vh-acts">
              {rawBtn(row.entryId)}
              {row.plan && <VoiceButtons req={row.plan} className="vh-vo" />}
              {backBtn(row.entryId, row.line)}
            </div>
          </div>
        );
      }
      case 'plain':
        return (
          <div key={row.key} className={`vh-ln char${row.current ? ' cur' : ''}${openCls(row.key)}`} onClick={tapRow(row.key)}>
            <span className="vh-av">{avatar('char', p.charName, { id: row.entryId, line: 0 })}</span>
            <div className="vh-tx">
              <div className="vh-who">
                {p.charName}
                {row.current && <em>现在</em>}
              </div>
              <p className="vh-zh">{row.text}</p>
            </div>
            <div className="vh-acts">{backBtn(row.entryId, 0)}</div>
          </div>
        );
      case 'reply': {
        const ed = editing?.id === row.entryId ? editing : null;
        const note = notes[row.entryId];
        const e = entryOf(row.entryId);
        return (
          <div
            key={row.key}
            className={`vh-ln reply${row.current ? ' cur' : ''}${ed ? ' editing' : ''}${openCls(row.key)}`}
            onClick={tapRow(row.key)}
          >
            <span className="vh-av">{avatar('char', p.charName, { id: row.entryId, line: 0 })}</span>
            <div className="vh-tx">
              <div className="vh-who">
                {p.charName}
                {row.current && <em>现在</em>}
              </div>
              {ed ? (
                <EditBox ed={ed} onChange={(d) => setEditing({ ...ed, draft: d, err: '' })} onSave={saveEdit} onCancel={cancelEdit} />
              ) : (
                <RawBlock
                  text={row.raw}
                  kinds={p.tagKinds}
                  editable={row.editable}
                  onEdit={(caret) => startEdit(row.entryId, caret)}
                />
              )}
              {note && !ed && <p className="vh-note">{note}</p>}
              {e && e.streaming && <p className="vh-note">还在生成,写完才能改</p>}
            </div>
            <div className="vh-acts">
              {!p.raw && (
                <button
                  type="button"
                  className="vh-act raw on"
                  aria-pressed={true}
                  aria-label="收起原文"
                  title="收起原文,看拆好的句子"
                  onClick={() => {
                    if (ed) setEditing(null);
                    toggleOne(row.entryId);
                  }}
                >
                  <Ic d={ICON_RAW} />
                </button>
              )}
              {!ed && row.editable && (
                <button
                  type="button"
                  className="vh-act ed"
                  aria-label="改原文"
                  title="改原文(只改这一条)"
                  onClick={() => startEdit(row.entryId, null)}
                >
                  <Ic d={ICON_EDIT} />
                </button>
              )}
              {backBtn(row.entryId, 0)}
            </div>
          </div>
        );
      }
    }
  };

  const blocks = entries.slice(start);

  return (
    <div className="vh">
      <div className="vh-scroll av-scroll" ref={scrollRef}>
        <div className="vh-list">
          {p.loading && !hasEntries && <div className="vh-empty">读取对话……</div>}
          {!p.loading && !hasEntries && <div className="vh-empty">还没有对话</div>}
          {start > 0 && <div className="vh-top">往上翻,更早的会接着载入</div>}
          {blocks.map((e, i) => {
            const rows = entryRows(e, rowOpts);
            if (rows.length === 0) return null;
            return (
              <section key={e.id} className={`vh-entry${i >= blocks.length - 6 ? ' near' : ''}`} data-id={e.id}>
                {rows.map(renderRow)}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 一条回复的原文:一整块,标签和宏是浅色小字;点一下(或回车)就地变成打字框 */
function RawBlock({
  text,
  kinds,
  editable,
  onEdit,
}: {
  text: string;
  kinds: readonly TagKind[];
  editable: boolean;
  onEdit: (caret: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const segs = useMemo(() => rawSegments(text, kinds), [text, kinds]);
  const caretAt = (ev: React.MouseEvent): number | null => {
    const block = ref.current;
    const r = document.caretRangeFromPoint?.(ev.clientX, ev.clientY);
    if (!block || !r || !block.contains(r.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  };
  return (
    <div
      ref={ref}
      className={`vh-raw${editable ? ' can' : ''}`}
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? '这条回复的原文,点一下改' : undefined}
      onClick={editable ? (e) => onEdit(caretAt(e)) : undefined}
      onKeyDown={
        editable
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onEdit(null);
            }
          : undefined
      }
    >
      {segs.map((s, i) =>
        s.mark ? (
          <span key={i} className="vh-tag">
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </div>
  );
}

/** 在改的那条:一个框,上面打字,下面一排 保存 / 取消;Esc 取消、Ctrl + 回车保存 */
function EditBox({
  ed,
  onChange,
  onSave,
  onCancel,
}: {
  ed: Editing;
  onChange: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  // 高度跟着字长,不出滚动条
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [ed.draft]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const c = ed.caret ?? el.value.length;
    el.setSelectionRange(c, c);
    // 只在刚打开时放光标
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="vh-ebox">
      <textarea
        ref={ta}
        className="vh-edit"
        spellCheck={false}
        aria-label="改这条回复的原文"
        value={ed.draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            // 先只是退出编辑:别让菜单跟着关
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSave();
          }
        }}
      />
      <div className="vh-eacts">
        <button type="button" className="av-btn sm primary" onClick={onSave}>
          保存
        </button>
        <button type="button" className="av-btn sm" onClick={onCancel}>
          取消
          <kbd className="av-kbd">Esc</kbd>
        </button>
        {ed.err && (
          <span className="vh-eerr" role="alert">
            {ed.err}
          </span>
        )}
      </div>
    </div>
  );
}
