/**
 * 菜单里的「存档」页 —— 存档就是调试台「对话历史」里的对话,一个对话一格。
 *
 * 每格的缩略图是那个对话结尾时的背景 + 立绘,再配上角色最后一句,帮人想起是哪一段。
 * 算缩略图要读整段对话:当前这个直接用内存里的,别的按需拉一次,按「id + 更新时间」缓存。
 *
 * 10-04 定稿样式(画布「存档 / 读档」):页面底是存档那一刻的场景虚化,鼠标移到哪格换哪格的;
 * 每格上半是场景 + 地点,下半是压在接缝上的圆头像 + 名字 · 时间 + 她最后一句;第一格是「在这里存档」。
 * 有立绘时左边站着她,移到哪格换成那格结尾的表情。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  debugApi,
  sceneImageUrl,
  spriteImageUrl,
  type PackSprite,
  type ChatSummary,
  type SceneAsset,
  type SpriteLayout,
  cardFaceUrl,
} from '../lib/api';
import { fromStored, type ChatEntry } from '../lib/chatEntry';
import { substituteMacros, type MacroContext } from '../lib/macros';
import { relTime } from '../lib/time';
import { jevText } from '../plugins/jevNotes';
import { parseBilingual } from '../plugins/lang';
import { cgFrameFor, sceneAtEnd } from '../plugins/scene';
import { resolveSprite } from '../plugins/sprite';
import { facesByCanvas, type SpriteStage } from '../plugins/spriteLayout';
import { titleSpriteStyle } from './titleArt';
import { extractTags, type TagKind } from './script';
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
  macros: MacroContext;
  /** 分叉 / 读档等动作正在跑 */
  busy: boolean;
  canSave: boolean;
  onSaveHere: () => void;
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

function previewOf(
  entries: ChatEntry[],
  kinds: TagKind[],
  assets: SceneAsset[],
  sprites: PackSprite[],
  charName: string,
  macros: MacroContext,
): Preview {
  const scene = sceneAtEnd(entries, kinds, assets);
  const spriteKind = kinds.filter((k) => k.kind === 'sprite');
  let sprite: PackSprite | null = sprites[0] ?? null;
  let spriteLabel: string | null = null;
  let line = '';
  for (const e of entries) {
    if (e.role !== 'assistant') continue;
    for (const t of extractTags(jevText(e, kinds), spriteKind, false).tags) {
      spriteLabel = t.label;
      sprite = resolveSprite(t.label, sprites) ?? sprite;
    }
  }
  const last = [...entries].reverse().find((e) => e.role === 'assistant');
  if (last) {
    const raw = substituteMacros(jevText(last, kinds), macros, { seed: `${last.id}:${last.swipeIndex}` });
    // 日中交替写的回复只取中文那句(日语挂在句子上,不单独成句)
    const lines = parseBilingual(raw, {
      charName,
      userName: macros.user,
      tags: kinds,
      streaming: false,
    }).lines;
    line = lines[lines.length - 1]?.text ?? '';
  }
  const label = sprite ? sprite.label : spriteLabel;
  const cg = scene.cg ? cgFrameFor(scene.cg, assets, label) : null;
  return { bg: scene.bg, cg, sprite, spriteLabel: label, line };
}

/** 上半:存档那一刻的场景(停在 CG 上就是那张 CG)+ 地点 */
function Thumb({ preview }: { preview: Preview | null }) {
  if (!preview) return <div className="vn-slot-thumb loading" />;
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
    </div>
  );
}

const sceneOf = (p: Preview | null): string =>
  (p?.cg ? sceneImageUrl(p.cg) : null) ?? (p?.bg ? sceneImageUrl(p.bg) : null) ?? '/vn/bg/default.svg';

/** 接缝上的圆头像:按脸裁的小图 → 名字首字 */
function SlotFace({ src, name }: { src: string | null; name: string }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="vn-slot-face">
      {src && !bad ? <img src={src} alt="" draggable={false} onError={() => setBad(true)} /> : name.slice(0, 1) || '?'}
    </span>
  );
}

const SIDE_POSE = { faceSize: 0.19, faceTop: 0.12, cx: 0.5 };

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
  macros,
  busy,
  canSave,
  onSaveHere,
  onLoad,
  onNewStory,
  onRename,
  onDelete,
}: Props) {
  // 别的对话的消息:拉到一个放一个,拉完这一轮才会触发一次重算
  const [loaded, setLoaded] = useState<Map<string, ChatEntry[]>>(() => new Map());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

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

  const previews = useMemo(() => {
    const out = new Map<string, Preview>();
    for (const c of chats) {
      const entries = c.id === currentChatId ? currentEntries : loaded.get(c.id);
      if (entries) out.set(c.id, previewOf(entries, tagKinds, sceneAssets, sprites, charName, macros));
    }
    return out;
  }, [chats, currentChatId, currentEntries, loaded, tagKinds, sceneAssets, sprites, charName, macros]);

  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  // spriteStage / spriteLayout 是游戏里的构图;左边那列按脸单独摆,用不上
  void spriteStage;
  void spriteLayout;

  // 鼠标在哪格:底图虚化、左边的表情跟着换;不在任何一格上时用当前对话的
  const [hot, setHot] = useState<string | null>(null);
  const focusId = hot ?? currentChatId ?? chats[0]?.id ?? null;
  const focus = focusId ? (previews.get(focusId) ?? null) : null;
  const side = focus?.sprite ?? sprites[0] ?? null;
  const sideSrc = side ? spriteImageUrl(side) : null;
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

  return (
    <div className={`vn-saves${sideSrc ? ' with-side' : ''}`}>
      <img key={sceneOf(focus)} className="vn-saves-blur" src={sceneOf(focus)} alt="" draggable={false} />
      <div className="vn-saves-veil" />

      {sideSrc && side && (
        <div className="vn-saves-side" aria-hidden="true">
          <img
            key={side.id}
            className="vn-saves-spr"
            src={sideSrc}
            alt=""
            draggable={false}
            style={titleSpriteStyle(faces.get(side.id) ?? null, side.face_scan?.height ?? null, SIDE_POSE, 0)}
          />
        </div>
      )}

      <div className="vn-saves-main">
        <div className="vn-page-bar">
          <span className="vn-page-note">一个对话一格,点开就是读档。「重来」出的几个版本不算存档,在历史里切</span>
          <div className="vn-page-actions">
            <button className="vn-pill" onClick={onNewStory} disabled={busy}>
              新的故事
            </button>
          </div>
        </div>

        <div className="vn-slots">
          <button
            className="vn-slot vn-slot-new"
            onClick={onSaveHere}
            disabled={busy || !canSave}
            title="把到当前这条消息为止的对话另存一份,你留在现在这个对话里接着玩"
          >
            <span className="plus">+</span>
            <span className="t">{busy ? '处理中…' : '在这里存档'}</span>
            <span className="s">{canSave ? '存到当前这一句为止' : '还没有可以存的对话'}</span>
          </button>
          {chats.map((c) => {
            const current = c.id === currentChatId;
            const preview = previews.get(c.id) ?? null;
            const editing = renaming?.id === c.id;
            return (
              <div
                key={c.id}
                className={`vn-slot${current ? ' current' : ''}`}
                onPointerEnter={() => setHot(c.id)}
                onPointerLeave={() => setHot((h) => (h === c.id ? null : h))}
              >
                <button
                  className="vn-slot-open"
                  onClick={() => (current ? undefined : onLoad(c.id))}
                  onFocus={() => setHot(c.id)}
                  onBlur={() => setHot((h) => (h === c.id ? null : h))}
                  disabled={busy}
                  title={current ? '正在玩的就是这个' : '读档'}
                >
                  <Thumb preview={preview} />
                  {current && <span className="vn-slot-badge">当前</span>}
                  <span className="vn-slot-body">
                    <SlotFace src={faceSrc} name={charName} />
                    <span className="vn-slot-title">
                      <span className="vn-slot-name">{c.name || '未命名'}</span>
                      {/* 和调试台的对话历史一样:「N 条 · 时间」;当前对话以内存为准,列表里的条数是上次拉列表时的 */}
                      <span className="vn-slot-time">
                        {current ? currentEntries.length : c.message_count} 条 · {relTime(c.updated_at)}
                      </span>
                    </span>
                    <span className="vn-slot-line">{preview?.line || c.last_message || '……'}</span>
                  </span>
                </button>
                <div className="vn-slot-actions">
                  {editing ? (
                    <input
                      className="vn-slot-rename"
                      autoFocus
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
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          renameClosed.current = false;
                          setRenaming({ id: c.id, name: c.name });
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className={armedDelete === c.id ? 'danger' : ''}
                        onClick={(e) => {
                          if (armedDelete !== c.id) {
                            setArmedDelete(c.id);
                            return;
                          }
                          // 双击的第二下不算确认:要看到「再点一次删除」再点
                          if (e.detail > 1) return;
                          setArmedDelete(null);
                          void onDelete(c.id);
                        }}
                        onBlur={() => setArmedDelete((a) => (a === c.id ? null : a))}
                      >
                        {armedDelete === c.id ? '再点一次删除' : '删除'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {chats.length === 0 && <p className="vn-page-empty">这个角色还没有对话</p>}
      </div>
    </div>
  );
}
