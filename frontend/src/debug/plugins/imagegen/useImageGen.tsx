/**
 * 生图卡带给内核的状态(cartridges.ts 的 IllustrationsState):插件页「AI 生图 BETA」那一页,
 * 和视觉小说要的几样(某句显示哪张图、「画」按钮、舞台上那一层、回复写完时的自动出图)。
 * 两边用同一份状态(ImageGenStore):插件页里一改,视觉小说里下一张就跟着。
 *
 * 一张图的流程:指导模型(/plan)写画面 → 这张卡选的画图连接(/generate,带 connection_id)画 → 记号挂在那条消息上(marks.ts),
 * DebugApp 照常把消息写库。同一个 NovelAI 账号一次只能画一张,后端排队;这里只记「正在画几张」给画面看。
 * 每条回复写完还让指导模型记一次状态笔记(/note,也挂在那条消息上),画下一张时把前一条的笔记带给它
 * (docs/superpowers/specs/2026-10-22-imagegen-state-notes-design.md)。
 * 11-07 起设置每张卡一份(imagegen.setup,useCardSetup.ts / setup.ts),全局 plugin.imagegen 只存画风库;
 * 画图连接是全局的(/api/imagegen/connections),每张卡选用哪条。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrawerCardFacts } from '../../components/drawer/cardView';
import { apiUrl, debugApi } from '../../lib/api';
import { currentText, type ChatEntry, type VnImageMark } from '../../lib/chatEntry';
import type { VNLine } from '../../vn/script';
import { SCENE_WIDTHS } from '../../generated/contracts';
import type {
  CartridgePanelProps,
  IllustrationsInput,
  IllustrationsState,
  MenuAlbumIllustrations,
  StudioIllustrations,
  VnIllustrationContext,
  VnIllustrations,
} from '../cartridges';
import {
  imagegenApi,
  type CheckResult,
  type GeneratedImage,
  type ConnKind,
  type ImageConn,
  type ImageConnIn,
  type ImageConnPatch,
  type ImageGenDefaults,
  type KeepResult,
  type NaiAccount,
  type Picture,
  type Drawn,
  type PlanRequest,
  type PlanResult,
  type TrialResult,
} from './api';
import {
  DEFAULT_CARD_PREFS,
  IMAGEGEN_SETTING_KEY,
  normalizeCardPrefs,
  sizeOf,
  usesReference,
  withLook,
  type Camera,
  type CardImagePrefs,
  type ImageGenConfig,
  type SizeKey,
} from './config';
import { BLOCK_TEXT, drawBlockOf, kindsOf, without, type DrawBlock } from './connModel';
import { newJobId, openPreview, previewAt, previewBlur, type LivePreview, type PreviewFrame } from './preview';
import { buildGenerate, buildTrial } from './request';
import type { ImageSetup } from './setup';
import { useCardSetup, useStyleLibrary } from './useCardSetup';
// 设置页、相册改成点开才下载了(文件末尾 lazyPage 那些);它们原来带进来的样式照原位置引,样式表先后不变(DebugApp.tsx 开头)
import './imagegen.css';
import '../../vn/settings/settingRow.css';
import {
  addImage,
  blockedByCooldown,
  imagesOf,
  lastImageBefore,
  markAt,
  markInHistory,
  newShowLog,
  noteBefore,
  patchImage,
  repliesSinceImage,
  withNote,
  type ShowLog,
} from './marks';
import './menuAlbum.css';
import './studioAlbum.css';
import { albumSummary } from './studioAlbumModel';
import { IgButton, IgStage } from './VnControls';
import { Lazy } from '../../components/Lazy';
import { lazyPage } from '../../lib/lazyPage';

// 设置页、相册点开才用:单独打包,头一屏不等它们(lib/lazyPage.ts);游戏里的「画」按钮和画面(VnControls)照常一起加载
const ConsoleSettings = lazyPage(() => import('./ConsoleSettings'), 'ConsoleSettings');
const ImageGenSettings = lazyPage(() => import('./ImageGenSettings'), 'ImageGenSettings');
const MenuAlbum = lazyPage(() => import('./MenuAlbum'), 'MenuAlbum');
const StudioAlbum = lazyPage(() => import('./StudioAlbum'), 'StudioAlbum');

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const COARSE = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const SHOW_WIDTH = COARSE ? SCENE_WIDTHS.touch : SCENE_WIDTHS.desktop;
/** 插件抽屉左栏:「AI 生图 BETA」在角色组的外语后面,行尾是 AI 出图的插件开关 */
export const IMAGEGEN_PANEL = {
  key: 'imagegen',
  title: 'AI 生图',
  beta: true,
  after: 'lang',
  group: 'role',
  power: 'illustrations',
  tip: 'imagegen',
  studio: { slot: 'ai', label: '插图' },
} as const;

/** 这张卡在不在用:它自己那份设置里写了长相或角色名 */
export function imagegenInUse(card: DrawerCardFacts): boolean {
  const p = normalizeCardPrefs(card.prefs[IMAGEGEN_SETTING_KEY]);
  return Boolean(p.look.trim() || p.nameTag.trim());
}

/** 手动画时给指导模型看光标前后几句 */
const BEFORE = 10;
// 后面几句给指导模型判断画面到哪一句结束(只判断,不画)
const AFTER = 8;
/** 自动判时整条回复最多给几句 */
const AUTO_LINES = 80;
/** 记状态笔记时整条回复最多给几句(后端最多收 120 句) */
const NOTE_LINES = 120;

/** 图挂在哪:哪条消息的哪个分支第几句;lines / place 是给指导模型看的 */
export interface DrawTarget {
  entry: ChatEntry;
  line: number;
  lines: readonly VNLine[];
  place: VnIllustrationContext['place'];
}

export interface Job {
  key: number;
  label: string;
  started: number;
}

export interface ImageGenStore {
  /**
   * 这张卡的生图设置:全局画风库 + 这张卡的 imagegen.setup(外层 + 选的那条连接下的那份),怎么合成见 setup.ts;
   * 没选卡、还没读到是默认值
   */
  config: ImageGenConfig;
  /** 改了拆回这张卡的 setup(停手半秒写库)和全局画风库(改了画风才写) */
  changeConfig: (next: ImageGenConfig) => void;
  /** 这张卡的长相那份(card_prefs 的 plugin.imagegen,随角色包走);没选卡、还没读到是默认值 */
  prefs: CardImagePrefs;
  changePrefs: (next: CardImagePrefs) => void;
  cardId: string | null;
  cardName: string;
  charName: string;
  userName: string;
  connections: IllustrationsInput['connections'];
  /** 改一条连接的模型(和主模型窗口改的是同一个字段,10-31 用户:指导模型照主模型那样);改完让 DebugApp 重读连接 */
  setConnectionModel: (connectionId: string, model: string) => Promise<void>;
  /** 重新拉一条连接的模型列表 */
  refreshModels: (connectionId: string) => Promise<void>;
  modelsRefreshing: boolean;
  defaults: ImageGenDefaults | null;
  /** NovelAI 连接的账户(等级、Anlas、V5 额度条),按连接编号存;没查过的不在里面 */
  accounts: Readonly<Record<string, NaiAccount>>;
  /** 查不到的原因(接口原文),按连接编号存 */
  accountErrors: Readonly<Record<string, string>>;
  checkAccount: (connId: string) => Promise<void>;
  /** 画图连接(全局一份,每张卡在 setup.conn 里选用哪条);还没读到是 null */
  imageConns: readonly ImageConn[] | null;
  /** 每条连接有几张卡在用(连接页写在地址旁边) */
  usage: Readonly<Record<string, number>>;
  /** 重读连接列表和「几张卡在用」 */
  reloadConns: () => Promise<void>;
  /** 加 / 改一条连接;失败抛错(接口原文在 message 里),成了连接列表跟着重读 */
  addConn: (body: ImageConnIn) => Promise<ImageConn>;
  updateConn: (id: string, patch: ImageConnPatch) => Promise<ImageConn>;
  /** 删一条:先把这张卡没写库的设置写掉,删完重读连接和这张卡的设置(后端会替用它的卡换连接) */
  deleteConn: (id: string) => Promise<void>;
  /** 查连接(不花钱) */
  checkConn: (id: string) => Promise<CheckResult>;
  /** 这张卡的 imagegen.setup;没选卡、还没读到是 null */
  setup: ImageSetup | null;
  /** 这张卡选的画图连接;没选、被删了是 null */
  conn: ImageConn | null;
  /** 换这张卡用的连接(模型、步数这些换成这张卡在那条连接下的那份) */
  setConn: (id: string | null) => void;
  /** 为什么画不了(connModel.drawBlockOf);能画是 null */
  drawBlock: DrawBlock;
  /** 这张卡在某条连接下的设置(测试出图、加完连接画一张试试) */
  configFor: (connId: string) => ImageGenConfig;
  /** 测试出图:固定一幕、这张卡的长相,不经过指导模型、不进相册;失败抛错。本地 SD 边画边回调 onFrame,signal 取消后不再收 */
  testDraw: (connId: string, onFrame?: (f: PreviewFrame) => void, signal?: AbortSignal) => Promise<TrialResult>;
  /** 正在问指导模型 / 正在画的 */
  jobs: readonly Job[];
  /** 画好一张就加一(相册跟着重读) */
  drawn: number;
  /**
   * 这张卡的相册(画过的图,包括「换一张」换掉的;新的在前,最多后端默认的 200 张);没选卡、还没读到是 null。
   * 设置里的「相册」页、卡编辑器的「AI 生成」那一栏共用这一份
   */
  album: readonly GeneratedImage[] | null;
  /** 相册读不到的原因 */
  albumError: string | null;
  reloadAlbum: () => Promise<void>;
  /** 删掉相册里的一条记录(收藏进 CG 包的那张还在);删成了返回 true,没删成已经提示过 */
  removeImage: (imageId: string) => Promise<boolean>;
  /** 视觉小说里「画」的小面板开着 */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** 游戏里点画笔、还一条画图连接都没有时,画笔上方那句「还没接画图 · 去加」 */
  nudge: boolean;
  setNudge: (open: boolean) => void;
  /** 游戏里开着的「加一条连接」小窗(从「去加」开的) */
  adding: boolean;
  setAdding: (open: boolean) => void;
  /** 发送右边的画笔(量它所在的对话框,小面板放在框上方) */
  anchor: HTMLElement | null;
  setAnchor: (el: HTMLElement | null) => void;
  /** 这条回复第 line 句显示的那张(marks.ts 的 markAt,带这次打开以来的显示记录);没有是 null */
  shownAt: (entry: ChatEntry, line: number) => VnImageMark | null;
  /** 光标这句的样子 → 给指导模型、出图的目标 */
  targetOf: (ctx: VnIllustrationContext) => DrawTarget | null;
  /** 只问指导模型(「先看提示词」);出错时提示并返回 null */
  plan: (target: DrawTarget, want: string, camera?: Camera) => Promise<PlanResult | null>;
  /** 照这幅画面画一张,挂在目标那句上;没画成返回 null */
  draw: (
    target: DrawTarget,
    o: {
      picture: Picture;
      title: string;
      description: string;
      size: SizeKey | { w: number; h: number };
      trigger?: 'manual' | 'auto' | 'reroll';
      /** 显示到这条回复的第几句(含);不传按默认句数收 */
      until?: number | null;
      /** 问指导模型花了几毫秒(PlanResult.ms),记进相册的用时;没问(换一张)不传 */
      planMs?: number | null;
    },
  ) => Promise<GeneratedImage | null>;
  /** 问指导模型再画(不看提示词) */
  drawNow: (target: DrawTarget, want: string, size: SizeKey, camera?: Camera) => Promise<void>;
  /** 这句显示的那张:换一张(同一幅画面换种子)/ 收起 / 收藏进 CG 包 */
  reroll: (entry: ChatEntry, mark: VnImageMark) => Promise<void>;
  hide: (entry: ChatEntry, mark: VnImageMark) => void;
  /** 收藏进这张卡的「AI 生图」CG 包;成了返回包名和 CG 名,没成(已经提示过)返回 null */
  keep: (imageId: string) => Promise<KeepResult | null>;
  /** 让指导模型读这张卡写外貌 */
  askLook: () => Promise<void>;
  notify: IllustrationsInput['notify'];
}

const linesFor = (lines: readonly VNLine[], from: number, to: number) =>
  lines.slice(from, to).map((l) => ({ speaker: l.speaker, text: l.text }));

/** 这条回复前面玩家说的那句(给指导模型当上下文) */
function userTextBefore(entries: readonly ChatEntry[], entryId: string): string {
  const i = entries.findIndex((e) => e.id === entryId);
  for (let k = i - 1; k >= 0; k--) if (entries[k].role === 'user') return currentText(entries[k]).slice(0, 600);
  return '';
}

export function useImageGen(input: IllustrationsInput): IllustrationsState {
  const { notify, cardId, cardName, chatId, charName, userName, entries, patchEntry, connections, onKept } = input;
  const connectionsChanged = useRef(input.onConnectionsChanged);
  connectionsChanged.current = input.onConnectionsChanged;
  const setConnectionModel = useCallback(
    async (connectionId: string, model: string) => {
      try {
        await debugApi.updateConnection(connectionId, { model });
      } catch (e) {
        notify('error', `切换模型失败: ${errText(e)}`);
      }
      connectionsChanged.current?.();
    },
    [notify],
  );
  const [modelsRefreshing, setModelsRefreshing] = useState(false);
  const refreshModels = useCallback(
    async (connectionId: string) => {
      setModelsRefreshing(true);
      try {
        const list = await debugApi.refreshConnectionModels(connectionId);
        notify('ok', `拉到 ${list.length} 个模型`);
      } catch (e) {
        notify('error', `模型列表拉取失败: ${errText(e)}`);
      } finally {
        setModelsRefreshing(false);
        connectionsChanged.current?.();
      }
    },
    [notify],
  );
  // ---- 这张卡的设置(imagegen.setup)+ 全局画风库:11-07 起全局 plugin.imagegen 只存画风库 ----
  const { library, changeLibrary } = useStyleLibrary(notify);
  const cardSetup = useCardSetup(cardId, library, changeLibrary, notify);
  const { config, changeConfig, setup } = cardSetup;
  const setupReady = setup !== null;

  // ---- 这张卡的长相那份(card_prefs 的 plugin.imagegen):换卡重读,改了停手半秒写库 ----
  // 等 imagegen.setup 读到再读:第一次读 setup 时,后端会把老字段(画风、画师串、不自动出图)从这里搬走
  const [cardPrefs, setCardPrefs] = useState<{ cardId: string; prefs: CardImagePrefs } | null>(null);
  const prefsLoaded = Boolean(cardId) && cardPrefs?.cardId === cardId;
  const prefs = cardPrefs && cardPrefs.cardId === cardId ? cardPrefs.prefs : DEFAULT_CARD_PREFS;
  useEffect(() => {
    if (!cardId || !setupReady) return;
    let live = true;
    debugApi
      .cardPrefs(cardId)
      .then((all) => {
        if (live) setCardPrefs({ cardId, prefs: normalizeCardPrefs(all[IMAGEGEN_SETTING_KEY]) });
      })
      .catch((e: unknown) => notify('error', `这张卡的生图设置读取失败: ${errText(e)}`));
    return () => {
      live = false;
    };
  }, [cardId, setupReady, notify]);
  const prefsTimer = useRef<number | undefined>(undefined);
  const changePrefs = useCallback(
    (next: CardImagePrefs) => {
      // 还没读到这张卡存的那份就别写:不然拿默认值盖掉
      if (!cardId || !prefsLoaded) return;
      setCardPrefs({ cardId, prefs: next });
      window.clearTimeout(prefsTimer.current);
      prefsTimer.current = window.setTimeout(() => {
        debugApi
          .putCardPref(cardId, IMAGEGEN_SETTING_KEY, { ...next })
          .catch((e: unknown) => notify('error', `这张卡的生图设置保存失败: ${errText(e)}`));
      }, 500);
    },
    [cardId, prefsLoaded, notify],
  );

  // ---- 默认说明书、NovelAI 账户(按连接存:两个 NovelAI 号各查各的) ----
  const [defaults, setDefaults] = useState<ImageGenDefaults | null>(null);
  useEffect(() => {
    imagegenApi.defaults().then(setDefaults, () => setDefaults(null));
  }, []);
  const [accounts, setAccounts] = useState<Record<string, NaiAccount>>({});
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const checkAccount = useCallback(async (connId: string) => {
    setAccountErrors((m) => without(m, connId));
    try {
      const a = await imagegenApi.connectionAccount(connId);
      setAccounts((m) => ({ ...m, [connId]: a }));
    } catch (e) {
      setAccounts((m) => without(m, connId));
      setAccountErrors((m) => ({ ...m, [connId]: errText(e) }));
    }
  }, []);

  // ---- 画图连接(全局一份,每张卡在 setup.conn 里选用哪条)----
  const [imageConns, setImageConns] = useState<ImageConn[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const reloadConns = useCallback(async () => {
    try {
      const [list, used] = await Promise.all([imagegenApi.connections(), imagegenApi.connectionUsage()]);
      setImageConns(list);
      setUsage(used);
    } catch (e) {
      notify('error', `画图连接读取失败: ${errText(e)}`);
    }
  }, [notify]);
  useEffect(() => {
    void reloadConns();
  }, [reloadConns]);
  const kinds = useMemo(() => kindsOf(imageConns), [imageConns]);
  const conn = imageConns?.find((c) => c.id === setup?.conn) ?? null;
  const drawBlock = drawBlockOf(imageConns, setup, Boolean(cardId));
  const { flush: flushSetup, reload: reloadSetup, setConn: setCardConn, configFor: cardConfigFor } = cardSetup;
  const setConn = useCallback((id: string | null) => setCardConn(id, kinds), [setCardConn, kinds]);
  const configFor = useCallback((id: string) => cardConfigFor(id, kinds), [cardConfigFor, kinds]);
  const [nudge, setNudge] = useState(false);
  const [adding, setAdding] = useState(false);
  const addConn = useCallback(
    async (body: ImageConnIn) => {
      const c = await imagegenApi.addConnection(body);
      await reloadConns();
      // 有连接了,画笔上方那句「还没接画图」不算数了(可能是从设置页加的)
      setNudge(false);
      return c;
    },
    [reloadConns],
  );
  const updateConn = useCallback(
    async (id: string, patch: ImageConnPatch) => {
      const c = await imagegenApi.updateConnection(id, patch);
      // 先用接口回的这条(改了地址 key 可能被清掉):下面重读失败,界面也不会还写着「已保存」
      setImageConns((list) => list && list.map((x) => (x.id === id ? c : x)));
      await reloadConns();
      return c;
    },
    [reloadConns],
  );
  const deleteConn = useCallback(
    async (id: string) => {
      // 先把这张卡没写库的那次写掉(不然写的时候连接已经没了,后端回 400)
      await flushSetup();
      await imagegenApi.deleteConnection(id);
      await reloadConns();
      // 后端会替选了它的卡换连接(只剩一条就用那条):重读这张卡的
      reloadSetup();
    },
    [flushSetup, reloadConns, reloadSetup],
  );
  const checkConn = useCallback((id: string): Promise<CheckResult> => imagegenApi.checkConnection(id), []);

  // ---- 进行中 ----
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drawn, setDrawn] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const jobKey = useRef(0);
  // 哪张什么时候画好 / 第一次显示在第几句(「最少显示」从那句算,这次新画的读过了那句也显示)
  const showLog = useRef<ShowLog>(newShowLog());
  const shownAt = useCallback(
    (entry: ChatEntry, line: number) => markAt(entry, line, config.holdLines, showLog.current),
    [config.holdLines],
  );
  const track = useCallback(async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
    const key = ++jobKey.current;
    setJobs((j) => [...j, { key, label, started: Date.now() }]);
    try {
      return await run();
    } finally {
      setJobs((j) => j.filter((x) => x.key !== key));
    }
  }, []);

  // ---- 相册:换卡、画好一张时重读;只收最后一次读的结果(连着画几张、刚换卡时先后会乱) ----
  const [album, setAlbum] = useState<{ cardId: string; images: GeneratedImage[] } | null>(null);
  const [albumError, setAlbumError] = useState<{ cardId: string; message: string } | null>(null);
  const albumSeq = useRef(0);
  const reloadAlbum = useCallback(async () => {
    if (!cardId) return;
    const seq = ++albumSeq.current;
    try {
      const images = await imagegenApi.images(cardId);
      if (seq !== albumSeq.current) return;
      setAlbum({ cardId, images });
      setAlbumError(null);
    } catch (e) {
      if (seq === albumSeq.current) setAlbumError({ cardId, message: errText(e) });
    }
  }, [cardId]);
  useEffect(() => {
    void reloadAlbum();
  }, [reloadAlbum, drawn]);
  const albumNow = album && album.cardId === cardId ? album.images : null;
  const albumErrorNow = albumError && albumError.cardId === cardId ? albumError.message : null;
  const removeImage = useCallback(
    async (imageId: string) => {
      try {
        await imagegenApi.deleteImage(imageId);
        setAlbum((a) => a && { ...a, images: a.images.filter((x) => x.id !== imageId) });
        return true;
      } catch (e) {
        notify('error', `删除失败: ${errText(e)}`);
        return false;
      }
    },
    [notify],
  );

  // 异步回来时对话可能已经换了:按最新的比
  const connId = setup?.conn ?? null;
  const connKind: ConnKind | null = conn?.kind ?? null;
  const latest = useRef({ cardId, chatId, entries, config, prefs, prefsLoaded, onKept, album: albumNow, drawBlock, connId, connKind });
  useEffect(() => {
    latest.current = { cardId, chatId, entries, config, prefs, prefsLoaded, onKept, album: albumNow, drawBlock, connId, connKind };
  });

  // ---- 本地 SD 的过程预览:发 /generate 之前开、画完关;插图的位置先显示它(模糊一点),真图出来替换掉 ----
  const [previews, setPreviews] = useState<LivePreview[]>([]);
  const previewStops = useRef(new Set<() => void>());
  const startPreview = useCallback((jobId: string, entryId: string, swipe: number, line: number) => {
    const close = openPreview(jobId, (f) =>
      setPreviews((list) => {
        const item: LivePreview = { ...f, jobId, entryId, swipe, line };
        return list.some((p) => p.jobId === jobId) ? list.map((p) => (p.jobId === jobId ? item : p)) : [...list, item];
      }),
    );
    const stop = () => {
      close();
      previewStops.current.delete(stop);
      setPreviews((list) => (list.some((p) => p.jobId === jobId) ? list.filter((p) => p.jobId !== jobId) : list));
    };
    previewStops.current.add(stop);
    return stop;
  }, []);
  // 换卡、卸载:连接都关掉,预览收起来(图照常画完进相册)
  useEffect(() => {
    const stops = previewStops.current;
    return () => {
      for (const stop of [...stops]) stop();
    };
  }, [cardId]);

  // 前后已经画过的图(给指导模型接上连贯,10-18 用户:「要知道之后画了什么、前面画了什么」):
  // 这条回复里画过的(收起的不算)+ 上一条有图的回复的最后一张。line 换成给它的那段剧情里的编号(offset = 那段从第几句开始)。
  // 标题和分镜相册里有就用,没有去后端读;读不到的那张不说
  const drawnNear = useCallback(async (entry: ChatEntry, offset: number): Promise<Drawn[]> => {
    const es = latest.current.entries;
    const index = es.findIndex((e) => e.id === entry.id);
    const here = es[index] ?? entry;
    const prev = lastImageBefore(es, index < 0 ? es.length : index);
    const marks = [
      ...(prev ? [{ id: prev.id, line: null }] : []),
      ...imagesOf(here)
        .filter((m) => !m.hidden)
        .map((m) => ({ id: m.id, line: m.line - offset })),
    ].slice(-8);
    const found = await Promise.all(
      marks.map(async ({ id, line }): Promise<Drawn | null> => {
        const img = latest.current.album?.find((x) => x.id === id) ?? (await imagegenApi.image(id).catch(() => undefined));
        if (!img) return null;
        const clothes = (img.picture.people ?? [])
          .filter((x) => x.clothes?.trim())
          .map((x) => `${x.who}穿 ${x.clothes}`)
          .join(';');
        return { line, title: img.title.slice(0, 40), description: img.description.slice(0, 300), clothes: clothes.slice(0, 300) };
      }),
    );
    return found.filter((d): d is Drawn => d !== null);
  }, []);

  const writerConnection = useCallback(() => {
    const id = latest.current.config.writer.connectionId;
    return id && connections.some((c) => c.id === id) ? id : null;
  }, [connections]);

  // 这张卡还没写长相、这次也带不了参考图:画之前让指导模型读卡写一版存下(一张卡这次打开只问一次,
  // 没写出来也照画)。10-11 有张日语卡没写长相,画出来五张五个样
  const lookAsked = useRef(new Set<string>());
  const ensureLook = useCallback(async (): Promise<CardImagePrefs> => {
    const { config: c, prefs: p } = latest.current;
    if (!cardId || !latest.current.prefsLoaded || p.look.trim() || usesReference(c, p) || lookAsked.current.has(cardId)) return p;
    lookAsked.current.add(cardId);
    try {
      const r = await track('记住她的样子', () =>
        imagegenApi.look({ card_id: cardId, connection_id: writerConnection(), thinking: c.writer.thinking }),
      );
      const next = withLook(p, r);
      changePrefs(next);
      latest.current = { ...latest.current, prefs: next };
      notify('ok', '这张卡还没写长相:指导模型读卡写了一版(生图设置的「角色」页,可以改)');
      return next;
    } catch (e) {
      notify('error', `这张卡还没写长相,指导模型也没写出来(照画): ${errText(e)}`);
      return p;
    }
  }, [cardId, changePrefs, notify, track, writerConnection]);

  const cast = useCallback(() => {
    const { config: c, prefs: p } = latest.current;
    return [
      { name: charName, gender: p.gender, look: p.look, outfit: p.outfit },
      { name: userName, gender: c.player.gender, look: c.player.look, outfit: c.player.outfit, player: true },
    ];
  }, [charName, userName]);

  const targetOf = useCallback(
    (ctx: VnIllustrationContext): DrawTarget | null =>
      ctx.entry ? { entry: ctx.entry, line: ctx.line, lines: ctx.lines, place: ctx.place } : null,
    [],
  );

  const placeText = (place: DrawTarget['place']) =>
    place ? (place.description ? `${place.label}(${place.description.slice(0, 200)})` : place.label) : '';

  const plan = useCallback(
    async (target: DrawTarget, want: string, camera?: Camera): Promise<PlanResult | null> => {
      await ensureLook();
      const { config: c, prefs: p, entries: es } = latest.current;
      const from = Math.max(0, target.line - BEFORE);
      const drawn = await drawnNear(target.entry, from);
      const index = es.findIndex((e) => e.id === target.entry.id);
      const req: PlanRequest = {
        mode: 'manual',
        connection_id: writerConnection(),
        thinking: c.writer.thinking,
        skill: c.skills.manual,
        cast: cast(),
        lines: linesFor(target.lines, from, target.line + 1 + AFTER),
        focus: target.line - from,
        place: placeText(target.place),
        want,
        user_text: userTextBefore(es, target.entry.id),
        drawn,
        note: noteBefore(es, index < 0 ? es.length : index),
        sfw_only: p.sfwOnly,
        camera: camera ?? c.camera,
      };
      try {
        const r = await track('构思画面', () => imagegenApi.plan(req));
        // 指导模型按给它的那一段编号:换成这条回复里的句号
        return { ...r, until: typeof r.until === 'number' ? from + r.until : null };
      } catch (e) {
        notify('error', `指导模型没写出来: ${errText(e)}`);
        return null;
      }
    },
    [cast, drawnNear, ensureLook, notify, track, writerConnection],
  );

  const draw = useCallback<ImageGenStore['draw']>(
    async (target, o) => {
      const chatAtStart = latest.current.chatId;
      // 这张卡还画不了(没有连接、没选、选的那种还不能出图)、构思的时候换了卡:说一声,不发请求
      const whyNot = () => {
        const now = latest.current;
        if (now.cardId !== cardId) return '已经换了角色卡,这张没画';
        return now.drawBlock ? BLOCK_TEXT[now.drawBlock] : null;
      };
      const blocked = whyNot();
      if (blocked) {
        notify('error', blocked);
        return null;
      }
      const p = await ensureLook();
      // 读长相要几秒:连接和设置都等它写完再取,这两样才是同一条连接的
      const stillBlocked = whyNot();
      if (stillBlocked) {
        notify('error', stillBlocked);
        return null;
      }
      const { config: c, connId: connectionId, connKind: kind } = latest.current;
      const size =
        typeof o.size === 'string' ? sizeOf(c, o.size, { width: window.innerWidth, height: window.innerHeight }) : o.size;
      const swipe = target.entry.swipeIndex;
      const jobId = kind === 'sdapi' ? newJobId() : undefined;
      // 预览在 /generate 之前开,一开始的几帧才收得到
      const stopPreview = jobId ? startPreview(jobId, target.entry.id, swipe, target.line) : undefined;
      try {
        let img: GeneratedImage;
        try {
          img = await track('Drawing', () =>
            imagegenApi.generate(
              buildGenerate(c, p, { cardId, charName, userName }, {
                chatId: chatAtStart,
                entryId: target.entry.id,
                swipe,
                line: target.line,
                trigger: o.trigger ?? 'manual',
                title: o.title,
                description: o.description,
                picture: o.picture,
                size,
                connectionId,
                planMs: o.planMs,
                connKind: kind,
                jobId,
              }),
            ),
          );
        } catch (e) {
          notify('error', `没画出来: ${errText(e)}`);
          return null;
        }
        setDrawn((n) => n + 1);
        if (!img.sha) return img;
        if (latest.current.chatId !== chatAtStart) {
          notify('ok', '图画好了,但已经换到别的对话:在插件页「AI 生图」的画过的图里');
          return img;
        }
        const until = typeof o.until === 'number' ? o.until : undefined;
        showLog.current.drawn.set(img.id, Date.now());
        patchEntry(target.entry.id, (e) => addImage(e, swipe, { line: target.line, until, id: img.id, sha: img.sha ?? '' }));
        return img;
      } finally {
        // 和上面挂图同一轮收掉:不会先闪回没有图的样子
        stopPreview?.();
      }
    },
    [cardId, charName, userName, ensureLook, notify, patchEntry, startPreview, track],
  );

  const drawNow = useCallback(
    async (target: DrawTarget, want: string, size: SizeKey, camera?: Camera) => {
      const p = await plan(target, want, camera);
      if (p) await draw(target, { picture: p.picture, title: p.title, description: p.description, size, until: p.until, planMs: p.ms });
    },
    [plan, draw],
  );

  const reroll = useCallback(
    async (entry: ChatEntry, mark: VnImageMark) => {
      let old: GeneratedImage;
      try {
        old = await imagegenApi.image(mark.id);
      } catch (e) {
        notify('error', `读不到这张图: ${errText(e)}`);
        return;
      }
      const picture: Picture = {
        scene: old.picture.scene ?? '',
        people: old.picture.people ?? [],
        nsfw: Boolean(old.picture.nsfw),
        pov: Boolean(old.picture.pov),
        composition: old.picture.composition ?? '',
      };
      const w = old.params.width ?? 1344;
      const h = old.params.height ?? 768;
      await draw(
        { entry, line: mark.line, lines: [], place: null },
        { picture, title: old.title, description: old.description, size: { w, h }, trigger: 'reroll', until: mark.until },
      );
    },
    [draw, notify],
  );

  const hide = useCallback(
    (entry: ChatEntry, mark: VnImageMark) =>
      patchEntry(entry.id, (e) => patchImage(e, e.swipeIndex, mark.id, (m) => ({ ...m, hidden: true }))),
    [patchEntry],
  );

  // 收藏完让 DebugApp 重读这张卡的 CG 绑定(第一次收藏会新建并绑上「AI 生图 · 卡名」包):
  // 游戏里马上选得到,卡编辑器左栏和「AI 生成」那一栏马上算进去(以前要重选这张卡)
  const keep = useCallback(
    async (imageId: string): Promise<KeepResult | null> => {
      try {
        const k = await imagegenApi.keep(imageId);
        setAlbum(
          (a) => a && { ...a, images: a.images.map((x) => (x.id === imageId ? { ...x, kept_asset_id: k.asset_id } : x)) },
        );
        latest.current.onKept?.();
        notify('ok', `收藏好了 · 放进「${k.pack_name}」CG 包,叫「${k.label}」,以后 AI 能直接选它`);
        return k;
      } catch (e) {
        notify('error', `收藏失败: ${errText(e)}`);
        return null;
      }
    },
    [notify],
  );

  const askLook = useCallback(async () => {
    if (!cardId) return;
    try {
      const r = await track('记住她的样子', () =>
        imagegenApi.look({ card_id: cardId, connection_id: writerConnection(), thinking: latest.current.config.writer.thinking }),
      );
      changePrefs(withLook(latest.current.prefs, r));
      notify(
        'ok',
        `指导模型写好了外貌(${(r.ms / 1000).toFixed(1)} 秒)${r.name_tag ? `,认出是 ${r.name_tag}` : ''},看看要不要改`,
      );
    } catch (e) {
      notify('error', `指导模型没写出来: ${errText(e)}`);
    }
  }, [cardId, changePrefs, notify, track, writerConnection]);

  // ---- 状态笔记:每条回复写完记一次(10-22 用户:总结每个人的长相、衣服、特殊的地方和发生了什么,下一张图照它画) ----
  const takeNote = useCallback(
    async (entry: ChatEntry, lines: readonly VNLine[], place: VnIllustrationContext['place']) => {
      const { config: c, entries: es, chatId: chatNow } = latest.current;
      const index = es.findIndex((e) => e.id === entry.id);
      const swipe = entry.swipeIndex;
      try {
        const r = await imagegenApi.note({
          connection_id: writerConnection(),
          thinking: c.writer.thinking,
          skill: c.skills.note,
          cast: cast(),
          lines: linesFor(lines, 0, NOTE_LINES),
          prev: noteBefore(es, index < 0 ? es.length : index),
          place: placeText(place),
          user_text: userTextBefore(es, entry.id),
        });
        if (latest.current.chatId !== chatNow) return;
        patchEntry(entry.id, (e) => withNote(e, swipe, { place: r.place, people: r.people, story: r.story }));
      } catch (e) {
        notify('error', `状态笔记没记成(下一张图照卡上写的参考画): ${errText(e)}`);
      }
    },
    [cast, notify, patchEntry, writerConnection],
  );

  // ---- 自动出图:回复写完以后让指导模型当导演判一次 ----
  const autoBusy = useRef(new Set<string>());
  const onReplyDone = useCallback(
    async (entry: ChatEntry, lines: readonly VNLine[], place: VnIllustrationContext['place']) => {
      const { config: c, prefs: p, entries: es, chatId: chatNow } = latest.current;
      // 没接画图、没选连接、选的那种还不能出图:自动出图不打扰
      if (latest.current.drawBlock || !cardId || lines.length === 0) return;
      const key = `${entry.id}:${entry.swipeIndex}`;
      if (autoBusy.current.has(key)) return;
      autoBusy.current.add(key);
      try {
        // 笔记和自动出图一起跑:自动出图用的是上一条回复的笔记
        void takeNote(entry, lines, place);
        if (!c.auto.enabled) return;
        const index = es.findIndex((e) => e.id === entry.id);
        const since = repliesSinceImage(es, index < 0 ? es.length : index);
        const drawn = await drawnNear(entry, 0);
        const req: PlanRequest = {
          mode: 'auto',
          connection_id: writerConnection(),
          thinking: c.writer.thinking,
          skill: c.skills.auto,
          cast: cast(),
          lines: linesFor(lines, 0, AUTO_LINES),
          place: placeText(place),
          user_text: userTextBefore(es, entry.id),
          since,
          drawn,
          note: noteBefore(es, index < 0 ? es.length : index),
          sfw_only: p.sfwOnly,
          camera: c.camera,
        };
        let r: PlanResult;
        try {
          r = await track('构思画面', () => imagegenApi.plan(req));
        } catch (e) {
          notify('error', `自动出图:指导模型出错了: ${errText(e)}`);
          return;
        }
        if (!r.draw || blockedByCooldown(since, c.auto.cooldown, r.importance)) return;
        if (latest.current.chatId !== chatNow) return;
        await draw(
          { entry, line: r.at ?? 0, lines, place },
          {
            picture: r.picture,
            title: r.title,
            description: r.description || r.reason,
            size: c.size,
            trigger: 'auto',
            until: r.until,
            planMs: r.ms,
          },
        );
      } finally {
        autoBusy.current.delete(key);
      }
    },
    [cardId, cast, draw, drawnNear, notify, takeNote, track, writerConnection],
  );

  // 测试出图:用这张卡在那条连接下的设置和长相画固定一幕(request.buildTrial)
  const testDraw = useCallback(
    async (id: string, onFrame?: (f: PreviewFrame) => void, signal?: AbortSignal): Promise<TrialResult> => {
      const kind = kinds[id];
      const jobId = kind === 'sdapi' && onFrame ? newJobId() : undefined;
      const stop = jobId && onFrame ? openPreview(jobId, onFrame) : undefined;
      if (stop) signal?.addEventListener('abort', stop, { once: true });
      try {
        return await imagegenApi.testConnection(
          id,
          buildTrial(
            configFor(id),
            latest.current.prefs,
            { cardId, charName, userName },
            id,
            { width: window.innerWidth, height: window.innerHeight },
            { connKind: kind, jobId },
          ),
        );
      } finally {
        stop?.();
      }
    },
    [configFor, kinds, cardId, charName, userName],
  );

  const store: ImageGenStore = useMemo(
    () => ({
      config,
      changeConfig,
      prefs,
      changePrefs,
      cardId,
      cardName,
      charName,
      userName,
      connections,
      setConnectionModel,
      refreshModels,
      modelsRefreshing,
      defaults,
      accounts,
      accountErrors,
      checkAccount,
      imageConns,
      usage,
      reloadConns,
      addConn,
      updateConn,
      deleteConn,
      checkConn,
      setup,
      conn,
      setConn,
      drawBlock,
      configFor,
      testDraw,
      jobs,
      drawn,
      album: albumNow,
      albumError: albumErrorNow,
      reloadAlbum,
      removeImage,
      panelOpen,
      setPanelOpen,
      nudge,
      setNudge,
      adding,
      setAdding,
      anchor,
      setAnchor,
      shownAt,
      targetOf,
      plan,
      draw,
      drawNow,
      reroll,
      hide,
      keep,
      askLook,
      notify,
    }),
    [
      config,
      changeConfig,
      prefs,
      changePrefs,
      cardId,
      cardName,
      charName,
      userName,
      connections,
      setConnectionModel,
      refreshModels,
      modelsRefreshing,
      defaults,
      accounts,
      accountErrors,
      checkAccount,
      imageConns,
      usage,
      reloadConns,
      addConn,
      updateConn,
      deleteConn,
      checkConn,
      setup,
      conn,
      setConn,
      drawBlock,
      configFor,
      testDraw,
      jobs,
      drawn,
      albumNow,
      albumErrorNow,
      reloadAlbum,
      removeImage,
      panelOpen,
      nudge,
      adding,
      anchor,
      shownAt,
      targetOf,
      plan,
      draw,
      drawNow,
      reroll,
      hide,
      keep,
      askLook,
      notify,
    ],
  );

  const panel = useMemo(
    () => ({
      ...IMAGEGEN_PANEL,
      inUse: imagegenInUse,
      // 抽屉里看的是另一张卡时,「这张卡」那几项读写那张卡(ConsoleSettings)
      render: (p: CartridgePanelProps) => (
        <Lazy>
          <ConsoleSettings store={store} card={p.card} place={p.game ? 'game' : 'console'} />
        </Lazy>
      ),
    }),
    [store],
  );

  // 卡编辑器的「AI 生成」那一栏:相册 + 收藏进 CG 包的那些(StudioAlbum.tsx)
  const studio: StudioIllustrations = useMemo(
    () => ({
      name: 'AI 生成',
      summary: (kept) => albumSummary(store.album, kept),
      render: (ctx) => (
        <Lazy>
          <StudioAlbum key={ctx.cardId} store={store} {...ctx} />
        </Lazy>
      ),
    }),
    [store],
  );

  // 局内菜单的「相册」页:按存档分组的画过的图(MenuAlbum.tsx),收藏、删除和卡编辑器那一栏是同一份
  const menuAlbum: MenuAlbumIllustrations = useMemo(
    () => ({
      render: (ctx) => (
        <Lazy>
          <MenuAlbum key={ctx.cardId} store={store} {...ctx} />
        </Lazy>
      ),
    }),
    [store],
  );

  const vn: VnIllustrations = useMemo(
    () => ({
      viewAt: (entry, line) => {
        const m = store.shownAt(entry, line);
        const live = previewAt(previews, entry.id, entry.swipeIndex, line);
        // 这句往后又有画好的新图时,那张优先
        if (live && !(m && m.line > live.line)) {
          return { key: `preview:${live.jobId}`, src: live.src, focus: 50, place: store.config.place, blur: previewBlur(live.progress) };
        }
        return m ? { key: m.id, src: apiUrl(`/api/blobs/${m.sha}?w=${SHOW_WIDTH}`), focus: 50, place: store.config.place } : null;
      },
      historyAt: (entry, line) => {
        const m = markInHistory(entry, line, store.config.holdLines);
        return m
          ? { key: m.id, thumb: apiUrl(`/api/blobs/${m.sha}?w=360`), full: apiUrl(`/api/blobs/${m.sha}?w=${SHOW_WIDTH}`) }
          : null;
      },
      button: (ctx) => <IgButton store={store} ctx={ctx} />,
      stage: (ctx) => <IgStage store={store} ctx={ctx} />,
      settings: () => (
        <Lazy>
          <ImageGenSettings store={store} place="game" />
        </Lazy>
      ),
      settingsName: 'AI 生图',
      onReplyDone: (entry, lines, place) => void onReplyDone(entry, lines, place),
      studio,
      album: menuAlbum,
    }),
    [store, previews, onReplyDone, studio, menuAlbum],
  );

  return useMemo(() => ({ panel, vn }), [panel, vn]);
}
