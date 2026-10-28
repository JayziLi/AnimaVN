import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickLabels } from './drawer/cardView';
import { CardPick } from './drawer/CardPick';
import type { SendView } from '../core/sendPlan';
import { debugApi } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import type { LibraryKind } from '../library/libraryModel';
import type { CartridgePanel, SpliceState } from '../plugins/cartridges';
import { enabledOnly } from '../plugins/common';
import { jevHealth, promptOverrides } from '../plugins/jev';
import type { JaHideControls } from '../plugins/jaHide';
import type { LangPluginConfig } from '../plugins/lang';
import { kindName, type BlockPluginId } from '../plugins/registry';
import { cgsOf, type SceneKindKey } from '../plugins/scene';
import type { SpritePluginConfig } from '../plugins/sprite';
import type { PluginSwitches } from '../plugins/switches';
import type { ScenePluginState } from '../plugins/useScenePlugin';
import type { SpriteLayoutState } from '../plugins/useSpriteLayout';
import type { SpritePackState } from '../plugins/useSpritePacks';
import type { VoicePluginState } from '../plugins/useVoicePlugin';
import type { SlotKey } from '../studio/types';
import type { TagKind } from '../vn/script';
import { useTimelineEngine } from '../vn/useTimelineEngine';
import './drawer/drawer.css';
import './drawer/drawerGame.css';
import { JEV_HEALTH_TEXT, ttsSummary, withTimeout, type TtsTest } from './drawer/globalStatus';
import { drawerNav, gameEnd, switchTargetOf } from './drawer/navModel';
import { NavIcon } from './drawer/navIcons';
import { PageSwap } from './drawer/skin';
import { DrawerSkinContext } from './drawer/skinContext';
import { betaShown, type PagePower } from './drawer/skinModel';
import { recentLines, recentSpriteWords } from './drawer/previewModel';
import { AutoFillPage } from './drawer/pages/AutoFillPage';
import { CartridgePage } from './drawer/pages/CartridgePage';
import { EnginePage } from './drawer/pages/EnginePage';
import { LangPage } from './drawer/pages/LangPage';
import type { BlockControls, PageLinks, PresetControls } from './drawer/pages/pageModel';
import { ScenePage } from './drawer/pages/ScenePage';
import { SpritePage } from './drawer/pages/SpritePage';
import { TtsServicePage } from './drawer/pages/TtsServicePage';
import { VoicePage } from './drawer/pages/VoicePage';
import { Tip } from './drawer/Tip';
import { useCardView } from './drawer/useCardView';
import { JevPage, type JevKindRow } from './JevPage';
import type { JevControls } from './JevSettings';
import { errText } from './pluginRunner';

/**
 * 插件抽屉(第 2 步第四版,plans/2026-10-16-asset-arch-step2-impl.md D4、D5)—— 调试台聊天区上一份、游戏菜单的插件页一份、
 * 卡编辑器里盖着的一份(PluginSheet),都是这个组件。
 *
 *   页头   插件 · PLUGINS、看哪张卡(只换抽屉里看的,不切调试台当前的卡)、关闭
 *   左栏   三组(components/drawer/navModel.ts):角色(立绘、语音、背景、BGM、CG、外语、AI 生图)/
 *          全局(Jev 标注、语音服务、自动补块、表情认法)/ 实验(实验组的卡带);圆点 = 看的那张卡在用,行尾 = 总开关或状态
 *   右边   一页一个文件(components/drawer/pages/):页头 → 常用 → 高级页签 → 底部链接
 *
 * 游戏菜单里那份(game)换纸面三栏的皮:左栏线条图标、中间页头 + 实机预览舞台、右边常用和高级(drawer/skin.tsx、drawerGame.css);
 * 调试台和卡编辑器里的 10-25 定了先不改。
 *
 * 设置都是全局一份,经 DebugApp 的 usePluginConfig 读写;按卡的东西(圆点、页头小标签、认词记录、配对表)
 * 按看的那张卡单独去读(useCardView)。素材本身(立绘表、场景包、声音……)在卡编辑器和素材管理里改。
 */

export type { BlockControls };

/** 有提示词块的插件(插件总表 plugins/registry.ts 里有 blockId 的那几行) */
export type PluginKey = BlockPluginId;
/** 抽屉里的一页:插件总表的 id、全局页(jev / tts / autofill / engine)、卡带那一页的 key */
export type PluginSection = string;
/** 打开到哪一页;有块的插件打开「高级」里的问法或提示词模板。nonce 变了就再跳一次 */
export interface PluginFocus {
  section: PluginSection;
  nonce: number;
}

interface Props extends PresetControls {
  /** 游戏菜单里那份:换纸面三栏的皮(调试台、卡编辑器不传) */
  game?: boolean;
  card: { id: string; name: string } | null;

  sprite: {
    config: SpritePluginConfig;
    onChangeConfig: (next: SpritePluginConfig) => void;
    block: BlockControls;
    /** 调试台当前那张卡的立绘包(载入示例以后让它重读) */
    packs: SpritePackState;
    /** 所有角色共用的构图:人物大小、头的高度 */
    layout: SpriteLayoutState;
  };
  /** 全部角色卡:「看哪张卡」的下拉、配对表写「被哪些卡用」 */
  /** 「看哪张卡」下拉的卡;note 是创作者注释,同名的几张靠它分开 */
  cards: { id: string; name: string; note?: string }[];

  /** 组装的设置(core.assembly):自动补块的总开关 */
  assembly: { autoFill: boolean; onChange: (on: boolean) => void };

  scene: ScenePluginState;
  sceneBlocks: Record<SceneKindKey, BlockControls>;
  /** 调试台当前那张卡的插件宏({{backgrounds}}、{{current_bg}} …),提示词模板页签预览用 */
  sceneMacros: Record<string, string>;

  voice: VoicePluginState;
  /** 拆句拼接(卡带的 useSplice):实验组里它那一页 */
  splice: SpliceState;
  /** 别的卡带的页(声线分档、AI 生图…);拆句拼接那一页在 splice 里 */
  panels?: readonly CartridgePanel[];
  /** 插件开关(plugins/switches.ts):左栏立绘 / 背景 / BGM / CG / AI 生图那几行的行尾 */
  switches: { value: PluginSwitches; onChange: (next: PluginSwitches) => void };

  /** 外语插件:日语配音、中文字幕;jaHide 是隐藏前文日语(当前对话) */
  lang: { config: LangPluginConfig; onChangeConfig: (next: LangPluginConfig) => void; jaHide?: JaHideControls };

  /** 当前聊天这张卡这次每个插件块怎么发(core/sendPlan.ts):外语页、自动补块页看;不传就不显示 */
  send?: SendView;

  /** Jev 标注:立绘 / 背景 / BGM / CG 每个插件可以选让 Jev 标(几个插件共用的设置在这里) */
  jev: JevControls;

  /** 调试台当前的对话:快速预览「最近几句」用(看的是当前那张卡时才有) */
  chat: { entries: readonly ChatEntry[]; kinds: readonly TagKind[]; userName: string };

  /** 底部链接:去卡编辑器的某一栏(给看的那张卡)、素材管理的某个页签、游戏设置(只在游戏菜单里) */
  links: {
    studio: (slot: SlotKey, cardId: string) => void;
    library: (tab: LibraryKind) => void;
    gameSettings?: () => void;
  };

  /** 从左栏点插件块跳过来:打开到这个插件,「高级」里的问法或提示词模板 */
  focus: PluginFocus | null;

  notify: (kind: 'ok' | 'error', message: string) => void;
  onClose: () => void;
}

/** 打开到哪一页:玩家台词不再单独一页,点它的块去「自动补块」 */
const pageOf = (section: PluginSection): string => (section === 'player' ? 'autofill' : section);

/** 抽屉打开时每台语音服务测一次;5 秒没回当连不上 */
const TTS_TEST_MS = 5000;

/** 等「高级」展开再滚过去闪一下 */
const FLASH_DELAY_MS = 120;

const isScene = (page: string): page is SceneKindKey => page === 'bg' || page === 'bgm' || page === 'cg';

function NavSwitch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  const what = label.replace(/开关$/, '');
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`dw-switch${on ? ' on' : ''}`}
      onClick={onToggle}
      title={on ? `关掉${what}(所有卡)` : `打开${what}(所有卡)`}
    >
      <span className="knob" aria-hidden="true" />
    </button>
  );
}

export function PluginsDrawer(outer: Props) {
  const { focus } = outer;
  const game = Boolean(outer.game);
  const [section, setSection] = useState<string>(pageOf(focus?.section ?? 'sprite'));
  // Jev 页(全局组):各插件页「Jev 还没填 key · 去填」都能点过去
  const props: Props = { ...outer, jev: { ...outer.jev, openPage: () => setSection('jev') } };
  /** 这次打开以后 Jev 测过没有:左栏行尾和 Jev 页页头都看它 */
  const [jevTestOk, setJevTestOk] = useState<boolean | null>(null);
  // 卡带的页:拆句拼接那一页 + 别的卡带给的(声线分档、AI 生图)
  const cartridgePanels = useMemo(
    () => [props.splice.panel, ...(props.panels ?? [])].filter((p): p is CartridgePanel => p !== null),
    [props.splice.panel, props.panels],
  );

  // ---- 看哪张卡:默认调试台当前的卡,当前卡变了跟着变;只换抽屉里看的,不切调试台 ----
  const currentId = props.card?.id ?? null;
  const cardLabels = useMemo(() => pickLabels(props.cards), [props.cards]);
  const [viewId, setViewId] = useState<string | null>(currentId);
  useEffect(() => setViewId(currentId), [currentId]);
  const viewCard = useMemo(() => {
    if (!viewId) return null;
    if (props.card && props.card.id === viewId) return props.card;
    return props.cards.find((c) => c.id === viewId) ?? null;
  }, [viewId, props.card, props.cards]);
  const view = useCardView(viewCard, props.voice.profiles);
  // 游戏菜单里:「看哪张卡」放进菜单面板的页头右边(设计稿 whole.js 的 topSlot),三栏上面不再多占一行
  const rootRef = useRef<HTMLDivElement>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!game) return;
    const head = rootRef.current?.closest('.vn-menu-pagein')?.querySelector<HTMLElement>(':scope > .vn-menu-head') ?? null;
    setHeadSlot(head);
  }, [game]);
  const isCurrent = viewCard !== null && viewCard.id === currentId;
  // 看的是当前卡时,调试台这边换了包、绑了声音(卡编辑器、游戏里改的)就重读一次,圆点和小标签跟着变
  const currentAssets = [
    props.sprite.packs.packId,
    enabledOnly(props.sprite.packs.sprites).length,
    props.scene.binding.bg.join(),
    props.scene.binding.bgm.join(),
    props.scene.cgPackIds.join(),
    props.scene.assets.length,
    props.voice.binding.main,
  ].join('|');
  const seenAssets = useRef(currentAssets);
  const { reload: reloadView } = view;
  useEffect(() => {
    if (seenAssets.current === currentAssets) return;
    seenAssets.current = currentAssets;
    if (isCurrent) reloadView();
  }, [currentAssets, isCurrent, reloadView]);

  // ---- 语音服务:打开抽屉时每台测一次(并发),结果这次打开期间留着,左栏和语音服务页共用 ----
  const [ttsTests, setTtsTests] = useState<Record<string, TtsTest>>({});
  const testTts = useCallback((id: string) => {
    setTtsTests((t) => ({ ...t, [id]: 'pending' }));
    withTimeout(debugApi.testTtsConnection(id), TTS_TEST_MS, `${TTS_TEST_MS / 1000} 秒没回`)
      .then((r) => setTtsTests((t) => ({ ...t, [id]: { ok: true, ms: r.ms } })))
      .catch((e: unknown) => setTtsTests((t) => ({ ...t, [id]: { ok: false, error: errText(e) } })));
  }, []);
  const ttsTried = useRef(new Set<string>());
  useEffect(() => {
    for (const c of props.voice.connections) {
      if (ttsTried.current.has(c.id)) continue;
      ttsTried.current.add(c.id);
      testTts(c.id);
    }
  }, [props.voice.connections, testTts]);

  // 「哪几路交给 Jev」:和插件页切的是同一份全局配置;「详情 →」去那个插件页。
  // 玩家台词没有自己的模式了(跟着立绘交给 Jev,提示词线 P3),不列
  const sw = props.switches.value;
  const jevRows: JevKindRow[] = [
    {
      kind: 'sprite',
      name: kindName('sprite'),
      mode: props.sprite.config.mode,
      onChangeMode: (mode) => props.sprite.onChangeConfig({ ...props.sprite.config, mode }),
      powerOn: sw.sprite,
      onDetail: () => setSection('sprite'),
    },
    ...(['bg', 'bgm', 'cg'] as const).map(
      (kind): JevKindRow => ({
        kind,
        name: kindName(kind),
        mode: props.scene.configs[kind].mode,
        onChangeMode: (mode) => props.scene.changeConfig(kind, { ...props.scene.configs[kind], mode }),
        powerOn: sw[kind],
        noAssets: kind === 'cg' ? cgsOf(enabledOnly(props.scene.assets)).length === 0 : undefined,
        onDetail: () => setSection(kind),
      }),
    ),
  ];
  const jevHealthNow = jevHealth({
    hasKey: Boolean(props.jev.keyStatus?.has_key),
    anyJevMode: jevRows.some((r) => r.mode === 'jev'),
    testOk: jevTestOk,
    last: props.jev.lastStats,
  });

  const engine = useTimelineEngine();
  const nav = drawerNav({
    panels: cartridgePanels,
    card: view.facts,
    switches: sw,
    voiceOn: props.voice.config.enabled,
    status: {
      jev: JEV_HEALTH_TEXT[jevHealthNow],
      tts: ttsSummary(props.voice.connections, ttsTests).text,
      autoFill: props.assembly.autoFill,
      engine,
    },
  });
  const flip = (rowId: string) => {
    const target = switchTargetOf(rowId, cartridgePanels);
    if (!target) return;
    if (target.kind === 'switch') props.switches.onChange({ ...sw, [target.key]: !sw[target.key] });
    else if (target.kind === 'voice') props.voice.changeConfig({ ...props.voice.config, enabled: !props.voice.config.enabled });
    else {
      const t = cartridgePanels.find((p) => p.key === target.key)?.toggle;
      t?.set(!t.on);
    }
  };
  // 打开到的那一页不在左栏(卡带没装、拿掉了):回到立绘
  const known = nav.some((g) => g.rows.some((r) => r.id === section));
  const page = known ? section : 'sprite';
  // 游戏皮:这一页的插件开关挪到页头名字旁(左栏只看在不在用)
  const pageEnd = nav.flatMap((g) => g.rows).find((r) => r.id === page)?.end;
  const power: PagePower | null =
    game && pageEnd?.kind === 'switch' ? { on: pageEnd.on, label: pageEnd.label, onToggle: () => flip(page) } : null;
  const skin = { game, page, power };

  // ---- 从预设里点插件块过来:开那一页的「高级」,AI 写开「提示词模板」、Jev 标开「问法」,再滚过去闪一下 ----
  const [advOpen, setAdvOpen] = useState<{ page: string; tab: string; nonce: number } | null>(null);
  const modeOf = (pg: string) => (pg === 'sprite' ? props.sprite.config.mode : isScene(pg) ? props.scene.configs[pg].mode : null);
  const modeRef = useRef(modeOf);
  useEffect(() => {
    modeRef.current = modeOf;
  });
  useEffect(() => {
    if (!focus) return;
    const pg = pageOf(focus.section);
    setSection(pg);
    const mode = modeRef.current(pg);
    const tab = pg === 'lang' ? 'block' : mode === 'jev' ? 'ask' : mode === 'ai' ? 'template' : null;
    if (tab) setAdvOpen({ page: pg, tab, nonce: focus.nonce });
    let clear: number | undefined;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`pl-prompt-${pg}`);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.classList.add('pl-flash');
      el.querySelector('textarea')?.focus({ preventScroll: true });
      clear = window.setTimeout(() => el.classList.remove('pl-flash'), 1600);
    }, FLASH_DELAY_MS);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(clear);
    };
  }, [focus]);
  const advFor = (pg: string) => (advOpen && advOpen.page === pg ? { tab: advOpen.tab, nonce: advOpen.nonce } : null);

  const viewName = viewCard?.name || '这张卡';
  // 快速预览:最近几句台词 / AI 写过的表情词(只有当前那张卡有对话);发给 Jev 的改过的问法
  const { entries: chatEntries, kinds: chatKinds, userName } = props.chat;
  const recent = useMemo(
    () =>
      isCurrent && viewCard
        ? {
            lines: recentLines(chatEntries, { charName: viewCard.name, userName, kinds: chatKinds }),
            words: recentSpriteWords(chatEntries, chatKinds),
          }
        : { lines: [], words: [] },
    [isCurrent, viewCard, chatEntries, chatKinds, userName],
  );
  const jevPrompts = promptOverrides(
    props.jev.config,
    props.sprite.config,
    props.scene.configs.bg,
    props.scene.configs.bgm,
    props.scene.configs.cg,
  );

  /**
   * 素材直接换(10-25/26 用户定):插件页立绘 / 语音 / 背景 / BGM / CG 五页「常用」第一行一个下拉框,
   * 下拉里是库里全部的包,不分「她的 / 别人的」,选了马上整个替换掉这张卡这一样原来的绑定(声音也不留备用)。
   * 看的是当前卡就走插件状态(游戏里马上换上);看别的卡就直接写库再重读那张卡。后台接口本来就是整组替换
   * (PUT sprite-packs / voices / scene-packs / cg-packs),没加新接口。
   */
  const replaceSprite = async (packId: string) => {
    if (!viewCard) return;
    try {
      // 直接写库再重读(不走 sprite.packs.setPacks:它写失败时自己弹过提示又吞掉异常,这里会重复弹)
      await debugApi.setCardSpritePacks(viewCard.id, [packId], packId);
      if (isCurrent) await props.sprite.packs.reload();
      else view.reload();
      await props.sprite.packs.refreshPacks();
      const name = props.sprite.packs.packs.find((x) => x.id === packId)?.name ?? packId;
      props.notify('ok', `「${viewName}」换上「${name}」`);
    } catch (e) {
      props.notify('error', `换立绘包失败: ${errText(e)}`);
    }
  };
  const replaceVoice = async (id: string | null) => {
    if (!viewCard) return;
    const target = { main: id, extras: [] };
    try {
      if (isCurrent) {
        if (!(await props.voice.bind(target))) return;
      } else {
        await debugApi.setCardVoices(viewCard.id, target);
        view.reload();
      }
      const name = id ? (props.voice.profiles.find((v) => v.id === id)?.name ?? id) : null;
      props.notify('ok', name ? `「${viewName}」换上「${name}」` : `「${viewName}」不念了`);
    } catch (e) {
      props.notify('error', `换音色失败: ${errText(e)}`);
    }
  };
  const replaceScenePack = async (kind: 'bg' | 'bgm', packId: string) => {
    if (!viewCard) return;
    try {
      // 背景 / BGM 各挂各的:先读这张卡现在两边各绑哪些,只换要换的那一边
      const current = isCurrent ? props.scene.binding : await debugApi.getCardScenePacks(viewCard.id);
      const next = kind === 'bg' ? { bg: [packId], bgm: current.bgm } : { bg: current.bg, bgm: [packId] };
      // 直接写库再重读(不走 scene.bindScene:它写失败时自己弹过提示又吞掉异常,这里会重复弹)
      await debugApi.setCardScenePacks(viewCard.id, next);
      if (isCurrent) await props.scene.reloadCard();
      else view.reload();
      await props.scene.refreshPacks();
      const name = props.scene.packs.find((x) => x.id === packId)?.name ?? packId;
      props.notify('ok', `「${viewName}」换上「${name}」`);
    } catch (e) {
      props.notify('error', `绑定场景包失败: ${errText(e)}`);
    }
  };
  const replaceCgPack = async (packId: string) => {
    if (!viewCard) return;
    try {
      await debugApi.setCardCgPacks(viewCard.id, [packId]);
      if (isCurrent) await props.scene.reloadCard();
      else view.reload();
      await props.scene.refreshCgPacks();
      const name = props.scene.cgPacks.find((x) => x.id === packId)?.name ?? packId;
      props.notify('ok', `「${viewName}」换上「${name}」`);
    } catch (e) {
      props.notify('error', `绑定 CG 包失败: ${errText(e)}`);
    }
  };

  const panel = cartridgePanels.find((p) => p.key === page) ?? null;
  const preset: PresetControls = {
    presetName: props.presetName,
    presetDirty: props.presetDirty,
    presetBusy: props.presetBusy,
    onSavePreset: props.onSavePreset,
  };
  const links: PageLinks = {
    studio: (slot) => {
      if (viewCard) props.links.studio(slot, viewCard.id);
    },
    library: props.links.library,
    gameSettings: props.links.gameSettings,
  };

  return (
    <div ref={rootRef} className={`conn-drawer dw${game ? ' dw-game' : ''}${game && headSlot ? ' dw-pick-out' : ''}`}>
      {game &&
        headSlot &&
        createPortal(
          <CardPick cards={props.cards} labels={cardLabels} viewId={viewId} currentId={currentId} onPick={setViewId} />,
          headSlot,
        )}
      <div className="dw-head">
        {/* 游戏菜单里:菜单面板已经有页头「插件」,这里不再重复大标题,只剩右边「看哪张卡 + ?」一行 */}
        {!game && (
          <>
            <span className="dw-title">插件 · PLUGINS</span>
            <Tip k="drawer" />
          </>
        )}
        <span className="dw-flex" />
        <label className="dw-pick">
          <span>看哪张卡</span>
          <select
            className="dw-pick-select"
            value={viewId ?? ''}
            disabled={props.cards.length === 0}
            onChange={(e) => setViewId(e.target.value || null)}
          >
            {!viewId && <option value="">还没有卡</option>}
            {props.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {cardLabels.get(c.id) ?? (c.name || '(未命名)')}
                {c.id === currentId ? '(当前)' : ''}
              </option>
            ))}
          </select>
        </label>
        {game && <Tip k="drawer" />}
        <button type="button" className="dw-close" onClick={props.onClose} aria-label="关闭插件抽屉" title="关闭">
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="dw-main">
        <nav className="dw-nav" aria-label="插件">
          {nav.map((g) => (
            <div key={g.id} className="dw-group" role="group" aria-label={g.title}>
              <div className="dw-group-head">
                <span className="dw-group-name">{g.title}</span>
                <span className="dw-flex" />
                {/* 游戏皮照设计稿只留「角色 ?」,「圆点 = 在用」收进问号 */}
                {g.id === 'role' && game && <Tip k="nav" />}
                {g.id === 'role' && !game && (
                  <span className="dw-group-note">
                    <span className="dw-note-text">{`圆点 = ${viewName}在用`}</span>
                    <Tip k="nav" />
                  </span>
                )}
                {g.id === 'global' && (
                  <span className="dw-group-note">
                    <span className="dw-note-text">所有卡共用</span>
                  </span>
                )}
              </div>
              {g.rows.map((r) => {
                const end = game ? gameEnd(r) : null;
                return (
                  <div key={r.id} className={`dw-row${page === r.id ? ' on' : ''}${end?.kind === 'off' ? ' is-off' : ''}`}>
                    <button
                      type="button"
                      className="dw-row-main"
                      aria-current={page === r.id ? 'page' : undefined}
                      onClick={() => setSection(r.id)}
                    >
                      {game && <NavIcon id={r.id} />}
                      {!game && r.inUse !== null && (
                        <span
                          className={`dw-dot${r.inUse ? ' on' : ''}`}
                          role="img"
                          aria-label={r.inUse ? `${viewName}在用` : `${viewName}没在用`}
                        />
                      )}
                      <span className="dw-row-name">{r.name}</span>
                      {betaShown(game, r.id, r.beta) && <span className="dw-beta">BETA</span>}
                    </button>
                    {!game && r.end?.kind === 'switch' && <NavSwitch on={r.end.on} label={r.end.label} onToggle={() => flip(r.id)} />}
                    {!game && r.end?.kind === 'text' && <span className="dw-row-end">{r.end.text}</span>}
                    {end?.kind === 'text' && <span className="dw-row-end">{end.text}</span>}
                    {end?.kind === 'off' && <span className="dw-row-end">关</span>}
                    {end?.kind === 'dot' && (
                      <span
                        className={`dw-dot${end.on ? ' on' : ''}`}
                        role="img"
                        aria-label={end.on ? `${viewName}在用` : `${viewName}没在用`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`dw-body${game ? ' dw-body-3col' : ''}`}>
          <DrawerSkinContext.Provider value={skin}>
            <PageSwap key={page} game={game}>
              {page === 'jev' && (
                <JevPage
                  jev={props.jev}
                  rows={jevRows}
                  testOk={jevTestOk}
                  onTested={setJevTestOk}
                  notify={props.notify}
                  cardName={props.card?.name}
                />
              )}
              {page === 'tts' && (
                <TtsServicePage
                  voice={props.voice}
                  tests={ttsTests}
                  onTest={testTts}
                  notify={props.notify}
                  onLibrary={() => props.links.library('voice')}
                />
              )}
              {page === 'autofill' && (
                <AutoFillPage autoFill={props.assembly.autoFill} onChange={props.assembly.onChange} send={props.send} viewCard={viewCard} />
              )}
              {page === 'engine' && <EnginePage />}
              {page === 'sprite' && (
                <SpritePage
                  view={view}
                  card={viewCard}
                  config={props.sprite.config}
                  onChangeConfig={props.sprite.onChangeConfig}
                  stage={props.sprite.layout.stage}
                  onChangeStage={props.sprite.layout.changeStage}
                  block={props.sprite.block}
                  preset={preset}
                  jev={props.jev}
                  fixedEmotion={props.voice.config.fixedEmotion}
                  cards={props.cards}
                  links={links}
                  advOpen={advFor('sprite')}
                  recent={recent}
                  jevPrompts={jevPrompts}
                  userName={userName}
                  notify={props.notify}
                  onSpritesChanged={() => {
                    if (isCurrent) void props.sprite.packs.reload();
                  }}
                  packs={props.sprite.packs.packs}
                  onReplacePack={replaceSprite}
                />
              )}
              {isScene(page) && (
                <ScenePage
                  key={page}
                  kind={page}
                  view={view}
                  card={viewCard}
                  isCurrent={isCurrent}
                  scene={props.scene}
                  block={props.sceneBlocks[page]}
                  preset={preset}
                  jev={props.jev}
                  currentMacros={props.sceneMacros}
                  cards={props.cards}
                  links={links}
                  advOpen={advFor(page)}
                  recentLines={recent.lines}
                  jevPrompts={jevPrompts}
                  userName={userName}
                  notify={props.notify}
                  stage={props.sprite.layout.stage}
                  scenePacks={props.scene.packs}
                  cgPacks={props.scene.cgPacks}
                  onReplaceScenePack={replaceScenePack}
                  onReplaceCgPack={replaceCgPack}
                />
              )}
              {page === 'voice' && (
                <VoicePage
                  view={view}
                  card={viewCard}
                  isCurrent={isCurrent}
                  voice={props.voice}
                  cards={props.cards}
                  links={links}
                  advOpen={advFor('voice')}
                  notify={props.notify}
                  stage={props.sprite.layout.stage}
                  recentLines={recent.lines}
                  onReplaceVoice={replaceVoice}
                />
              )}
              {page === 'lang' && (
                <LangPage
                  view={view}
                  card={viewCard}
                  config={props.lang.config}
                  onChangeConfig={props.lang.onChangeConfig}
                  send={props.send}
                  jaHide={props.lang.jaHide}
                  links={links}
                  advOpen={advFor('lang')}
                  stage={props.sprite.layout.stage}
                />
              )}
              {panel && <CartridgePage panel={panel} facts={view.facts} card={viewCard} profiles={props.voice.profiles} links={links} />}
            </PageSwap>
          </DrawerSkinContext.Provider>
        </div>
      </div>
    </div>
  );
}
