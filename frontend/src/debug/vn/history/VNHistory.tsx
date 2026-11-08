/**
 * 历史页(10-30 改版,设计稿 docs/superpowers/specs/2026-10-30-history-redesign.md)。
 * 菜单里的「历史」(纸面大面板)和游戏右上「历史」(透着游戏画面铺满,PopWindow full)是同一份。
 *
 * - 一条消息一块,像调试台 / 酒馆:头像(卡面头像 / 玩家头像)和名字只在开头一次,下面是这条的所有句子
 * - 她的回复里:她的台词不再写名字;别人的台词写名字;AI 替你写的那句写你的名字 + 「AI 写的」;旁白字浅一点
 * - 最后一条回复有几版时,名字后面 ‹ 2/3 › 换版本(游戏跟着从那一版第一句开始播)
 * - 每句右边:原文 · 重听 / 重新生成(要念的句子)· 回到这里
 * - 「显示原文」= 模型回来的原文(一个字不删,标签和宏露成浅色小字):点一下就地改,保存后从第一处改过的那句开始播
 * - 打开时「现在」那句放在正中间(它后面还没播到的句子变淡);现在就是最后一句时贴底
 * - 换背景的地方插一条横幅;CG 从出现到收起左边一条竖线,开头一张小图,点开看大图
 * - 只先排最近几条回复(至少排到「现在」那条),往上翻再接着载入;屏幕外的回复不排版(content-visibility)
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { currentText, type ChatEntry } from '../../lib/chatEntry';
import { substituteMacros, type MacroContext } from '../../lib/macros';
import type { TagKind } from '../script';
import { DEFAULT_AVATAR } from '../fallbacks';
import { stripTags } from '../tags';
import { VoiceButtons } from '../VoiceButtons';
import { GameIcon } from '../ui/GameIcon';
import { usePhone } from '../settings/usePhone';
import {
  FIRST_ENTRIES,
  MORE_ENTRIES,
  editNote,
  firstChanged,
  historyBlocks,
  rawSegments,
  revoiceCount,
  type BlockItem,
  type HistoryData,
  type HistoryRow,
  type LogLines,
  type Rail,
  type RowOptions,
} from './logic';
import '../ui/ui.css';
import './history.css';

/** 用户自己动了滚动:贴底的那几帧就撒手 */
const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
/** 离顶多近就接着载入更早的 */
const LOAD_NEAR = 320;
/** 打开时至少从「现在」那条往上再多排几条,上面有前文 */
const ABOVE_NOW = 3;

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
  /** 当前对话。换了(读档、新故事)就重新停在「现在」那句 */
  chatKey: string | null;
  loading: boolean;
  /** 「显示原文」 */
  raw: boolean;
  data: HistoryData;
  tagKinds: readonly TagKind[];
  macros: MacroContext;
  charName: string;
  userName: string;
  /** 她的头像:卡面头像(和调试台一样) */
  charAvatar?: string | null;
  /** 你的头像:玩家人设的头像(和调试台一样);没有就是名字章 */
  userAvatar?: string | null;
  /** 在生成回复:原文先不给改、版本先不给换 */
  sending: boolean;
  /** 回到这一句:关掉菜单 / 小窗口,游戏翻回去 */
  onJump: (entryId: string, line: number) => void;
  /** 改了某条回复的原文(存进这条回复当前分支) */
  onEdit: (entryId: string, text: string) => void;
  /** 换最后一条回复的版本;不给就不显示 ‹ › */
  onSwipe?: (dir: 'left' | 'right') => void;
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

/** 「改原文」进来的那条:还在、是她的回复、写完了、没在等回复才能改;改不了就 null(照常停在「现在」那句) */
function firstEdit(entries: readonly ChatEntry[], id: string | null | undefined, sending: boolean): { at: number; ed: Editing } | null {
  const at = id ? entries.findIndex((e) => e.id === id) : -1;
  const e = at >= 0 ? entries[at] : null;
  if (!e || e.role === 'user' || e.streaming || sending) return null;
  return { at, ed: { id: e.id, draft: currentText(e), caret: null, err: '' } };
}

/** 一打开要排多少条:改原文那条、「现在」那条(再往上几条)都要排进来 */
function openCount(entries: readonly ChatEntry[], editAt: number | null, nowAt: number): number {
  let n = FIRST_ENTRIES;
  if (editAt !== null) n = Math.max(n, entries.length - editAt);
  if (nowAt >= 0) n = Math.max(n, entries.length - nowAt + ABOVE_NOW);
  return n;
}

const railCls = (r: Rail) => (r.on ? ` rail${r.start ? ' rs' : ''}${r.end ? ' re' : ''}` : '');

export function VNHistory(p: VNHistoryProps) {
  const { entries, data, onJump } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  // 手机上没有悬停(设计稿 phone.css 的 .pf-hist):点一句才出 原文 / 重听 / 回到这里,再点收起
  const phone = usePhone();
  const [openRow, setOpenRow] = useState<string | null>(null);
  const tapRow = (key: string) => (e: MouseEvent) => {
    if (!phone) return;
    if ((e.target as Element).closest('button, textarea, input, a, .vh-raw')) return;
    setOpenRow((k) => (k === key ? null : key));
  };
  const openCls = (key: string) => (phone && openRow === key ? ' open' : '');
  const nowAt = data.at ? entries.findIndex((e) => e.id === data.at?.entryId) : -1;
  // 一打开就在改的那条(游戏里「改原文」进来的):第一帧就是打字框,不闪一下列表
  const [opening] = useState(() => firstEdit(entries, p.editFirst, p.sending));
  const [count, setCount] = useState(() => openCount(entries, opening?.at ?? null, nowAt));
  const [one, setOne] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing | null>(opening?.ed ?? null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** 点开看大图的 CG */
  const [big, setBig] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const bigRef = useRef(big);
  bigRef.current = big;
  /** 存了但新的句子还没回来:回来以后比对,从第一处改过的那句开始播 */
  const pending = useRef<{ id: string; text: string; old: LogLines | null; fromGame: boolean } | null>(null);
  const atBottom = useRef(true);
  const anchor = useRef<{ id: string; off: number } | null>(null);
  const grow = useRef<{ h: number } | null>(null);

  const start = Math.max(0, entries.length - count);
  const hasEntries = entries.length > 0;

  // ---- 打开(或换了对话)时停在「现在」那句 ----
  // 「现在」那句放在正中间;它后面没有还没播的句子(就是最后一句)时贴底。
  // 屏幕外的回复按估计高度占位、不排版,滚过去以后才排出真的高度:接着几帧继续摆,
  // 高度连着两帧不变就停;用户自己动了滚轮 / 键盘 / 手指就撒手
  // 「改原文」进来的:那条已经是打字框,停在它上面(长的顶头对齐,短的放在下半截,上面还看得到前文)
  const editFirst = useRef(p.editFirst ?? null);
  editFirst.current = p.editFirst ?? null;
  useLayoutEffect(() => {
    const first = firstEdit(entries, editFirst.current, p.sending);
    setCount(openCount(entries, first?.at ?? null, nowAt));
    setOne(new Set());
    // 同一条已经在改(第一帧给的)就别重新给,打了的字留着
    setEditing((cur) => (first ? (cur?.id === first.ed.id ? cur : first.ed) : null));
    atBottom.current = !first;
    const el = scrollRef.current;
    if (!el || !hasEntries) return;
    const yOf = (x: HTMLElement) => x.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    const target = () => {
      const ed = el.querySelector<HTMLElement>('.vh-ln.editing');
      if (ed) {
        const h = ed.offsetHeight;
        return Math.max(0, yOf(ed) - (h > el.clientHeight * 0.6 ? 12 : el.clientHeight * 0.35));
      }
      const cur = el.querySelector<HTMLElement>('.vh-ln.cur');
      if (!cur || !el.querySelector('.vh-ln.later')) return el.scrollHeight;
      return Math.max(0, yOf(cur) - (el.clientHeight - cur.offsetHeight) / 2);
    };
    el.scrollTop = target();
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
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
    // 只在打开 / 换对话时摆一次;entries / sending / nowAt 是那一刻的
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
  // 小窗口里按 Esc:开着大图先关大图,在改原文就先退出编辑(PopWindow 在捕获阶段接 Esc,先问这里)
  const escRef = data.esc;
  useEffect(() => {
    escRef.current = () => {
      if (bigRef.current) {
        setBig(null);
        return true;
      }
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

  /** 一条消息开头的头像:她 = 卡面头像,你 = 玩家头像(和调试台一样);没有图就是名字第一个字 */
  const avatar = (user: boolean): ReactNode => {
    const src = user ? p.userAvatar : p.charAvatar;
    if (src && src !== DEFAULT_AVATAR) return <img className="vh-face" src={src} alt="" draggable={false} />;
    return (
      <span className={`vh-stamp${user ? ' me' : ''}`} aria-hidden="true">
        {(user ? p.userName : p.charName).trim().slice(0, 1)}
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
  const now = <em className="vh-now">现在</em>;

  const renderRow = (row: HistoryRow, rail: Rail, later: boolean): ReactNode => {
    const base = `vh-ln${railCls(rail)}${later ? ' later' : ''}`;
    const railEl = <span className="vh-rail" aria-hidden="true" />;
    switch (row.kind) {
      case 'user':
        return (
          <div key={row.key} className={`${base} user`}>
            {railEl}
            <div className="vh-tx">
              <p className="vh-zh">{row.text}</p>
            </div>
          </div>
        );
      case 'line': {
        // 她自己的台词:名字在开头写过了;别人的台词写名字;AI 替你写的写你的名字 + 「AI 写的」
        const who =
          row.role === 'player' ? (
            <div className="vh-who me">
              {row.speaker}
              <span className="vh-ai" title="这句是 AI 在回复里替你写的,不是你打的">
                AI 写的
              </span>
            </div>
          ) : row.role === 'char' && row.speaker !== p.charName ? (
            <div className="vh-who">{row.speaker}</div>
          ) : null;
        return (
          <div key={row.key} className={`${base} ${row.role}${row.current ? ' cur' : ''}${openCls(row.key)}`} onClick={tapRow(row.key)}>
            {railEl}
            <div className="vh-tx">
              {who}
              {row.ja && <p className="vh-ja">{row.ja}</p>}
              <p className="vh-zh">
                {row.text}
                {row.current && now}
              </p>
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
          <div key={row.key} className={`${base} char${row.current ? ' cur' : ''}${openCls(row.key)}`} onClick={tapRow(row.key)}>
            {railEl}
            <div className="vh-tx">
              <p className="vh-zh">
                {row.text}
                {row.current && now}
              </p>
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
            className={`${base} reply${row.current ? ' cur' : ''}${ed ? ' editing' : ''}${openCls(row.key)}`}
            onClick={tapRow(row.key)}
          >
            {railEl}
            <div className="vh-tx">
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

  const shown = entries.slice(start);
  const blocks = historyBlocks(shown, start, nowAt, rowOpts);
  const lastId = last?.id;

  const renderItem = (it: BlockItem, entry: ChatEntry, user: boolean): ReactNode => {
    switch (it.t) {
      case 'scene':
        return (
          <div key={it.key} className={`vh-scene${railCls(it.rail)}${it.later ? ' later' : ''}`}>
            <span className="vh-rail" aria-hidden="true" />
            <div className="vh-scene-strip">
              {it.bg.src && (
                <img src={it.bg.src} alt="" draggable={false} style={{ objectPosition: `${it.bg.focus}% 50%` }} />
              )}
              <span className="vh-scene-name">{it.bg.label}</span>
            </div>
          </div>
        );
      case 'cg': {
        // 小图不占行:贴在下面那句左边那一栏,线从那句起
        const what = it.cg.ai ? 'AI 生图' : 'CG';
        return (
          <div key={it.key} className={`vh-cg${it.alone ? ' alone' : ''}${it.later ? ' later' : ''}`}>
            {it.cg.thumb && (
              <button
                type="button"
                className="vh-cg-shot"
                title={`${what}${it.span > 0 ? ` · 显示 ${it.span} 句` : ''}(点开看大图)`}
                onClick={() => setBig(it.cg.full ?? it.cg.thumb)}
              >
                <img src={it.cg.thumb} alt={what} draggable={false} />
              </button>
            )}
          </div>
        );
      }
      case 'head': {
        const versions = !user && entry.id === lastId && entry.swipes.length > 1 && p.onSwipe;
        return (
          <div key={it.key} className={`vh-head${railCls(it.rail)}`}>
            <span className="vh-rail" aria-hidden="true" />
            <span className="vh-av">{avatar(user)}</span>
            <div className="vh-name">
              <span className={`vh-nm${user ? ' me' : ''}`}>{user ? p.userName : p.charName}</span>
              {versions && (
                <span className="vh-ver" role="group" aria-label="换版本">
                  <button type="button" disabled={p.sending} onClick={() => p.onSwipe?.('left')} aria-label="上一版" title="上一版">
                    <GameIcon name="left" size={15} />
                  </button>
                  <span className="n">
                    {entry.swipeIndex + 1} / {entry.swipes.length}
                  </span>
                  <button
                    type="button"
                    disabled={p.sending}
                    onClick={() => p.onSwipe?.('right')}
                    aria-label="下一版"
                    title="下一版(最后一版再往右 = 重来)"
                  >
                    <GameIcon name="right" size={15} />
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      }
      case 'row':
        return renderRow(it.row, it.rail, it.later);
    }
  };

  return (
    <div className="vh">
      <div className="vh-scroll av-scroll" ref={scrollRef}>
        <div className={`vh-list${data.pics ? ' pics' : ''}`}>
          {p.loading && !hasEntries && <div className="vh-empty">读取对话……</div>}
          {!p.loading && !hasEntries && <div className="vh-empty">还没有对话</div>}
          {start > 0 && <div className="vh-top">往上翻,更早的会接着载入</div>}
          {blocks.map((b, i) => {
            const at = start + shown.indexOf(b.entry);
            const near = i >= blocks.length - 6 || (nowAt >= 0 && Math.abs(at - nowAt) <= ABOVE_NOW);
            return (
              <section
                key={b.entry.id}
                className={`vh-entry ${b.user ? 'me' : 'her'}${b.later ? ' later' : ''}${near ? ' near' : ''}`}
                data-id={b.entry.id}
              >
                {b.items.map((it) => renderItem(it, b.entry, b.user))}
              </section>
            );
          })}
        </div>
      </div>
      {big && (
        <div className="vh-big" role="dialog" aria-label="CG" onClick={() => setBig(null)}>
          <img src={big} alt="CG" draggable={false} />
        </div>
      )}
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
