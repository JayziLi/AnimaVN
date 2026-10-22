/**
 * 素材管理页(照画布第四版 V4Library):调试台里的全屏页,和卡编辑器一样盖在调试台、视觉小说上面。
 * 入口:调试台顶栏「素材」。管理工具的样子,配色照调试台的中性灰。
 * 游戏菜单的「素材」页是同一个组件的 embedded 模式:嵌在菜单内容区里(没有「←」和标题,菜单页头写了「素材」),
 * 不是对话框、不管 Esc(Esc 照旧关菜单),配色跟菜单里别的页(vn.css 的 .vn-library-embed);右栏默认收起。
 *
 *   顶栏   ← · 「素材管理」· 页签(立绘 / 声音 / 背景 / BGM / CG 带个数 + 导入记录)· 搜索 · 主按钮「导入」
 *   提示条 导完没有卡可开时才有(importer/ImportBanner,和卡编辑器素材页的一样;没认出来的文件点「查看」就地选类型)
 *   左栏   这一类的包(不按角色分组)+ 排序 + 筛选 + 底部占用空间、清理(LibraryAside);
 *          声音页多一排「新建声音」「导入 refs.json」(声音不走拖进来导入;导入的小框是 VoiceImportDialog)
 *   中间 + 右栏   选中那个包的编辑器(卡编辑器里同一套,不带卡;LibraryEditor),顶上一行是 LibraryHeader
 *   左右两栏能拖宽、能收起(照调试台,studio/sidePanels.tsx;10-16 用户:窗口小时中间被挤得太窄)
 *   导入记录   ImportJobs(整次撤销)
 *
 * 开在哪(页签、选中哪个)由 DebugApp 管(LibraryRoute),这里只画和回报。改包里的东西经 PackSync 通知 DebugApp,
 * 当前卡绑着的包游戏里马上换;改卡的绑定用外面给的 CardBindingWriter(当前卡走 hook)。
 * Esc 或左上角「←」关;上面还开着卡编辑器(点了卡名)时 Esc 先关卡编辑器。embedded 时都没有。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  debugApi,
  type ClassifyKind,
  type ImportJobSummary,
  type ImportUndoPreview,
  type StorageStatus,
  type TtsConnection,
  type VoiceProfile,
} from '../lib/api';
import { EnvBadge } from '../components/EnvBadge';
import { packExportItem } from '../components/export/packExport';
import { ImportBanner } from '../importer/ImportBanner';
import type { SpriteStage } from '../plugins/spriteLayout';
import { Icon, type IconName } from '../studio/icons';
import { PanelRail, PanelResizer } from '../studio/panelParts';
import { DEFAULT_PANELS, InspectorCollapse, useSidePanels, type SidePanelOptions } from '../studio/sidePanels';
import { Btn, ConfirmDialog, IconBtn, Inspector, PromptDialog } from '../studio/ui';
import type { ImportNotice, Notify, PackSync, SlotKey } from '../studio/types';
import { describeClean } from '../vn/dataTab';
import { BindDialog, type BindResult, type LibraryCard } from './BindDialog';
import { ImportJobs } from './ImportJobs';
import { LibraryAside } from './LibraryAside';
import { LibraryEditor } from './LibraryEditor';
import { LibraryHeader } from './LibraryHeader';
import {
  directBindings,
  forgetCardBackgrounds,
  forgetScenePacks,
  libraryApi,
  type CardBindingWriter,
} from './libraryApi';
import {
  KIND_INFO,
  KIND_ORDER,
  deleteNotes,
  duplicateGroups,
  filterChips,
  filterItems,
  sortItems,
  sortOptions,
  storageSummary,
  type LibraryFilter,
  type LibraryItem,
  type LibraryKind,
  type LibraryRoute,
  type LibraryTab,
  type LibraryUsage,
  type SortBy,
} from './libraryModel';
import { newVoiceName } from './voiceCreate';
import { VoiceImportDialog } from './VoiceImportDialog';
import '../studio/studio.css';
import './library.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TAB_ICONS: Record<LibraryKind, IconName> = {
  sprite: 'person',
  voice: 'mic',
  bg: 'scene',
  bgm: 'music',
  cg: 'cg',
};

/** 背景、BGM 是同一批场景包的两边:改名、删、复制一个,两边的列表都要重读 */
const related = (kind: LibraryKind): LibraryKind[] => (kind === 'bg' || kind === 'bgm' ? ['bg', 'bgm'] : [kind]);
/** PackSync.packs 认的那一类 */
const packKind = (kind: LibraryKind) => (kind === 'bg' || kind === 'bgm' ? 'scene' : kind);

/** 包改名走各自的接口 */
function renameApi(kind: LibraryKind, id: string, name: string): Promise<unknown> {
  if (kind === 'sprite') return debugApi.updateSpritePack(id, { name });
  if (kind === 'cg') return debugApi.updateCgPack(id, { name });
  if (kind === 'voice') return debugApi.updateVoice(id, { name });
  return debugApi.updateScenePack(id, { name });
}

/**
 * 游戏菜单里:两栏的宽、收没收起另记一份;右栏默认收起(菜单里地方小)。
 * 菜单左栏 208 + 内容区左右边距 24×2 不归这一页(vn.css 的 .vn-menu、.vn-menu-body)
 */
const MENU_PANELS: SidePanelOptions = { defaults: { ...DEFAULT_PANELS, rightOpen: false }, reserved: 208 + 48 };

/** 浮在上面、自己管 Esc 的东西(「?」、「⋯」、确认框)开着时,Esc 交给它们 */
const OWN_LAYERS = '.st-layer';

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return (
    t instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(t.type)
  );
}

type Dialog =
  | { kind: 'rename'; item: LibraryItem }
  | { kind: 'duplicate'; item: LibraryItem }
  | { kind: 'delete'; item: LibraryItem; usage: LibraryUsage }
  | { kind: 'bind'; item: LibraryItem }
  | { kind: 'clean' }
  | { kind: 'voiceImport' }
  | null;

export interface AssetLibraryProps {
  route: LibraryRoute;
  onRoute: (next: LibraryRoute) => void;
  /** 「←」、Esc:关这一页(embedded 时没有,不用给) */
  onClose?: () => void;
  /** 嵌在游戏菜单的「素材」页里:没有「←」和标题、不是对话框、不管 Esc,尺寸跟着菜单内容区 */
  embedded?: boolean;
  /** 全部角色卡(绑定框、卡名) */
  cards: readonly LibraryCard[];
  /** 所有角色共用的构图(useSpriteLayout 的 stage) */
  stage: SpriteStage;
  sync: PackSync;
  notify: Notify;
  /** 写卡的绑定;不给 = 直接写库。DebugApp 给的:当前这张卡走 hook,游戏里马上换 */
  bindings?: CardBindingWriter;
  /** 「绑定到角色卡…」改了这些卡的绑定 */
  onBindingsChanged?: (kind: LibraryKind, cardIds: string[]) => void;
  /** 删了一个包 / 声音:当前卡绑着的话让它忘掉 */
  onDeleted?: (kind: LibraryKind, id: string) => void;
  /** 点了卡名:打开那张卡的卡编辑器素材页的这一栏 */
  onOpenCard: (cardId: string, slot: SlotKey) => void;
  /** 撤销了一次导入:卡列表、当前卡要重读 */
  onUndone?: (result: ImportUndoPreview) => void;
  /** 顶栏「导入」:选文件交给导入器(不带目标卡;文件夹选不了,拖进来可以)。不给 = 按钮灰着 */
  onImport?: () => void;
  /** 导完没有卡可开(只导了包)时顶栏下面那一行提示,和卡编辑器素材页的同一个(ImportBanner);给了就要给 onNoticeClose */
  notice?: ImportNotice | null;
  onNoticeClose?: () => void;
  /** 提示条里认领一个没认出来的文件(成功以后外面换上新的 notice);认领完这里重读列表和导入记录 */
  onClassifyUnknown?: (path: string, kind: ClassifyKind) => Promise<void>;
  /** 上面盖着卡编辑器(点卡名打开的):关掉回到这一页时重读列表,那边可能改了绑定、包里的东西 */
  covered?: boolean;
  /** 导完一批就加一(导入器不经过这一页):变了就重读列表和导入记录。这一页里撤销、认领完自己会重读 */
  reloadKey?: number;
}

export function AssetLibrary(props: AssetLibraryProps) {
  const { route, onRoute, onClose, cards, stage, sync, notify } = props;
  const embedded = props.embedded ?? false;
  const writer = props.bindings ?? directBindings;
  const kind: LibraryKind | null = route.tab === 'jobs' ? null : route.tab;
  const panels = useSidePanels(embedded ? 'library.menu.panels' : 'library.panels', embedded ? MENU_PANELS : undefined);
  const { toggle: togglePanel } = panels;
  const collapseRight = useCallback(() => togglePanel('right'), [togglePanel]);

  // ---------------------------------------------------------------- 数据

  const [lists, setLists] = useState<Partial<Record<LibraryKind, LibraryItem[]>>>({});
  const [listErrors, setListErrors] = useState<Partial<Record<LibraryKind, string>>>({});
  const loadKind = useCallback(async (k: LibraryKind) => {
    try {
      const items = await libraryApi.list(k);
      setLists((prev) => ({ ...prev, [k]: items }));
      setListErrors((prev) => ({ ...prev, [k]: undefined }));
    } catch (e) {
      setListErrors((prev) => ({ ...prev, [k]: errText(e) }));
    }
  }, []);

  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const loadStorage = useCallback(async () => {
    try {
      setStorage(await debugApi.storage());
    } catch {
      // 旧后端没有这个接口:底部只是不显示总数
    }
  }, []);

  const [jobs, setJobs] = useState<ImportJobSummary[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const loadJobs = useCallback(async () => {
    try {
      setJobs(await debugApi.importJobs());
      setJobsError(null);
    } catch (e) {
      setJobsError(errText(e));
    }
  }, []);

  // 立绘的差分名(搜索用)要不要重读:包里的东西改过、整页重读过以后,下次搜的时候再读一遍
  const labelsStale = useRef(false);
  const reloadAll = useCallback(() => {
    for (const k of KIND_ORDER) void loadKind(k);
    void loadStorage();
    void loadJobs();
    labelsStale.current = true;
    // 别处(卡编辑器、插件页、导入)可能改过场景包、卡的绑定
    forgetScenePacks();
    forgetCardBackgrounds();
  }, [loadKind, loadStorage, loadJobs]);
  useEffect(reloadAll, [reloadAll]);
  const covered = props.covered ?? false;
  const wasCovered = useRef(covered);
  useEffect(() => {
    if (wasCovered.current && !covered) reloadAll();
    wasCovered.current = covered;
  }, [covered, reloadAll]);
  // 外面导完了一批(拖进窗口、点「导入」,不管导到哪):列表、导入记录重读
  const reloadKey = props.reloadKey ?? 0;
  const seenReload = useRef(reloadKey);
  useEffect(() => {
    if (seenReload.current === reloadKey) return;
    seenReload.current = reloadKey;
    reloadAll();
  }, [reloadKey, reloadAll]);

  // 编辑器里改了包的内容:张数、大小、封面可能变了,停手一会儿再重读这一类的列表
  const kindRef = useRef(kind);
  useEffect(() => {
    kindRef.current = kind;
  });
  const editTimer = useRef<number | null>(null);
  const onEdited = useCallback(() => {
    labelsStale.current = true;
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    editTimer.current = window.setTimeout(() => {
      editTimer.current = null;
      if (kindRef.current) for (const k of related(kindRef.current)) void loadKind(k);
      void loadStorage();
    }, 800);
  }, [loadKind, loadStorage]);
  useEffect(
    () => () => {
      if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    },
    [],
  );

  const reloadAfterChange = (k: LibraryKind) => {
    for (const r of related(k)) void loadKind(r);
    void loadStorage();
    if (k === 'bg' || k === 'bgm') forgetScenePacks();
    sync.packs(packKind(k));
  };

  // ---------------------------------------------------------------- 列表:排序、筛选、搜索

  const [query, setQuery] = useState('');
  const [sorts, setSorts] = useState<Partial<Record<LibraryKind, SortBy>>>({});
  const [filters, setFilters] = useState<Partial<Record<LibraryKind, LibraryFilter>>>({});
  const cardNames = useMemo(() => new Map(cards.map((c) => [c.id, c.name])), [cards]);

  // 立绘包也按差分名搜:搜的时候才把每套的差分读一遍(一个包一次请求),改过差分以后下次搜再读
  const [labels, setLabels] = useState<Map<string, string[]>>(() => new Map());
  const labelsAsked = useRef(false);
  const sprites = lists.sprite;
  const searching = query.trim() !== '';
  useEffect(() => {
    if (kind !== 'sprite' || !searching || !sprites) return;
    if (labelsAsked.current && !labelsStale.current) return;
    labelsAsked.current = true;
    labelsStale.current = false;
    // 读到就收下(读的时候列表重读了也一样用;下一轮由 labelsStale 决定要不要再读)
    void Promise.all(
      sprites.map((p) =>
        debugApi
          .listSprites(p.id)
          .then((list): [string, string[]] => [p.id, list.flatMap((s) => [s.label, ...(s.aliases ?? [])])])
          .catch((): [string, string[]] => [p.id, []]),
      ),
    ).then((pairs) => setLabels(new Map(pairs)));
  }, [kind, searching, sprites]);

  const all = kind ? (lists[kind] ?? null) : null;
  const chips = useMemo(() => (kind && all ? filterChips(kind, all) : []), [kind, all]);
  const wantedFilter = kind ? (filters[kind] ?? 'all') : 'all';
  // 那个筛选没了(重复的删光了)就回到全部
  const filter: LibraryFilter = chips.some((c) => c.key === wantedFilter) ? wantedFilter : 'all';
  const sort: SortBy = kind ? (sorts[kind] ?? sortOptions(kind)[0]) : 'name';
  const visible = useMemo(
    () => (all ? sortItems(filterItems(all, filter, query, { cardNames, labels }), sort) : []),
    [all, filter, query, cardNames, labels, sort],
  );
  const selected = (route.id ? all?.find((i) => i.id === route.id) : undefined) ?? visible[0] ?? null;
  const groups = useMemo(() => (all ? duplicateGroups(all) : []), [all]);
  const sameAs = selected ? (groups.find((g) => g.some((i) => i.id === selected.id)) ?? []).filter((i) => i.id !== selected.id) : [];
  const summary = useMemo(() => storageSummary(all ?? [], storage), [all, storage]);

  // 每个页签记着上次选的那个,切回来还是它
  const lastIds = useRef<Partial<Record<LibraryTab, string | null>>>({});
  useEffect(() => {
    lastIds.current[route.tab] = route.id;
  }, [route]);
  const select = (id: string) => kind && onRoute({ tab: kind, id });

  // ---------------------------------------------------------------- 操作

  const [dialog, setDialog] = useState<Dialog>(null);
  const [asking, setAsking] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const rename = async (k: LibraryKind, item: LibraryItem, name: string): Promise<boolean> => {
    if (name === item.name) return true;
    try {
      await renameApi(k, item.id, name);
      reloadAfterChange(k);
      return true;
    } catch (e) {
      notify('error', `改名失败: ${errText(e)}`);
      return false;
    }
  };

  const duplicate = async (k: LibraryKind, item: LibraryItem, name: string | null) => {
    if (k === 'voice') return;
    try {
      const copy = await libraryApi.duplicate(k, item.id, name ?? undefined);
      reloadAfterChange(k);
      onRoute({ tab: k, id: copy.id });
      notify('ok', `已创建副本「${copy.name}」(和原来的共用文件,不多占地方)`);
    } catch (e) {
      notify('error', `创建副本失败: ${errText(e)}`);
    }
  };

  const askDelete = async (k: LibraryKind, item: LibraryItem) => {
    setAsking(true);
    try {
      setDialog({ kind: 'delete', item, usage: await libraryApi.usage(k, item.id) });
    } catch (e) {
      notify('error', `读不到谁在用它: ${errText(e)}`);
    } finally {
      setAsking(false);
    }
  };

  const remove = async (k: LibraryKind, item: LibraryItem) => {
    setDialog(null);
    try {
      await libraryApi.remove(k, item.id);
      notify('ok', `已删除「${item.name}」`);
      onRoute({ tab: k, id: null });
      forgetCardBackgrounds();
      reloadAfterChange(k);
      props.onDeleted?.(k, item.id);
    } catch (e) {
      notify('error', `删除失败: ${errText(e)}`);
      reloadAfterChange(k);
    }
  };

  const afterBind = (k: LibraryKind, result: BindResult) => {
    setDialog(null);
    if (result.changed.length > 0) {
      for (const r of related(k)) void loadKind(r);
      forgetCardBackgrounds(result.changed);
      props.onBindingsChanged?.(k, result.changed);
    }
    if (result.failed.length > 0) {
      notify('error', `有 ${result.failed.length} 张卡没改成:${result.failed.map((f) => `「${f.name}」${f.error}`).join(';')}`);
    } else if (result.changed.length > 0) {
      notify('ok', `已改好 ${result.changed.length} 张卡的绑定`);
    }
  };

  const clean = async () => {
    setDialog(null);
    setCleaning(true);
    try {
      const r = await debugApi.cleanStorage();
      notify('ok', `清理完成:${describeClean(r)}`);
      void loadStorage();
    } catch (e) {
      notify('error', `清理失败: ${errText(e)}`);
    } finally {
      setCleaning(false);
    }
  };

  // ---- 声音页:新建一个空声音、导入 refs.json(声音不走拖进来导入) ----

  // 新建用第一台语音服务,导入的小框里能选;进声音页时读一遍(插件页可能刚加了一台)
  const [ttsConns, setTtsConns] = useState<TtsConnection[] | null>(null);
  useEffect(() => {
    if (kind !== 'voice') return;
    let alive = true;
    debugApi
      .listTtsConnections()
      .then((list) => alive && setTtsConns(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kind]);
  const [creatingVoice, setCreatingVoice] = useState(false);
  // 导入合进了正开着的那个声音:编辑器换个 key 重读(它只在换声音时读)
  const [voiceRev, setVoiceRev] = useState(0);
  const voiceNames = (lists.voice ?? []).map((i) => i.name);

  /** 新建 / 导入完:列表重读好再选中它;筛选、搜索放开,不然左边列表里看不到它 */
  const showVoice = async (id: string) => {
    await loadKind('voice');
    sync.packs('voice');
    setFilters((s) => ({ ...s, voice: 'all' }));
    setQuery('');
    onRoute({ tab: 'voice', id });
  };

  const createVoice = async () => {
    setCreatingVoice(true);
    try {
      const conn = (ttsConns ?? (await debugApi.listTtsConnections()))[0];
      if (!conn) {
        notify('error', '还没有语音服务:先在插件页的「语音服务」里添加一台');
        return;
      }
      const p = await debugApi.createVoice({ name: newVoiceName(voiceNames), connection_id: conn.id });
      await showVoice(p.id);
      notify('ok', `已新建「${p.name}」`);
    } catch (e) {
      notify('error', `新建声音失败: ${errText(e)}`);
    } finally {
      setCreatingVoice(false);
    }
  };

  const voiceImported = async (p: VoiceProfile) => {
    setDialog(null);
    setVoiceRev((n) => n + 1);
    await showVoice(p.id);
    notify('ok', `已导入「${p.name}」,${p.emotions.length} 种情绪`);
  };

  const voiceActions = (
    <>
      <Btn small icon="plus" disabled={creatingVoice} onClick={() => void createVoice()}>
        {creatingVoice ? '新建中…' : '新建声音'}
      </Btn>
      <Btn small icon="upload" onClick={() => setDialog({ kind: 'voiceImport' })}>
        导入 refs.json
      </Btn>
    </>
  );

  const undone = (result: ImportUndoPreview) => {
    reloadAll();
    for (const k of ['sprite', 'scene', 'cg'] as const) sync.packs(k);
    props.onUndone?.(result);
  };

  // 提示条里认领了一个文件:可能多了「补充」包、包里多了一张,导入记录的数也变了 —— 都重读
  const classifyUnknown = props.onClassifyUnknown;
  const classify = classifyUnknown
    ? async (path: string, k: ClassifyKind) => {
        await classifyUnknown(path, k);
        reloadAll();
      }
    : undefined;

  // ---------------------------------------------------------------- Esc、焦点

  const root = useRef<HTMLDivElement | null>(null);
  // 全屏打开时焦点挪进来;菜单里不抢(键盘还在菜单上)
  useEffect(() => {
    if (!embedded) root.current?.focus();
  }, [embedded]);
  // 窄屏时页签是一排横着滚的,当前页签可能在屏幕外 —— 换页签时把它滚进来
  useEffect(() => {
    root.current?.querySelector('.lib-tab[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route.tab]);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    // 菜单里的 Esc 归菜单(关菜单),这里不听
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      if (document.querySelector(OWN_LAYERS)) return;
      // 上面还盖着卡编辑器(从卡名点进去的):交给它
      const roots = document.querySelectorAll('.st-root');
      if (roots[roots.length - 1] !== root.current) return;
      e.preventDefault();
      if (isTextField(e.target)) return;
      closeRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [embedded]);

  // ---------------------------------------------------------------- 画

  const tabButton = (tab: LibraryTab, label: string, icon: IconName | null, count?: number) => (
    <button
      key={tab}
      type="button"
      className="st-tab lib-tab"
      aria-current={route.tab === tab ? 'page' : undefined}
      onClick={() => onRoute({ tab, id: lastIds.current[tab] ?? null })}
    >
      {icon && <Icon name={icon} size={15} />}
      {label}
      {count !== undefined && <span className="lib-tab-count">{count}</span>}
    </button>
  );

  const header = (
    <header className="st-header lib-header">
      {/* 菜单里:页头已经写了「素材」,关菜单走左边的「返回游戏」;测试环境的角标视觉小说自己有一个 */}
      {!embedded && (
        <>
          <IconBtn icon="back" label="返回" onClick={() => onClose?.()} />
          <EnvBadge />
          <span className="lib-title">素材管理</span>
        </>
      )}
      <nav className="st-tabs lib-tabs" aria-label="素材类型">
        {KIND_ORDER.map((k) => tabButton(k, KIND_INFO[k].tab, TAB_ICONS[k], lists[k]?.length))}
        {tabButton('jobs', '导入记录', null)}
      </nav>
      <span className="st-flex" />
      {kind && (
        <label className="lib-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            aria-label="搜索"
            placeholder={kind === 'sprite' ? '搜索名称、角色、差分' : '搜索名称、角色'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <span className="lib-import" title={props.onImport ? '选文件导入(文件夹直接拖进来)' : '拖进来导入马上就能用'}>
        <Btn kind="primary" icon="upload" disabled={!props.onImport} onClick={props.onImport}>
          导入
        </Btn>
      </span>
    </header>
  );

  let body;
  if (!kind) {
    body = (
      <ImportJobs
        jobs={jobs}
        error={jobsError}
        highlight={route.id}
        onUndone={undone}
        onReload={() => void loadJobs()}
        notify={notify}
      />
    );
  } else {
    const info = KIND_INFO[kind];
    const menu = selected
      ? [
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', item: selected }) },
          // 声音没有「创建副本」
          ...(kind === 'voice' ? [] : [{ label: '创建副本', onClick: () => setDialog({ kind: 'duplicate', item: selected }) }]),
          packExportItem(kind, selected.id, notify),
          {
            label: asking ? '读取中…' : '删除',
            danger: true,
            divider: true,
            disabled: asking,
            onClick: () => void askDelete(kind, selected),
          },
        ]
      : [];
    const jobTitle = selected?.import_job_id ? (jobs?.find((j) => j.id === selected.import_job_id)?.title ?? null) : null;
    body = (
      <>
        <LibraryAside
          kind={kind}
          total={all?.length ?? 0}
          items={visible}
          loading={all === null && !listErrors[kind]}
          selectedId={selected?.id ?? null}
          onSelect={select}
          sort={sort}
          onSort={(by) => setSorts((s) => ({ ...s, [kind]: by }))}
          chips={chips}
          filter={filter}
          onFilter={(f) => setFilters((s) => ({ ...s, [kind]: f }))}
          query={query}
          storage={summary}
          cleaning={cleaning}
          onClean={() => setDialog({ kind: 'clean' })}
          onCollapse={() => togglePanel('left')}
          actions={kind === 'voice' ? voiceActions : undefined}
        />
        {/* 收起的那栏换成竖条;分隔线浮在栏和中间的交界上(都只在宽屏有,library.css) */}
        {!panels.leftOpen && <PanelRail side="left" label={info.pack} onOpen={() => togglePanel('left')} />}
        <InspectorCollapse.Provider value={collapseRight}>
          <div className="st-slot">
            {selected ? (
              <LibraryEditor
                key={`${kind}:${selected.id}${kind === 'voice' ? `:${voiceRev}` : ''}`}
                kind={kind}
                item={selected}
                firstCardName={selected.card_ids.map((id) => cardNames.get(id)).find(Boolean) ?? null}
                stage={stage}
                sync={sync}
                notify={notify}
                onEdited={onEdited}
                header={
                  <LibraryHeader
                    kind={kind}
                    item={selected}
                    cardNames={cardNames}
                    sameAs={sameAs}
                    jobTitle={jobTitle}
                    onRename={(name) => rename(kind, selected, name)}
                    onBind={() => setDialog({ kind: 'bind', item: selected })}
                    onOpenCard={(cardId) => props.onOpenCard(cardId, selected.generated ? 'ai' : info.slot)}
                    onSelect={select}
                    onOpenJob={(jobId) => onRoute({ tab: 'jobs', id: jobId })}
                    menu={menu}
                  />
                }
              />
            ) : (
              <>
                <main className="st-main">
                  <div className="st-empty">
                    <span className="st-empty-icon">
                      <Icon name={TAB_ICONS[kind]} size={26} />
                    </span>
                    {listErrors[kind] ? (
                      <>
                        <span className="st-empty-title">读不到{info.pack}</span>
                        <span className="st-empty-note">{listErrors[kind]}</span>
                      </>
                    ) : all === null ? (
                      <span className="st-empty-note">读取中…</span>
                    ) : all.length === 0 && kind === 'voice' ? (
                      <>
                        <span className="st-empty-title">还没有声音</span>
                        <span className="st-empty-note">新建一个空声音,或者导入语音机上的 refs.json</span>
                        <span className="lib-empty-actions">{voiceActions}</span>
                      </>
                    ) : all.length === 0 ? (
                      <>
                        <span className="st-empty-title">还没有{info.pack}</span>
                        <span className="st-empty-note">把文件拖进来导入,或者在卡编辑器的素材页上传</span>
                      </>
                    ) : (
                      <>
                        <span className="st-empty-title">没有对得上的</span>
                        <span className="st-empty-note">换个筛选或搜索词看看</span>
                      </>
                    )}
                  </div>
                </main>
                <Inspector label={info.pack}>
                  <p className="st-inspector-hint">
                    这里按包列出库里所有的{info.pack},不管绑在哪张卡上。选一个直接在中间改;「绑定到角色卡…」决定哪些卡用它。
                  </p>
                </Inspector>
              </>
            )}
          </div>
        </InspectorCollapse.Provider>
        {!panels.rightOpen && <PanelRail side="right" label="详情" onOpen={collapseRight} />}
        {panels.leftOpen && (
          <PanelResizer side="left" dragging={panels.dragging === 'left'} onPointerDown={(e) => panels.startDrag('left', e)} />
        )}
        {panels.rightOpen && (
          <PanelResizer side="right" dragging={panels.dragging === 'right'} onPointerDown={(e) => panels.startDrag('right', e)} />
        )}
      </>
    );
  }

  return (
    <div
      ref={root}
      className={`st-root lib-root${embedded ? ' lib-embedded' : ''}${kind ? ` st-panels${panels.leftOpen ? '' : ' left-collapsed'}${panels.rightOpen ? '' : ' right-collapsed'}` : ''}`}
      style={kind ? panels.style : undefined}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? undefined : '素材管理'}
      tabIndex={embedded ? undefined : -1}
    >
      {header}
      {props.notice && (
        <ImportBanner notice={props.notice} onClose={() => props.onNoticeClose?.()} onClassify={classify} />
      )}
      <div className="st-body">{body}</div>
      {kind && dialog && renderDialog(kind)}
      {dialog?.kind === 'voiceImport' && (
        <VoiceImportDialog
          connections={ttsConns}
          names={voiceNames}
          onDone={(p) => void voiceImported(p)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'clean' && (
        <ConfirmDialog
          title="清理没人用的文件?"
          confirmLabel="清理"
          body={
            <>
              <p className="st-dialog-p">
                删掉包、差分以后,文件还留在仓库里。清理会把没有任何包、卡和备份用到的文件挪进回收区,30 天后才真删;刚放进来不到一天的先留着。
              </p>
              <p className="st-dialog-p">要把整个库过一遍,可能要等一会儿。</p>
            </>
          }
          onConfirm={() => void clean()}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );

  function renderDialog(k: LibraryKind) {
    if (!dialog || dialog.kind === 'clean' || dialog.kind === 'voiceImport') return null;
    const { item } = dialog;
    if (dialog.kind === 'rename') {
      return (
        <PromptDialog
          title={`重命名${KIND_INFO[k].pack}`}
          label="名字"
          initial={item.name}
          confirmLabel="改名"
          onSubmit={(name) => {
            setDialog(null);
            void rename(k, item, name);
          }}
          onCancel={() => setDialog(null)}
        />
      );
    }
    if (dialog.kind === 'duplicate') {
      const suggested = `${item.name} 副本`;
      return (
        <PromptDialog
          title="创建副本"
          label="副本的名字(文件和原来的共用,不多占地方)"
          initial={suggested}
          confirmLabel="创建"
          onSubmit={(name) => {
            setDialog(null);
            // 没改默认名:让后端起名(撞了它自己加数字)
            void duplicate(k, item, name === suggested ? null : name);
          }}
          onCancel={() => setDialog(null)}
        />
      );
    }
    if (dialog.kind === 'bind') {
      const other = k === 'bg' ? 'bgm' : k === 'bgm' ? 'bg' : null;
      const otherSide = other ? Boolean(lists[other]?.find((i) => i.id === item.id && i.count > 0)) : false;
      return (
        <BindDialog
          kind={k}
          item={item}
          cards={cards}
          otherSide={otherSide}
          writer={writer}
          onDone={(r) => afterBind(k, r)}
          onCancel={() => setDialog(null)}
        />
      );
    }
    const { usage } = dialog;
    const same = (groups.find((g) => g.some((i) => i.id === item.id)) ?? []).filter((i) => i.id !== item.id);
    const scene = k === 'bg' || k === 'bgm';
    return (
      <ConfirmDialog
        title={`删掉${scene ? '场景包' : ''}「${item.name}」?`}
        danger
        confirmLabel="删除"
        body={
          <>
            {usage.cards.length > 0 ? (
              <>
                <p className="st-dialog-p">还有 {usage.cards.length} 张卡在用:</p>
                <ul className="lib-del-cards">
                  {usage.cards.map((c) => (
                    <li key={c.id}>
                      <span className="lib-del-card">{c.name}</span>
                      <span className="lib-del-effect">{c.effect}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="st-dialog-p">没有卡在用它。</p>
            )}
            {deleteNotes(k, usage, k === 'voice' ? [] : same.map((i) => i.name)).map((line) => (
              <p key={line} className="st-dialog-p">
                {line}
              </p>
            ))}
          </>
        }
        onConfirm={() => void remove(k, item)}
        onCancel={() => setDialog(null)}
      />
    );
  }
}
