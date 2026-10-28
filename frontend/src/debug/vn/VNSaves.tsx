/**
 * 菜单里的「存档」页 —— 存档就是调试台「对话历史」里的对话,一个对话一格。
 *
 * 每格的缩略图是那个对话停在最后一句时游戏里的画面(背景、立绘、CG,和视觉小说读同一份时间线,core/timeline.ts),再配上角色最后一句,帮人想起是哪一段。
 * 算缩略图要读整段对话:当前这个直接用内存里的,别的按需拉一次,按「id + 更新时间」缓存。
 *
 * 每格上半是场景 + 地点,下半是压在接缝上的圆头像 + 名字 · 时间 + 她最后一句;第一格是「在这里存档」。
 * 10-23 起菜单是一块纸(局内菜单 A):格子直接摆在纸上,页头是一条场景横幅(VNMenu 画);
 * 不放立绘、页里不再另糊一层场景(菜单背后已经糊了一层,一屏只糊一层)。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { newBeatCache, parseBeats, type Beat } from '../core/beats';
import { buildTimeline, stateAtEnd, type TimelineCtx } from '../core/timeline';
import {
  debugApi,
  sceneImageUrl,
  type PackSprite,
  type ChatSummary,
  type SceneAsset,
  type SpriteLayout,
  cardFaceUrl,
} from '../lib/api';
import { fromStored, type ChatEntry } from '../lib/chatEntry';
import { substituteMacros, type MacroContext } from '../lib/macros';
import { relTime } from '../lib/time';
import { emotionCandidates, emotionListRef, isNpcHit, type EmotionContext } from '../plugins/emotionMatch';
import { jevText } from '../plugins/jevNotes';
import { parseBilingual } from '../plugins/lang';
import type { FormsState } from '../plugins/cartridges';
import { cgFrameFromPairs } from '../plugins/pairings';
import type { SpriteStage } from '../plugins/spriteLayout';
import { FALLBACK_BACKGROUND } from './fallbacks';
import type { TagKind } from './script';
import { useEmotionMatches } from './useEmotionMatches';
import { usePairings } from './usePairings';
import { useTimelineEngine } from './useTimelineEngine';
import { useWordRecords } from './useWordRecords';
import { chatLabel } from './menuLabel';
import { ConfirmHere } from './ui/ConfirmHere';
import type { ConfirmReason } from './ui/logic';
import { MOTION, prefersReducedMotion } from './ui/motion';
import './vnSaves.css';

interface Props {
  /** 当前角色(存档格上的圆头像) */
  cardId?: string | null;
  /** 当前角色的全部对话 */
  chats: ChatSummary[];
  currentChatId: string | null;
  /** 当前对话在内存里的样子(可能比库里新) */
  currentEntries: ChatEntry[];
  sceneAssets: SceneAsset[];
  sprites: PackSprite[];
  /** 立绘和游戏里一样按脸对齐 */
  spriteStage: SpriteStage;
  spriteLayout: SpriteLayout;
  tagKinds: TagKind[];
  charName: string;
  /** 和视觉小说一样认「我」 */
  userName: string;
  /** 形态(plugins/forms.ts):缩略图按每个存档自己的形态记号换算,和游戏里一样;这张卡没开时它返回 null */
  formsLensFor: FormsState['lensFor'];
  macros: MacroContext;
  /** 分叉 / 读档等动作正在跑 */
  busy: boolean;
  canSave: boolean;
  onSaveHere: () => void;
  /** 从封面「读档」进来:只能挑一个读,没有「在这里存档」那一格(没有当前对话可存) */
  loadOnly?: boolean;
  onLoad: (id: string) => void;
  onNewStory: () => void;
  onRename: (id: string, name: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

interface Preview {
  bg: SceneAsset | null;
  /** 停在 CG 上:画面上那张(差分跟着最后的表情);有它就只画它,和游戏里一样盖住背景和立绘 */
  cg: SceneAsset | null;
  sprite: PackSprite | null;
  /** 立绘没配图时,占位上写的表情名 */
  spriteLabel: string | null;
  line: string;
}

/** 别的对话拉回来的消息,按「id:更新时间」缓存 —— 对话一改,更新时间变,自然失效 */
const entryCache = new Map<string, ChatEntry[]>();
/** 正在拉的:对话列表一变(每存一句都会变)effect 就重跑,不去重的话同一张对话会拉好几遍 */
const inflight = new Map<string, Promise<ChatEntry[]>>();
/** 同时最多拉几张:存档多的时候一口气几十个整段对话的请求,手机上把别的请求(图、语音)都堵住了 */
const FETCH_CONCURRENCY = 4;

function fetchEntries(id: string, key: string): Promise<ChatEntry[]> {
  let p = inflight.get(key);
  if (!p) {
    p = debugApi
      .getChat(id)
      .then((d) => {
        const entries = d.messages.map((m, i) => fromStored(m, i));
        entryCache.set(key, entries);
        return entries;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** 角色最后一句(缩略图下面那行):最后一条回复切出来的最后一句 */
function lastLineOf(entries: readonly ChatEntry[], kinds: TagKind[], charName: string, macros: MacroContext): string {
  const last = [...entries].reverse().find((e) => e.role === 'assistant');
  if (!last) return '';
  const raw = substituteMacros(jevText(last, kinds), macros, { seed: `${last.id}:${last.swipeIndex}` });
  // 日中交替写的回复只取中文那句(日语挂在句子上,不单独成句)
  const lines = parseBilingual(raw, { charName, userName: macros.user, tags: kinds, streaming: false }).lines;
  return lines[lines.length - 1]?.text ?? '';
}

/** 上半:存档那一刻的场景(停在 CG 上就是那张 CG)+ 地点;正在玩的那格右上一枚「正在玩」 */
function Thumb({ preview, now, last }: { preview: Preview | null; now: boolean; last?: boolean }) {
  // 从封面读档时那一格是「上次玩的」(设计稿读档页)
  const badge = now && <span className="vn-slot-badge">{last ? '上次玩的' : '正在玩'}</span>;
  if (!preview) return <div className="vn-slot-thumb loading">{badge}</div>;
  return (
    <div className="vn-slot-thumb">
      <img
        className="vn-slot-bg"
        src={sceneOf(preview)}
        alt=""
        draggable={false}
        style={preview.cg ? undefined : { objectPosition: `${preview.bg?.focus_x ?? 50}% 50%` }}
      />
      {preview.bg?.label && !preview.cg && <span className="vn-slot-place">{preview.bg.label}</span>}
      {badge}
    </div>
  );
}

const sceneOf = (p: Preview | null): string =>
  (p?.cg ? sceneImageUrl(p.cg) : null) ?? (p?.bg ? sceneImageUrl(p.bg) : null) ?? FALLBACK_BACKGROUND;

/** 接缝上的圆头像:按脸裁的小图 → 名字首字 */
function SlotFace({ src, name }: { src: string | null; name: string }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="vn-slot-face">
      {src && !bad ? <img src={src} alt="" draggable={false} onError={() => setBad(true)} /> : name.slice(0, 1) || '?'}
    </span>
  );
}

export function VNSaves({
  cardId,
  chats,
  currentChatId,
  currentEntries,
  sceneAssets,
  sprites,
  spriteStage,
  spriteLayout,
  tagKinds,
  charName,
  userName,
  formsLensFor,
  macros,
  busy,
  canSave,
  onSaveHere,
  loadOnly,
  onLoad,
  onNewStory,
  onRename,
  onDelete,
}: Props) {
  // 别的对话的消息:拉到一个放一个,拉完这一轮才会触发一次重算
  const [loaded, setLoaded] = useState<Map<string, ChatEntry[]>>(() => new Map());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // 每格左上的「⋯」:点开一个小菜单(重命名 / 删除);点别处收起
  const [moreFor, setMoreFor] = useState<string | null>(null);
  useEffect(() => {
    if (!moreFor) return;
    const off = (e: Event) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('.vn-slot-pop, .vn-slot-more')) setMoreFor(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 只收小菜单,别连菜单一起关(VNScreen 认 defaultPrevented)
      e.preventDefault();
      setMoreFor(null);
    };
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', off, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [moreFor]);
  // 删存档:就在那一格上翻出「删除 / 留着」(leaving = 正在淡出,格子上的淡化已经撤了)
  const [asking, setAsking] = useState<{ id: string; leaving: boolean } | null>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const closeAsk = (reason: ConfirmReason) => {
    const cur = asking;
    if (!cur || cur.leaving) return;
    setAsking({ id: cur.id, leaving: true });
    window.setTimeout(() => setAsking((a) => (a?.id === cur.id ? null : a)), prefersReducedMotion() ? 0 : MOTION.popOut + 10);
    if (reason === 'delete') void onDelete(cur.id);
  };
  // 问的那个存档没了(别处删掉了、换了角色):确认也跟着收
  useEffect(() => {
    if (asking && !chats.some((c) => c.id === asking.id)) setAsking(null);
  }, [asking, chats]);

  useEffect(() => {
    let alive = true;
    const misses: { id: string; key: string }[] = [];
    for (const c of chats) {
      if (c.id === currentChatId) continue;
      const key = `${c.id}:${c.updated_at}`;
      const hit = entryCache.get(key);
      if (hit) {
        setLoaded((m) => (m.get(c.id) === hit ? m : new Map(m).set(c.id, hit)));
        continue;
      }
      misses.push({ id: c.id, key });
    }
    let next = 0;
    const worker = async () => {
      while (alive && next < misses.length) {
        const { id, key } = misses[next++];
        try {
          const entries = await fetchEntries(id, key);
          if (alive) setLoaded((m) => new Map(m).set(id, entries));
        } catch {
          // 拉不到就一直显示占位缩略图,不弹错 —— 这里是导航,不是告警通道
        }
      }
    };
    for (let i = 0; i < FETCH_CONCURRENCY; i++) void worker();
    return () => {
      alive = false;
    };
  }, [chats, currentChatId]);

  // 每个存档切好的句子(和视觉小说同一套切法,按条缓存)
  const beatCache = useRef(newBeatCache());
  const saves = useMemo(() => {
    const out = new Map<string, { entries: ChatEntry[]; beats: Beat[] }>();
    for (const c of chats) {
      const entries = c.id === currentChatId ? currentEntries : loaded.get(c.id);
      if (entries) {
        out.set(c.id, { entries, beats: parseBeats({ entries, tagKinds, macros, charName, userName, cache: beatCache.current }) });
      }
    }
    return out;
  }, [chats, currentChatId, currentEntries, loaded, tagKinds, macros, charName, userName]);

  // 认表情和视觉小说一样(同一个开关、同一份缓存,视觉小说里问过的不再问)
  const candidates = useMemo(() => emotionCandidates(sprites), [sprites]);
  const words = useMemo(() => {
    const out: string[] = [];
    for (const { beats } of saves.values()) {
      for (const b of beats) {
        for (const h of b.parsed?.hits ?? []) if (h.kind === 'sprite' && !isNpcHit(h, charName)) out.push(h.label);
      }
    }
    return out;
  }, [saves, charName]);
  const engine = useTimelineEngine();
  const listRef = useMemo(() => emotionListRef(sprites), [sprites]);
  const legacyResolve = useEmotionMatches(words, candidates, engine === 'legacy');
  const recordsResolve = useWordRecords(listRef, words, candidates, engine === 'records');
  const resolve = engine === 'records' ? recordsResolve : legacyResolve;
  const emotion: EmotionContext = useMemo(
    () => ({ resolve, rawOnFail: sprites.length === 0, charName }),
    [resolve, sprites.length, charName],
  );
  // CG 那一帧和视觉小说一样:认词记录时查配对表(同一份缓存),旧算法、表还没读到时照旧按名字找
  const cgPairs = usePairings('cg', listRef, engine === 'records');
  const pickCgFrame = useMemo(
    () => (engine === 'records' && cgPairs ? cgFrameFromPairs(cgPairs, sprites, sceneAssets) : undefined),
    [engine, cgPairs, sprites, sceneAssets],
  );
  // 时间线的输入:素材、认词结果、配对表大家共用;形态记号每个存档各有一份(存档里的 + 这个浏览器里的)。
  // 条目和共用的那份都没变就给同一个对象 —— 时间线按它认缓存,当前对话在流式时只重算正在写的那条
  const base: TimelineCtx = useMemo(
    () => ({ sprites, sceneAssets, emotion, forms: null, ...(pickCgFrame ? { cgFrame: pickCgFrame } : {}) }),
    [sprites, sceneAssets, emotion, pickCgFrame],
  );
  const formsCtx = useRef(
    new WeakMap<readonly ChatEntry[], { base: TimelineCtx; lensFor: FormsState['lensFor']; ctx: TimelineCtx }>(),
  );

  const previews = useMemo(() => {
    const ctxOf = (id: string, entries: readonly ChatEntry[]): TimelineCtx => {
      const hit = formsCtx.current.get(entries);
      if (hit && hit.base === base && hit.lensFor === formsLensFor) return hit.ctx;
      const lens = formsLensFor(id, entries, sprites);
      const ctx = lens ? { ...base, forms: lens } : base;
      formsCtx.current.set(entries, { base, lensFor: formsLensFor, ctx });
      return ctx;
    };
    const out = new Map<string, Preview>();
    for (const [id, { entries, beats }] of saves) {
      const st = stateAtEnd(buildTimeline(beats, ctxOf(id, entries)), beats);
      // 和舞台一样按显示的表情名找立绘,找不到用排第一的;一张立绘都没有时占位上写表情名
      const sprite = sprites.find((s) => s.label === st.shownLabel) ?? sprites[0] ?? null;
      out.set(id, {
        bg: st.scene.bg,
        cg: st.cgFrame,
        sprite,
        spriteLabel: sprite ? sprite.label : st.shownLabel,
        line: lastLineOf(entries, tagKinds, charName, macros),
      });
    }
    return out;
  }, [saves, base, formsLensFor, sprites, tagKinds, charName, macros]);

  // spriteStage / spriteLayout 是游戏里的构图;格子里的缩略图自己摆,用不上
  void spriteStage;
  void spriteLayout;

  const faceSrc = cardId ? cardFaceUrl(cardId, 96, sprites[0]?.pack_id) : null;

  // 回车 / Esc 之后输入框被卸掉,有的浏览器还会补一个 blur:那次不能再提交(Esc 是放弃)
  const renameClosed = useRef(false);
  const commitRename = () => {
    if (!renaming || renameClosed.current) return;
    renameClosed.current = true;
    const name = renaming.name.trim();
    setRenaming(null);
    if (name) void onRename(renaming.id, name);
  };

  const plus = (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );

  return (
    <div className="vn-saves">
      {/* 页头右边(和「返回游戏」一行):新的故事(设计稿 .mn-head-r);从封面读档时封面上本来就有「新的故事」,这里不放 */}
      {!loadOnly && (
        <div className="vn-saves-acts">
          <button type="button" className="av-btn sm" onClick={onNewStory} disabled={busy}>
            新的故事
          </button>
        </div>
      )}

      <div
        ref={slotsRef}
        className={`vn-slots${asking && !asking.leaving ? ' av-dimrest' : ''}`}
      >
        {!loadOnly && (
          <button
            type="button"
            className="vn-slot vn-slot-new"
            onClick={onSaveHere}
            disabled={busy || !canSave}
            title="把到当前这条消息为止的对话另存一份,你留在现在这个对话里接着玩"
          >
            <span className="plus">{plus}</span>
            <span className="tx">
              <b className="t">{busy ? '处理中…' : '在这里存档'}</b>
              <small className="s">{canSave ? '存到当前这一句为止' : '还没有可以存的对话'}</small>
            </span>
          </button>
        )}
        {chats.map((c) => {
          const current = c.id === currentChatId;
          const preview = previews.get(c.id) ?? null;
          const editing = renaming?.id === c.id;
          const count = current ? currentEntries.length : c.message_count;
          return (
            <div
              key={c.id}
              className={`vn-slot${current ? ' current' : ''}${asking?.id === c.id && !asking.leaving ? ' is-asking' : ''}${editing ? ' is-renaming' : ''}`}
            >
              <button
                type="button"
                className="vn-slot-open"
                onClick={() => (current ? undefined : onLoad(c.id))}
                disabled={busy}
                title={current ? (loadOnly ? '上次玩的就是这个' : '正在玩的就是这个') : '读档'}
              >
                <Thumb preview={preview} now={current} last={loadOnly} />
                <span className="vn-slot-body">
                  <span className="vn-slot-title">
                    <SlotFace src={faceSrc} name={charName} />
                    <b className="vn-slot-name" title={c.name}>
                      {chatLabel(c.name, charName) || '未命名'}
                    </b>
                    <span className="vn-slot-time">· {relTime(c.updated_at)}</span>
                    {/* 和调试台的对话历史一样有条数;当前对话以内存为准,列表里的条数是上次拉列表时的 */}
                    <i className="vn-slot-count">{count} 条</i>
                  </span>
                  <span className="vn-slot-line">{preview?.line || c.last_message || '……'}</span>
                </span>
              </button>
              {editing && (
                <input
                  className="vn-slot-rename"
                  autoFocus
                  aria-label="存档名字"
                  value={renaming.name}
                  maxLength={80}
                  onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    // 输入法选字的回车不算
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename();
                    if (e.key === 'Escape') {
                      // 只放弃改名,别连菜单一起关(VNScreen 认 defaultPrevented)
                      e.preventDefault();
                      renameClosed.current = true;
                      setRenaming(null);
                    }
                  }}
                />
              )}
              <button
                type="button"
                className={`vn-slot-more${moreFor === c.id ? ' on' : ''}`}
                aria-label="重命名 / 删除"
                aria-haspopup="menu"
                aria-expanded={moreFor === c.id}
                title="重命名 / 删除"
                onClick={() => setMoreFor((m) => (m === c.id ? null : c.id))}
              >
                ⋯
              </button>
              {moreFor === c.id && (
                <div className="vn-slot-pop" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreFor(null);
                      renameClosed.current = false;
                      setRenaming({ id: c.id, name: c.name });
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="bad"
                    onClick={() => {
                      setMoreFor(null);
                      setAsking({ id: c.id, leaving: false });
                    }}
                  >
                    删除
                  </button>
                </div>
              )}
              {asking?.id === c.id && (
                <ConfirmHere
                  title="删掉以后找不回来"
                  body={`这 ${count} 条对话一起删`}
                  scope={slotsRef}
                  leaving={asking.leaving}
                  onClose={closeAsk}
                />
              )}
            </div>
          );
        })}
      </div>
      {chats.length === 0 && <p className="vn-page-empty">这个角色还没有对话</p>}
    </div>
  );
}
