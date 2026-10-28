/**
 * 局内菜单「相册」页(生图卡带经扩展点 VnIllustrations.album 交给内核,见 cartridges.ts;设计稿 kit/scene.js 的
 * AV.menuAlbum / AV.albumViewer,计划 U14):
 *
 *   页面  按存档(对话)分组,一行四格;每格一张画过的图,左上「手动 / 自动 / 换一张」,右上 ☆ 收藏(指到才出,收藏了常亮)。
 *         右上两个分段:按存档 / 按时间,全部 / 已收藏
 *   大图  点一张铺满整个画面看:← / → 翻,Esc 关;底下一条纸写标题、说明、哪一句,右下 删除 · 收藏 · 跳到这里
 *
 * ☆ 收藏 = 放进这张卡的「AI 生图 · 卡名」CG 包,和卡编辑器的「AI 生成」一栏(StudioAlbum.tsx)是同一份数据和同一套收藏 /
 * 删除(useImageGen 的 store),这里不另写后端。「跳到这里」回到画它的那一句,靠相册里记的 chat_id / entry_id / line,
 * 内核通过 MenuAlbumContext.jumpTo 把「跳」交出来;画在别的存档里的走 jumpToSave(读那个档,读好了再落到那一句)。
 * 判断能不能跳、读完落不落得上都在 menuAlbumModel.ts。
 * 纸跟主题(--av-paper / --av-ink / --av-dim / --av-hair),选中不跟角色色;看大图是一整屏的照片,深色不跟主题。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SCENE_WIDTHS } from '../../generated/contracts';
import { apiUrl } from '../../lib/api';
import { Icon } from '../../studio/icons';
import { Help } from '../../vn/ui/Help';
import { Seg } from '../../vn/ui/Seg';
import { saveTitle } from '../../vn/menuLabel';
import type { MenuAlbumContext } from '../cartridges';
import {
  clockText,
  dayText,
  drawnOnly,
  groupByDay,
  groupBySave,
  jumpTargetOf,
  landingOf,
  lineText,
  whereLine,
  type AlbumGroup,
  type JumpTarget,
} from './menuAlbumModel';
import { albumEntries, triggerName, type AlbumEntry } from './studioAlbumModel';
import type { ImageGenStore } from './useImageGen';
import './menuAlbum.css';

type By = 'save' | 'time';
type Only = 'all' | 'kept';

/** 排法、筛选记在模块里:换到别的菜单页再回来还是这样(页面卸载了也在) */
const remembered: { by: By; only: Only } = { by: 'save', only: 'all' };

const THUMB_W = 480;
const BG_W = 320;

const HELP =
  '游戏里点对话区旁边的画笔(右键 / 长按先设置),或者开着自动出图,画出来的图都先进相册,包括「换一张」换掉的。点 ☆ 收藏才会放进 CG 包,AI / Jev 以后能直接选它。';

const blob = (sha: string, w: number) => apiUrl(`/api/blobs/${sha}?w=${w}`);

const titleOf = (e: AlbumEntry) => e.image?.title.trim() || '(没有标题)';

export interface MenuAlbumProps extends MenuAlbumContext {
  store: ImageGenStore;
}

export function MenuAlbum({ store, cardName, kept, saves, currentChatId, swipeOf, jumpTo, loadSave, jumpToSave }: MenuAlbumProps) {
  const { album, albumError, reloadAlbum } = store;
  const [by, setByState] = useState<By>(remembered.by);
  const [only, setOnlyState] = useState<Only>(remembered.only);
  const setBy = (v: By) => {
    remembered.by = v;
    setByState(v);
  };
  const setOnly = (v: Only) => {
    remembered.only = v;
    setOnlyState(v);
  };
  // 正在看大图的那张(相册记录的 id)
  const [viewing, setViewing] = useState<string | null>(null);
  // 正在收藏的那张(别连点);刚收藏、CG 绑定还没重读回来的 CG id(☆ 不要闪回去)
  const [keeping, setKeeping] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // 进来时重读一次:游戏里、别的设备上刚画的
  useEffect(() => {
    void reloadAlbum();
  }, [reloadAlbum]);

  const drawn = useMemo(() => (album ? drawnOnly(albumEntries(album, kept, pending)) : []), [album, kept, pending]);
  const keptCount = drawn.filter((e) => e.kept).length;
  const shown = only === 'kept' ? drawn.filter((e) => e.kept) : drawn;

  const groups: AlbumGroup[] = useMemo(
    () => (by === 'save' ? groupBySave(shown, saves, currentChatId) : groupByDay(shown)),
    [by, shown, saves, currentChatId],
  );
  // 大图里 ← / → 翻的顺序 = 页面上从上到下、从左到右
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const saveName = useMemo(() => new Map(saves.map((s) => [s.id, saveTitle(s.name)])), [saves]);
  const world = useMemo(
    () => ({ currentChatId, saveIds: new Set(saves.map((s) => s.id)), swipeOf }),
    [currentChatId, saves, swipeOf],
  );

  const keepOne = useCallback(
    async (e: AlbumEntry) => {
      if (!e.image || e.kept || keeping) return;
      setKeeping(e.key);
      const k = await store.keep(e.image.id);
      setKeeping(null);
      if (k) setPending((s) => new Set(s).add(k.asset_id));
    },
    [keeping, store],
  );

  const open = (e: AlbumEntry, from: HTMLElement | null) => {
    opener.current = from;
    setViewing(e.key);
  };
  const closeViewer = useCallback(() => {
    setViewing(null);
    // 焦点回到点开它的那一格(格子还在的话)
    const back = opener.current;
    opener.current = null;
    window.requestAnimationFrame(() => back?.isConnected && back.focus({ preventScroll: true }));
  }, []);

  const loading = album === null && !albumError;

  let body: ReactNode;
  if (albumError) body = <Note title="相册读取失败" text={albumError} />;
  else if (loading) body = <Note title="读取中…" />;
  else if (drawn.length === 0) body = <Note title="还没画过图" text="画笔画出来的都会进这里" />;
  else if (shown.length === 0) {
    body = <Note title="还没有收藏" text="点图右上角的 ☆ 收藏进 CG 包,游戏里 AI / Jev 才选得到" />;
  } else {
    body = groups.map((g) => (
      <section key={g.id} className="ma-group">
        <header className="ma-ghead">
          <GroupThumb entry={g.items[0]} />
          <b>{g.title}</b>
          <span className="ma-dim">
            {g.items.length} 张{g.current ? ' · 正在玩' : ''}
          </span>
          <span className="ma-flex" />
          {by === 'save' && g.chatId !== null && !g.current && (
            <button type="button" className="ma-tlink" onClick={() => loadSave(g.chatId!)}>
              读这个档
            </button>
          )}
        </header>
        <div className="ma-grid">
          {g.items.map((e) => (
            <Tile
              key={e.key}
              entry={e}
              from={by === 'time' ? (saveName.get(e.image?.chat_id ?? '') ?? null) : null}
              busy={keeping === e.key}
              onOpen={(el) => open(e, el)}
              onKeep={() => void keepOne(e)}
            />
          ))}
        </div>
      </section>
    ));
  }

  const viewIndex = viewing === null ? -1 : flat.findIndex((e) => e.key === viewing);
  const cur = viewIndex >= 0 ? flat[viewIndex] : null;
  // 看着的那张没了(删了、筛选掉了):换到相邻的一张,一张都不剩就关
  useEffect(() => {
    if (viewing !== null && viewIndex < 0 && album !== null) {
      if (flat.length > 0) setViewing(flat[0].key);
      else setViewing(null);
    }
  }, [viewing, viewIndex, flat, album]);

  return (
    <div className="ma" ref={root}>
      <div className="ma-bar">
        <Seg
          label="怎么排"
          options={[
            { value: 'save' as By, name: '按存档' },
            { value: 'time' as By, name: '按时间' },
          ]}
          value={by}
          onPick={setBy}
        />
        <Seg
          label="看哪些"
          options={[
            { value: 'all' as Only, name: `全部 ${drawn.length}` },
            { value: 'kept' as Only, name: `已收藏 ${keptCount}` },
          ]}
          value={only}
          onPick={setOnly}
        />
        <span className="ma-flex" />
        <span className="ma-note">
          ☆ 收藏进「AI 生图 · {cardName.trim() || '卡名'}」CG 包
          <Help tip={HELP} />
        </span>
      </div>
      {body}
      {cur && (
        <Viewer
          host={root.current}
          entries={flat}
          index={viewIndex}
          saveName={saveName}
          world={world}
          keeping={keeping !== null}
          onGo={(i) => setViewing(flat[i].key)}
          onClose={closeViewer}
          onKeep={(e) => void keepOne(e)}
          onDelete={async (e) => {
            if (!e.image) return;
            if (await store.removeImage(e.image.id)) {
              store.notify('ok', `「${titleOf(e)}」删掉了${e.kept ? '(CG 包里收藏的那张还在)' : ''}`);
            }
          }}
          onJump={(t, e) => {
            if (t.kind === 'jump') jumpTo(t.entryId, t.line);
            else if (t.kind === 'load') jumpToSave(t.chatId, (swipeOfLoaded) => landingOf(e, t.chatId, swipeOfLoaded));
          }}
        />
      )}
    </div>
  );
}

function Note({ title, text }: { title: string; text?: string }) {
  return (
    <div className="ma-empty">
      <b>{title}</b>
      {text}
    </div>
  );
}

/** 组头的小图:这一组里最新的一张 */
function GroupThumb({ entry }: { entry: AlbumEntry | undefined }) {
  const sha = entry?.image?.sha;
  return <span className="ma-th">{sha ? <img src={blob(sha, 160)} alt="" draggable={false} loading="lazy" /> : null}</span>;
}

// ---------------------------------------------------------------- 一格

function Tile({
  entry,
  from,
  busy,
  onOpen,
  onKeep,
}: {
  entry: AlbumEntry;
  /** 按时间排时,这一张属于哪个存档(按存档排时组头已经写了) */
  from: string | null;
  busy: boolean;
  onOpen: (el: HTMLElement) => void;
  onKeep: () => void;
}) {
  const img = entry.image;
  if (!img) return null;
  const where = whereLine(entry);
  return (
    <div className="ma-tile">
      <button
        type="button"
        className="ma-open"
        title={img.description || undefined}
        aria-label={`${titleOf(entry)}${where ? ` · ${where}` : ''}`}
        onClick={(ev) => onOpen(ev.currentTarget)}
      >
        <span className="ma-pic">
          {img.sha ? <img src={blob(img.sha, THUMB_W)} alt="" draggable={false} loading="lazy" /> : <Icon name="image" size={20} />}
        </span>
        <span className="ma-tx">
          <b>{titleOf(entry)}</b>
          <small>{[where, from].filter(Boolean).join(' · ')}</small>
        </span>
      </button>
      <span className="ma-tr">{triggerName(img.trigger)}</span>
      <button
        type="button"
        className={`ma-star${entry.kept ? ' on' : ''}`}
        aria-label={entry.kept ? '已收藏进 CG 包' : `收藏「${titleOf(entry)}」进 CG 包`}
        title={entry.kept ? '已收藏进 CG 包' : '收藏进 CG 包'}
        aria-disabled={entry.kept || busy}
        onClick={() => !entry.kept && !busy && onKeep()}
      >
        <Icon name="star" size={14} fill={entry.kept} strokeWidth={1.6} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- 看大图

/** 点两下才删的按钮:第一下变红,4 秒不点第二下 / 点到别处就收回 */
function ArmedDelete({ label, armedLabel, onConfirm }: { label: string; armedLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`av-btn sm danger${armed ? ' is-armed' : ''}`}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) setArmed(true);
        else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}

function Viewer({
  host,
  entries,
  index,
  saveName,
  world,
  keeping,
  onGo,
  onClose,
  onKeep,
  onDelete,
  onJump,
}: {
  host: HTMLElement | null;
  entries: readonly AlbumEntry[];
  index: number;
  saveName: ReadonlyMap<string, string>;
  world: Parameters<typeof jumpTargetOf>[1];
  keeping: boolean;
  onGo: (i: number) => void;
  onClose: () => void;
  onKeep: (e: AlbumEntry) => void;
  onDelete: (e: AlbumEntry) => void | Promise<void>;
  /** e 是这张图:画在别的存档里的,读完档还要拿它判断落不落得上 */
  onJump: (t: JumpTarget, e: AlbumEntry) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const entry = entries[index];
  const img = entry.image;
  // 铺满整个画面:挂到菜单最外层(.vn-menu)上,盖住左边导航
  const menu = useMemo(() => host?.closest<HTMLElement>('.vn-menu') ?? host, [host]);

  // 最新的值给键盘监听用(监听只挂一次)
  const live = useRef({ entries, index, onGo, onClose });
  live.current = { entries, index, onGo, onClose };

  // 键:← / → 翻页,Esc 关;捕获阶段先接,接了就 preventDefault(游戏自己的 Esc / → 看到 defaultPrevented 就不再处理)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const l = live.current;
      if (e.key === 'ArrowLeft') {
        if (l.index > 0) l.onGo(l.index - 1);
      } else if (e.key === 'ArrowRight') {
        if (l.index < l.entries.length - 1) l.onGo(l.index + 1);
      } else if (e.key === 'Escape') l.onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // 背后(导航、页面)不能被 Tab 到:大图的兄弟节点都 inert,关了还原
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const changed: Element[] = [];
    for (const sib of Array.from(parent.children)) {
      if (sib === el || sib.hasAttribute('inert')) continue;
      sib.setAttribute('inert', '');
      changed.push(sib);
    }
    el.focus({ preventScroll: true });
    return () => changed.forEach((s) => s.removeAttribute('inert'));
  }, [menu]);

  const target = jumpTargetOf(entry, world);
  const chatName = img?.chat_id ? saveName.get(img.chat_id) : undefined;
  const meta = img
    ? [`${dayText(img.created_at)} ${clockText(img.created_at)}`.trim(), triggerName(img.trigger), img.ms > 0 ? `${(img.ms / 1000).toFixed(1)} 秒` : '']
        .filter(Boolean)
        .join(' · ')
    : '';
  const here = [chatName, lineText(img?.line)].filter(Boolean).join(' · ');

  if (!img || !menu) return null;
  return createPortal(
    <div ref={box} className="ma-viewer av-night" role="dialog" aria-modal="true" aria-label="看大图" tabIndex={-1}>
      {img.sha && <img className="ma-bg" src={blob(img.sha, BG_W)} alt="" aria-hidden="true" draggable={false} />}
      <div className="ma-veil" />
      <div className="ma-vtop">
        <button type="button" className="ma-back" onClick={onClose}>
          <Icon name="back" size={16} />
          相册 <kbd className="av-kbd">Esc</kbd>
        </button>
        <span className="ma-cnt">
          {index + 1} / {entries.length}
          {chatName ? ` · ${chatName}` : ''}
        </span>
      </div>
      <div className="ma-vstage">
        <button type="button" className="ma-nav l" aria-label="上一张" disabled={index === 0} onClick={() => onGo(index - 1)}>
          <Icon name="back" size={20} />
        </button>
        {img.sha ? (
          <img
            key={img.id}
            className="ma-big"
            src={blob(img.sha, SCENE_WIDTHS.desktop)}
            alt={img.description || titleOf(entry)}
            draggable={false}
          />
        ) : (
          <span className="ma-big none">
            <Icon name="image" size={28} />
          </span>
        )}
        <button
          type="button"
          className="ma-nav r"
          aria-label="下一张"
          disabled={index >= entries.length - 1}
          onClick={() => onGo(index + 1)}
        >
          <Icon name="back" size={20} className="flip" />
        </button>
      </div>
      <div className="ma-sheet">
        <div className="ma-hd">
          <b>{titleOf(entry)}</b>
          <span className="ma-dim">{meta}</span>
        </div>
        {img.description.trim() && <p>{img.description.trim()}</p>}
        <div className="ma-ft">
          <span className="ma-where">
            <span>{here || '没记下画在哪一句'}</span>
            {target.kind !== 'jump' && <span className="ma-why">{target.why}</span>}
          </span>
          <span className="ma-flex" />
          <ArmedDelete
            label={entry.kept ? '删除记录' : '删除'}
            armedLabel={entry.kept ? '再点一下删除记录' : '再点一下删除'}
            onConfirm={() => void onDelete(entry)}
          />
          <button
            type="button"
            className={`av-btn${entry.kept ? ' on' : ''}`}
            title="放进这张卡的「AI 生图」CG 包,以后 AI / Jev 能直接选"
            aria-disabled={entry.kept || keeping}
            onClick={() => !entry.kept && !keeping && onKeep(entry)}
          >
            <Icon name="star" size={14} fill={entry.kept} strokeWidth={1.6} />
            <span>{entry.kept ? '已收藏' : keeping ? '收藏中…' : '收藏'}</span>
          </button>
          <button
            type="button"
            className="av-btn primary"
            disabled={target.kind === 'none'}
            title={target.kind === 'jump' ? '回到画它的那一句' : target.why}
            onClick={() => onJump(target, entry)}
          >
            跳到这里
          </button>
        </div>
      </div>
    </div>,
    menu,
  );
}
