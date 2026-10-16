/**
 * 生图卡带给内核的状态(cartridges.ts 的 IllustrationsState):插件页「生图 BETA」那一页,
 * 和视觉小说要的几样(某句显示哪张图、「画」按钮、舞台上那一层、回复写完时的自动出图)。
 * 两边用同一份状态(ImageGenStore):插件页里一改,视觉小说里下一张就跟着。
 *
 * 一张图的流程:指导模型(/plan)写画面 → NovelAI(/generate)画 → 记号挂在那条消息上(marks.ts),
 * DebugApp 照常把消息写库。同一个 NovelAI 账号一次只能画一张,后端排队;这里只记「正在画几张」给画面看。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, debugApi } from '../../lib/api';
import { currentText, type ChatEntry, type VnImageMark } from '../../lib/chatEntry';
import type { VNLine } from '../../vn/script';
import { SCENE_WIDTHS } from '../../generated/contracts';
import type {
  IllustrationsInput,
  IllustrationsState,
  StudioIllustrations,
  VnIllustrationContext,
  VnIllustrations,
} from '../cartridges';
import { usePluginConfig } from '../usePluginConfig';
import {
  imagegenApi,
  type GeneratedImage,
  type ImageGenDefaults,
  type ImageGenStatus,
  type KeepResult,
  type LookIn,
  type NaiAccount,
  type Picture,
  type PlanRequest,
  type PlanResult,
} from './api';
import {
  artistsFor,
  DEFAULT_CARD_PREFS,
  drawModel,
  drawStyle,
  DEFAULT_IMAGEGEN_CONFIG,
  IMAGEGEN_SETTING_KEY,
  normalizeCardPrefs,
  normalizeImageGenConfig,
  sizeOf,
  usesReference,
  withLook,
  type Camera,
  type CardImagePrefs,
  type ImageGenConfig,
  type SizeKey,
} from './config';
import { ImageGenSettings } from './ImageGenSettings';
import { addImage, blockedByCooldown, markAt, patchImage, repliesSinceImage } from './marks';
import { StudioAlbum } from './StudioAlbum';
import { albumSummary } from './studioAlbumModel';
import { IgButton, IgStage } from './VnControls';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const COARSE = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const SHOW_WIDTH = COARSE ? SCENE_WIDTHS.touch : SCENE_WIDTHS.desktop;
/** 手动画时给指导模型看光标前后几句 */
const BEFORE = 10;
// 后面几句给指导模型判断画面到哪一句结束(只判断,不画)
const AFTER = 8;
/** 自动判时整条回复最多给几句 */
const AUTO_LINES = 80;

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
  config: ImageGenConfig;
  changeConfig: (next: ImageGenConfig) => void;
  /** 这张卡自己的那份;没选卡时是默认值 */
  prefs: CardImagePrefs;
  changePrefs: (next: CardImagePrefs) => void;
  cardId: string | null;
  cardName: string;
  charName: string;
  userName: string;
  connections: IllustrationsInput['connections'];
  status: ImageGenStatus | null;
  saveToken: (token: string) => Promise<void>;
  defaults: ImageGenDefaults | null;
  /** NovelAI 账户(等级、Anlas、V5 额度条);没查过 / 查不到是 null,查不到时 accountError 是原因 */
  account: NaiAccount | null;
  accountError: string | null;
  checkAccount: () => Promise<void>;
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
  /** 发送右边的画笔(量它所在的对话框,小面板放在框上方) */
  anchor: HTMLElement | null;
  setAnchor: (el: HTMLElement | null) => void;
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
  const { config, change: changeConfig } = usePluginConfig<ImageGenConfig>(
    IMAGEGEN_SETTING_KEY,
    normalizeImageGenConfig,
    DEFAULT_IMAGEGEN_CONFIG,
    notify,
    { load: '生图设置读取失败', save: '生图设置保存失败' },
  );

  // ---- 这张卡的那份(card_prefs 的 plugin.imagegen):换卡重读,改了停手半秒写库 ----
  const [cardPrefs, setCardPrefs] = useState<{ cardId: string; prefs: CardImagePrefs } | null>(null);
  const prefs = cardPrefs && cardPrefs.cardId === cardId ? cardPrefs.prefs : DEFAULT_CARD_PREFS;
  useEffect(() => {
    if (!cardId) return;
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
  }, [cardId, notify]);
  const prefsTimer = useRef<number | undefined>(undefined);
  const changePrefs = useCallback(
    (next: CardImagePrefs) => {
      if (!cardId) return;
      setCardPrefs({ cardId, prefs: next });
      window.clearTimeout(prefsTimer.current);
      prefsTimer.current = window.setTimeout(() => {
        debugApi
          .putCardPref(cardId, IMAGEGEN_SETTING_KEY, { ...next })
          .catch((e: unknown) => notify('error', `这张卡的生图设置保存失败: ${errText(e)}`));
      }, 500);
    },
    [cardId, notify],
  );

  // ---- token、默认说明书 ----
  const [status, setStatus] = useState<ImageGenStatus | null>(null);
  const [defaults, setDefaults] = useState<ImageGenDefaults | null>(null);
  useEffect(() => {
    imagegenApi.status().then(setStatus, () => setStatus(null));
    imagegenApi.defaults().then(setDefaults, () => setDefaults(null));
  }, []);
  const [account, setAccount] = useState<NaiAccount | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const checkAccount = useCallback(async () => {
    setAccountError(null);
    try {
      setAccount(await imagegenApi.account());
    } catch (e) {
      setAccount(null);
      setAccountError(errText(e));
    }
  }, []);
  const saveToken = useCallback(
    async (token: string) => {
      try {
        setStatus(await imagegenApi.putToken(token));
        notify('ok', token.trim() ? 'NovelAI token 已保存' : 'NovelAI token 已删除');
      } catch (e) {
        notify('error', `保存 token 失败: ${errText(e)}`);
      }
    },
    [notify],
  );

  // ---- 进行中 ----
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drawn, setDrawn] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const jobKey = useRef(0);
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
  const latest = useRef({ chatId, entries, config, prefs, onKept });
  useEffect(() => {
    latest.current = { chatId, entries, config, prefs, onKept };
  });

  const writerConnection = useCallback(() => {
    const id = latest.current.config.writer.connectionId;
    return id && connections.some((c) => c.id === id) ? id : null;
  }, [connections]);

  // 这张卡还没写长相、这次也带不了参考图:画之前让指导模型读卡写一版存下(一张卡这次打开只问一次,
  // 没写出来也照画)。10-11 日语版 Wikira 没写长相,画出来五张五个样
  const lookAsked = useRef(new Set<string>());
  const ensureLook = useCallback(async (): Promise<CardImagePrefs> => {
    const { config: c, prefs: p } = latest.current;
    if (!cardId || p.look.trim() || usesReference(c, p) || lookAsked.current.has(cardId)) return p;
    lookAsked.current.add(cardId);
    try {
      const r = await track('写外貌', () =>
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

  const looks = useCallback((p: CardImagePrefs): Record<string, LookIn> => {
    const c = latest.current.config;
    const player: LookIn = {
      tags: c.player.look,
      outfit: c.player.outfit,
      negative: c.player.negative,
      gender: c.player.gender,
      player: true,
    };
    // 指导模型偶尔把玩家写成「玩家」「你」:都当玩家
    return {
      [charName]: {
        tags: p.look,
        outfit: p.outfit,
        negative: p.negative,
        gender: p.gender,
        name_tag: p.nameTag,
        // 模型用不了参考图时后端自己跳过,这里照卡上的设置带
        ref: p.ref.kind === 'off' ? null : { kind: p.ref.kind, id: p.ref.id, style: p.ref.style },
      },
      [userName]: player,
      玩家: player,
      你: player,
    };
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
        sfw_only: p.sfwOnly,
        camera: camera ?? c.camera,
      };
      try {
        const r = await track('想画面', () => imagegenApi.plan(req));
        // 指导模型按给它的那一段编号:换成这条回复里的句号
        return { ...r, until: typeof r.until === 'number' ? from + r.until : null };
      } catch (e) {
        notify('error', `指导模型没写出来: ${errText(e)}`);
        return null;
      }
    },
    [cast, ensureLook, notify, track, writerConnection],
  );

  const draw = useCallback<ImageGenStore['draw']>(
    async (target, o) => {
      const chatAtStart = latest.current.chatId;
      const p = await ensureLook();
      const c = latest.current.config;
      const size =
        typeof o.size === 'string' ? sizeOf(c, o.size, { width: window.innerWidth, height: window.innerHeight }) : o.size;
      const style = drawStyle(c, p);
      const swipe = target.entry.swipeIndex;
      let img: GeneratedImage;
      try {
        img = await track('画画中', () =>
          imagegenApi.generate({
            card_id: cardId,
            chat_id: chatAtStart,
            entry_id: target.entry.id,
            swipe,
            line: target.line,
            trigger: o.trigger ?? 'manual',
            title: o.title,
            description: o.description,
            picture: o.picture,
            looks: looks(p),
            style: { tags: style.tags, negative: style.negative, artists: artistsFor(c, p) },
            model: drawModel(c, p),
            width: size.w,
            height: size.h,
            steps: c.steps,
            scale: c.scale,
            sampler: c.sampler,
            noise_schedule: c.noise,
            cfg_rescale: c.rescale,
            variety: c.variety,
            ...(c.seed !== null ? { seed: c.seed } : {}),
            quality: c.quality,
            uc_preset: c.ucPreset,
            uc: c.uc,
            sfw_only: p.sfwOnly,
            allow_paid: c.allowPaid,
          }),
        );
      } catch (e) {
        notify('error', `没画出来: ${errText(e)}`);
        return null;
      }
      setDrawn((n) => n + 1);
      if (!img.sha) return img;
      if (latest.current.chatId !== chatAtStart) {
        notify('ok', '图画好了,但已经换到别的对话:在插件页「生图」的画过的图里');
        return img;
      }
      const until = typeof o.until === 'number' ? o.until : undefined;
      patchEntry(target.entry.id, (e) => addImage(e, swipe, { line: target.line, until, id: img.id, sha: img.sha ?? '' }));
      return img;
    },
    [cardId, ensureLook, looks, notify, patchEntry, track],
  );

  const drawNow = useCallback(
    async (target: DrawTarget, want: string, size: SizeKey, camera?: Camera) => {
      const p = await plan(target, want, camera);
      if (p) await draw(target, { picture: p.picture, title: p.title, description: p.description, size, until: p.until });
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
        notify('ok', `收藏进 CG 包「${k.pack_name}」,名字叫「${k.label}」(游戏里 AI / Jev 能选它了)`);
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
      const r = await track('写外貌', () =>
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

  // ---- 自动出图:回复写完以后让指导模型当导演判一次 ----
  const autoBusy = useRef(new Set<string>());
  const onReplyDone = useCallback(
    async (entry: ChatEntry, lines: readonly VNLine[], place: VnIllustrationContext['place']) => {
      const { config: c, prefs: p, entries: es, chatId: chatNow } = latest.current;
      if (!c.auto.enabled || p.autoOff || !status?.has_token || !cardId || lines.length === 0) return;
      const key = `${entry.id}:${entry.swipeIndex}`;
      if (autoBusy.current.has(key)) return;
      autoBusy.current.add(key);
      try {
        const index = es.findIndex((e) => e.id === entry.id);
        const since = repliesSinceImage(es, index < 0 ? es.length : index);
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
          sfw_only: p.sfwOnly,
          camera: c.camera,
        };
        let r: PlanResult;
        try {
          r = await track('导演在看', () => imagegenApi.plan(req));
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
          },
        );
      } finally {
        autoBusy.current.delete(key);
      }
    },
    [cardId, cast, draw, notify, status?.has_token, track, writerConnection],
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
      status,
      saveToken,
      defaults,
      account,
      accountError,
      checkAccount,
      jobs,
      drawn,
      album: albumNow,
      albumError: albumErrorNow,
      reloadAlbum,
      removeImage,
      panelOpen,
      setPanelOpen,
      anchor,
      setAnchor,
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
      status,
      saveToken,
      defaults,
      account,
      accountError,
      checkAccount,
      jobs,
      drawn,
      albumNow,
      albumErrorNow,
      reloadAlbum,
      removeImage,
      panelOpen,
      anchor,
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
      key: 'imagegen',
      title: '生图',
      beta: true,
      after: 'cg',
      power: 'illustrations' as const,
      render: () => <ImageGenSettings store={store} place="console" />,
    }),
    [store],
  );

  // 卡编辑器的「AI 生成」那一栏:相册 + 收藏进 CG 包的那些(StudioAlbum.tsx)
  const studio: StudioIllustrations = useMemo(
    () => ({
      name: 'AI 生成',
      summary: (kept) => albumSummary(store.album, kept),
      render: (ctx) => <StudioAlbum key={ctx.cardId} store={store} {...ctx} />,
    }),
    [store],
  );

  const vn: VnIllustrations = useMemo(
    () => ({
      viewAt: (entry, line) => {
        const m = markAt(entry, line, store.config.hold);
        return m ? { key: m.id, src: apiUrl(`/api/blobs/${m.sha}?w=${SHOW_WIDTH}`), focus: 50, place: store.config.place } : null;
      },
      button: (ctx) => <IgButton store={store} ctx={ctx} />,
      stage: (ctx) => <IgStage store={store} ctx={ctx} />,
      settings: () => <ImageGenSettings store={store} place="game" />,
      settingsName: '生图',
      onReplyDone: (entry, lines, place) => void onReplyDone(entry, lines, place),
      studio,
    }),
    [store, onReplyDone, studio],
  );

  return useMemo(() => ({ panel, vn }), [panel, vn]);
}
