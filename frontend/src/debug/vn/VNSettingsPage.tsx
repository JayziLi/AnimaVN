/**
 * 菜单里的「设置」页(界面统一 第 4 段,设计稿 pages/whole.js 的设置页):顶上一排页签(文字 / 声音 / 操作 / 显示 / 外观,
 * 「进阶」后面是数据和卡带加的分页),下面是设置行;每一行的定义在 settings/model.ts,画法在 settings/SettingRow.tsx。
 *
 * 值分散在几处:视觉小说自己的偏好存 vnSettings;回车键和调试台聊天框共用,改的是 chatSettings;
 * BGM 和语音的音量直接交给各自的播放器;语音开关、等不等语音是语音插件的配置(全局一份,和调试台插件抽屉里的是同一个)。
 * 换音色、试音在菜单的插件页(语音),这里只放个入口;调参数在素材管理的「声音」页签。
 *
 * 关掉再打开停在上次的页签和滚动位置(这次页面打开期间记在模块里,刷新就忘)。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { debugApi, type MigrationStatus, type RecordsSummary, type SceneAsset, type StorageStatus } from '../lib/api';
import type { EnterKeyMode } from '../lib/chatSettings';
import { DISPLAY_MODES, gameWindowApi, sizeName, type GameDisplay } from '../lib/gameWindow';
import { useCoarsePointer } from '../lib/useIsMobile';
import type { JaHideControls } from '../plugins/jaHide';
import type { VoicePluginConfig } from '../plugins/voice';
import { bgmPlayer, useBgm } from './bgm';
import { useVoice, voicePlayer } from './voice';
import { playTypeSound } from './typeSound';
import { TYPE_SOUND_OFF, type VNSettings } from './vnSettings';
import {
  describeBackup,
  describeCheck,
  describeClean,
  describeDb,
  describeRecords,
  describeStorage,
  describeUpload,
  ENGINE_NOTE,
  STORAGE_NOTE,
  UPLOAD_NOTE,
} from './dataTab';
import type { TimelineEngine } from '../core/engine';
import { setTimelineEngine, useTimelineEngine } from './useTimelineEngine';
import type { MarksUploadReport } from '../plugins/cartridges';
import { PaperButton } from './ui/PaperButton';
import { Kbd } from './ui/Kbd';
import { Range } from './ui/Range';
import { Seg } from './ui/Seg';
import { Switch } from './ui/Switch';
import { popThemeClass } from './ui/logic';
import type { BannerScene } from './settings/banner';
import { LivePreview, type LivePreviewData } from './settings/LivePreview';
import { usePhone } from './settings/usePhone';
import { SettingError, SettingGroupHead, SettingRow } from './settings/SettingRow';
import {
  applyPatch,
  buildTabs,
  isResettable,
  mergePatches,
  resettableRows,
  tabOfRow,
  type Patch,
  type Row,
  type SettingsState,
  type Sinks,
  type Tab,
} from './settings/model';
import './vnSettingsPage.css';

export type SettingsTab = 'text' | 'sound' | 'control' | 'display' | 'look' | 'data';

/** 卡带加进设置页的一个分页 */
export interface ExtraSettingsTab {
  key: string;
  name: string;
  beta?: boolean;
  render: () => ReactNode;
}

interface Props {
  settings: VNSettings;
  onChange: (next: VNSettings) => void;
  enterKey: EnterKeyMode;
  onChangeEnterKey: (mode: EnterKeyMode) => void;
  voiceConfig: VoicePluginConfig;
  onChangeVoiceConfig: (next: VoicePluginConfig) => void;
  /** 这张卡念台词用的声音;没绑是 null,还没选角色是 undefined */
  voiceCastName: string | null | undefined;
  /** 去插件页的语音:换音色、试音 */
  onOpenVoice: () => void;
  /** 字幕:外语插件的「显示日语」(全局一份,和调试台插件里的是同一个开关) */
  showJa: boolean;
  onChangeShowJa: (showJa: boolean) => void;
  /** 隐藏前文日语:外语块不发以后(比如音色换成了中文),前面回复里的日语对玩家和模型都藏起来 */
  jaHide: JaHideControls;
  /** 打开时停在哪一栏(右上角语音面板点「完整设置」进来是「声音」;卡带的分页是它的 key) */
  initialTab?: SettingsTab | string;
  /** 卡带加的分页(生图),排在「数据」后面 */
  extraTabs?: readonly ExtraSettingsTab[];
  /** 封面音乐:这张卡的场景包里启用的 BGM、包里设的那首(null = 默认);没选角色时为 null */
  titleMusic: {
    bgms: SceneAsset[];
    value: string | null;
    onChange: (bgmId: string | null) => void;
  } | null;
  /** 把这个浏览器地址上的形态记号存进存档(形态卡带提供,素材架构第 0 期);没装就不显示这一行 */
  onUploadMarks?: () => Promise<MarksUploadReport>;
  /** 页头的场景横幅:场景包里另一张背景(settings/banner.ts 挑);没有就不放 */
  banner?: BannerScene | null;
  /** 右边的实机预览(U16):这一幕的背景、她、几句台词;不给就不放 */
  preview?: LivePreviewData | null;
}

// ───────── 记住上次停在哪 ─────────

/** 关掉再打开停在上次的页签和滚动位置 */
const memory: { tab: string | null; scroll: Record<string, number> } = { tab: null, scroll: {} };

// ───────── 页面自己画的几行 ─────────

/** 「显示」页最上面的窗口模式、画面大小:只在游戏窗口(game.py)里有,浏览器里不显示 */
function GameWindowRows() {
  const [api] = useState(gameWindowApi);
  const [display, setDisplay] = useState<GameDisplay | null>(null);
  useEffect(() => {
    if (api) void api.get_display().then(setDisplay, () => setDisplay(null));
  }, [api]);
  if (!api || !display) return null;
  const pick = (key: 'game_display' | 'game_size', value: string) => {
    void api.set_display(key, value).then(setDisplay, () => undefined);
  };
  return (
    <>
      <SettingRow id="gameDisplay" name="窗口模式" note="玩的时候按 F11 或 Alt+Enter 随时切换全屏;启动器的设置里也能改">
        <Seg
          className="av-seg st-seg"
          label="窗口模式"
          options={DISPLAY_MODES}
          value={display.display}
          onPick={(v) => pick('game_display', v)}
        />
      </SettingRow>
      <SettingRow
        id="gameSize"
        name="画面大小"
        note={display.display === 'fullscreen' ? '全屏时是退出全屏以后的窗口大小' : undefined}
      >
        <Seg
          className="av-seg st-seg"
          label="画面大小"
          options={display.sizes.map((v) => ({ value: v, name: sizeName(v) }))}
          value={display.size}
          onPick={(v) => pick('game_size', v)}
        />
      </SettingRow>
    </>
  );
}

const ENGINES: { value: TimelineEngine; name: string }[] = [
  { value: 'legacy', name: '旧算法' },
  { value: 'records', name: '认词记录' },
];

/** 「表情认法」开关(core/engine.ts,素材架构第 1b 期)和认词记录有几条 */
function EngineRow() {
  const engine = useTimelineEngine();
  const [summary, setSummary] = useState<RecordsSummary | 'error' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    debugApi
      .emotionRecordsSummary()
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary('error'));
    return () => {
      live = false;
    };
  }, []);
  const pick = (next: TimelineEngine) => {
    setSaving(true);
    setError(null);
    setTimelineEngine(next)
      .catch((e: unknown) => setError(`没存上:${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setSaving(false));
  };
  return (
    <SettingRow
      id="engine"
      name="表情认法"
      dup="表情认法"
      note={
        <>
          {error ?? describeRecords(summary)}
          <br />
          {ENGINE_NOTE}
        </>
      }
    >
      <Seg
        className="av-seg st-seg"
        label="表情认法"
        options={ENGINES.map((o) => ({ ...o, disabled: saving || engine === null }))}
        value={engine ?? 'legacy'}
        onPick={pick}
      />
    </SettingRow>
  );
}

type StorageJob = 'backup' | 'check' | 'clean';
const JOB_LABELS: Record<StorageJob, [idle: string, busy: string]> = {
  backup: ['现在备份', '正在备份…'],
  check: ['体检', '正在查…'],
  clean: ['清理', '正在清理…'],
};

/** 文件仓库(素材架构第 3 期):多大、复制进度;手动备份、体检、清理。复制还在跑时每 2 秒刷新一次 */
function StorageRow({ onBackedUp }: { onBackedUp: () => void }) {
  const [status, setStatus] = useState<StorageStatus | 'error' | null>(null);
  const [job, setJob] = useState<{ busy: StorageJob | null; text: string | null }>({ busy: null, text: null });
  const [tick, setTick] = useState(0);
  const running = status !== null && status !== 'error' && status.copy?.state === 'running';
  useEffect(() => {
    let live = true;
    debugApi
      .storage()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [tick]);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setTick((t) => t + 1), 2000);
    return () => clearTimeout(timer);
  }, [running, status]);
  const run = (which: StorageJob) => {
    setJob({ busy: which, text: null });
    const work: Promise<string> =
      which === 'backup'
        ? debugApi.backupNow().then((b) => {
            onBackedUp();
            return `备份好了:${b.name}`;
          })
        : which === 'check'
          ? debugApi.checkStorage().then(describeCheck)
          : debugApi.cleanStorage().then(describeClean);
    work
      .then((text) => setJob({ busy: null, text }))
      .catch((e: unknown) => setJob({ busy: null, text: `没做成:${e instanceof Error ? e.message : String(e)}` }))
      .finally(() => setTick((t) => t + 1));
  };
  return (
    <SettingRow id="storage" name="素材文件" note={job.text ?? STORAGE_NOTE}>
      <span className="st-info">{describeStorage(status)}</span>
      <div className="st-btns">
        {(Object.keys(JOB_LABELS) as StorageJob[]).map((k) => (
          <PaperButton key={k} sm disabled={job.busy !== null || status === 'error'} onClick={() => run(k)}>
            {JOB_LABELS[k][job.busy === k ? 1 : 0]}
          </PaperButton>
        ))}
      </div>
    </SettingRow>
  );
}

/** 「数据」一栏:数据库升级到哪了、上次整库备份、文件仓库(第 3 期)、形态记号存进存档(素材架构第 0 期)、表情认法(第 1b 期) */
function DataRows({ onUploadMarks }: { onUploadMarks?: () => Promise<MarksUploadReport> }) {
  const [status, setStatus] = useState<MigrationStatus | 'error' | null>(null);
  const [upload, setUpload] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    debugApi
      .migrations()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [reload]);
  const s = status === 'error' ? null : status;
  const doUpload = () => {
    if (!onUploadMarks) return;
    setUpload({ busy: true, text: null });
    onUploadMarks()
      .then((r) => setUpload({ busy: false, text: describeUpload(r, location.host) }))
      .catch((e: unknown) =>
        setUpload({
          busy: false,
          text: `没存完:${e instanceof Error ? e.message : String(e)}。重复点不会重复写,可以再点一次`,
        }),
      );
  };
  return (
    <>
      <SettingRow id="db" name="数据库" note={s ? `程序版本 ${s.app_version}` : undefined}>
        <span className="st-info">
          {status === 'error' ? '读不到:后端还是旧版,重启后端以后再看' : s ? describeDb(s) : '读取中…'}
        </span>
      </SettingRow>
      <SettingRow id="backup" name="上次备份">
        <span className="st-info">{s ? describeBackup(s.last_backup) : '—'}</span>
      </SettingRow>
      <StorageRow onBackedUp={() => setReload((n) => n + 1)} />
      {onUploadMarks && (
        <SettingRow id="marks" name="形态记号" note={upload.text ?? UPLOAD_NOTE}>
          <PaperButton sm disabled={upload.busy} onClick={doUpload}>
            {upload.busy ? '正在存…' : '存进存档'}
          </PaperButton>
        </SettingRow>
      )}
      <EngineRow />
    </>
  );
}

// ───────── 一行的控件 ─────────

function Control({ row }: { row: Exclude<Row, { kind: 'node' } | { kind: 'err' }> }) {
  switch (row.kind) {
    case 'seg':
      return (
        <>
          <Seg className="av-seg st-seg" label={row.name} options={row.options} value={row.value} onPick={row.onPick} />
          {row.sample && (
            <div className="st-fontpv" style={{ fontFamily: row.sample }}>
              「我心中的一等星,今天也依然是前辈。」
            </div>
          )}
        </>
      );
    case 'range':
      return (
        <Range
          label={row.name}
          min={row.min}
          max={row.max}
          step={row.step}
          value={row.value}
          onChange={row.onChange}
          onRelease={row.onRelease}
        />
      );
    case 'switch':
      return <Switch label={row.name} checked={row.value} onChange={row.onChange} />;
    case 'select':
      return row.empty ? null : (
        <select
          className="av-select st-select"
          aria-label={row.name}
          value={row.value}
          onChange={(e) => row.onChange(e.target.value)}
        >
          <option value="">默认:排第一的({row.options[0]?.name})</option>
          {row.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case 'keys':
      return (
        <div className="st-keys">
          <span>
            <Kbd>空格</Kbd> / <Kbd>回车</Kbd> 下一句
          </span>
          <span>
            按住 <Kbd>Ctrl</Kbd> 跳过
          </span>
          <span>
            <Kbd>A</Kbd> 自动播放
          </span>
          <span>
            <Kbd>Esc</Kbd> 菜单
          </span>
          <span>
            <Kbd>滚轮↑</Kbd> 历史
          </span>
          <span>
            <Kbd>右键</Kbd> 隐藏界面
          </span>
        </div>
      );
  }
}

function RowView({
  row,
  onReset,
  onJump,
}: {
  row: Row;
  onReset: (row: Row) => void;
  onJump: (to: string) => void;
}) {
  if (row.kind === 'node') return <>{row.node}</>;
  if (row.kind === 'err') return <SettingError text={row.text} />;
  const reset = isResettable(row) ? row.reset : undefined;
  const value = row.kind === 'range' ? row.text : undefined;
  const note = row.kind === 'select' && row.empty ? row.empty : row.note;
  const to = row.jump?.to;
  return (
    <SettingRow
      id={row.id}
      name={row.name}
      beta={row.beta}
      tip={row.tip}
      dup={row.dup}
      note={note}
      jump={row.jump && to ? { text: row.jump.text, onJump: () => onJump(to) } : undefined}
      value={value}
      changed={reset?.changed}
      resetText={reset?.text}
      onReset={reset ? () => onReset(row) : undefined}
      open={row.open}
    >
      <Control row={row} />
    </SettingRow>
  );
}

// ───────── 页 ─────────

export function VNSettingsPage({
  settings,
  onChange,
  enterKey,
  onChangeEnterKey,
  voiceConfig,
  onChangeVoiceConfig,
  voiceCastName,
  onOpenVoice,
  showJa,
  onChangeShowJa,
  jaHide,
  initialTab,
  titleMusic,
  onUploadMarks,
  extraTabs = [],
  banner = null,
  preview = null,
}: Props) {
  const bgm = useBgm();
  const coarse = useCoarsePointer();
  const voice = useVoice();
  // 手机竖屏:整屏纸面,预览收成页签下面一条,「这页恢复默认」放页尾(电脑在页头)
  const phone = usePhone();

  const state: SettingsState = {
    vn: settings,
    enterKey,
    voiceConfig,
    showJa,
    bgm: { volume: bgm.volume, muted: bgm.muted, error: bgm.error },
    voice: { volume: voice.volume, muted: voice.muted, lastError: voice.lastError },
    titleMusic: titleMusic
      ? { bgms: titleMusic.bgms.map((b) => ({ id: b.id, label: b.label })), value: titleMusic.value }
      : null,
    voiceCastName,
    jaHidden: jaHide.hidden,
    touch: coarse,
  };
  const sinks: Sinks = {
    setVN: onChange,
    setVoiceConfig: onChangeVoiceConfig,
    setEnterKey: onChangeEnterKey,
    setShowJa: onChangeShowJa,
    setBgmVolume: (v) => bgmPlayer.setVolume(v),
    setBgmMuted: (m) => bgmPlayer.setMuted(m),
    setVoiceVolume: (v) => voicePlayer.setVolume(v),
    setVoiceMuted: (m) => voicePlayer.setMuted(m),
    setTitleMusic: (id) => titleMusic?.onChange(id),
  };
  const apply = (p: Patch) => {
    applyPatch(p, state, sinks);
    // 跳字音:选一个就先放一声
    const picked = p.vn?.typeSound;
    if (picked !== undefined && picked !== TYPE_SOUND_OFF) playTypeSound(picked, settings.typeSoundVolume);
  };

  const jaHideRow = (
    <SettingRow
      id="jaHide"
      name="前文日语"
      dup="外语"
      note={
        <>
          {jaHide.hidden > 0 ? `当前对话已藏 ${jaHide.hidden} 条回复的日语 · ` : ''}
          外语块不发以后用(比如音色换成了中文):前面回复里的日语不再显示,也不发给模型(免得它接着写日语);历史页「显示原文」还能看到
        </>
      }
    >
      <PaperButton sm onClick={jaHide.hide}>
        隐藏前文日语
      </PaperButton>
      {jaHide.hidden > 0 && (
        <PaperButton sm onClick={jaHide.show}>
          恢复
        </PaperButton>
      )}
    </SettingRow>
  );
  const tabs: Tab[] = buildTabs(state, apply, {
    jaHide: jaHideRow,
    data: <DataRows onUploadMarks={onUploadMarks} />,
    gameWindow: <GameWindowRows />,
  });
  // 跳字音量松手时放一声,试听
  for (const t of tabs)
    for (const g of t.groups)
      for (const r of g.rows)
        if (r.id === 'typeSoundVolume' && r.kind === 'range') {
          r.onRelease = () => playTypeSound(settings.typeSound, settings.typeSoundVolume);
        }

  const extra = extraTabs.map((t) => ({ ...t, id: t.key, en: '', adv: true as const }));
  const allIds = [...tabs.map((t) => t.id), ...extra.map((t) => t.id)];
  const [tab, setTabState] = useState<string>(() => {
    const want = initialTab ?? memory.tab ?? 'text';
    return allIds.includes(want) ? want : 'text';
  });
  const setTab = (id: string) => {
    memory.tab = id;
    setTabState(id);
  };
  useEffect(() => {
    memory.tab = tab;
  }, [tab]);

  const current = tabs.find((t) => t.id === tab);
  const currentExtra = extra.find((t) => t.id === tab);

  // 滚动位置:换页时恢复这一页上次的位置;滚动时记下
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = memory.scroll[tab] ?? 0;
  }, [tab]);

  // 手机上页签是一排横滑的:选中的那个滑进可见范围(右边留出淡出那截)。不用 scrollIntoView(会带着整页滚),只动页签条自己的 scrollLeft
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!phone) return;
    const id = requestAnimationFrame(() => {
      const nav = tabsRef.current;
      const on = nav?.querySelector<HTMLElement>('button.on');
      if (!nav || !on) return;
      if (on.offsetLeft < nav.scrollLeft + 20) nav.scrollTo({ left: on.offsetLeft - 20, behavior: 'smooth' });
      else if (on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth - 52)
        nav.scrollTo({ left: on.offsetLeft + on.offsetWidth - nav.clientWidth + 52, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [tab, phone]);

  const reset = (row: Row) => {
    if (isResettable(row)) apply(row.reset.patch);
  };
  const pageResettable = current ? resettableRows(current) : [];
  const pageChanged = pageResettable.filter((r) => r.reset.changed);
  const resetPage = () => {
    if (pageChanged.length === 0) return;
    apply(mergePatches(pageChanged.map((r) => r.reset.patch)));
  };

  // 「去调文字速度」这种跳转:切到那一行所在的页签,滚到正中,闪一下
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const tabOf = (id: string) => tabOfRow(tabs, id);
  const jump = useCallback(
    (to: string) => {
      const t = tabOf(to);
      if (!t) return;
      setTab(t);
      setFlash((f) => ({ id: to, n: (f?.n ?? 0) + 1 }));
    },
    // tabOf 只读 tabs 的行 id,结构不变,不用每次渲染都换一个 jump
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    if (!flash) return;
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`[data-row="${flash.id}"]`);
    if (!box || !el) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollTop += r.top - b.top - box.clientHeight / 2 + el.offsetHeight / 2;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [flash]);

  const themeClass = useMemo(() => popThemeClass(settings.theme), [settings.theme]);
  const playerTabs = tabs.filter((t) => !t.adv);
  const advTabs = [...tabs.filter((t) => t.adv), ...extra];
  const tabButton = (t: { id: string; name: string; en?: string; beta?: boolean; adv?: boolean }) => (
    <button
      key={t.id}
      type="button"
      role="tab"
      aria-selected={tab === t.id}
      className={`${tab === t.id ? 'on' : ''}${t.adv ? ' adv' : ''}`}
      onClick={() => setTab(t.id)}
    >
      <span className="zh">{t.name}</span>
      {/* 手机上页签带斜体英文(设计稿 phone.html 的设置页签),电脑上不带 */}
      {t.en && <span className="en">{t.en}</span>}
      {t.beta && <span className="av-chip beta">BETA</span>}
    </button>
  );

  return (
    <div className={`vn-sp ${themeClass}${banner ? ' has-banner' : ''}`}>
      <div className="vn-sp-main">
      {banner && (
        <div className="vn-sp-banner" aria-hidden="true">
          <img key={banner.src} src={banner.src} alt="" draggable={false} />
        </div>
      )}
      <header className="vn-sp-head">
        <div className="vn-sp-title">
          <span className="av-title-zh">设置</span>
          <span className="av-title-en">Config</span>
        </div>
        <div className="vn-sp-head-r">
          {!phone && pageResettable.length > 0 && (
            <PaperButton kind="ghost" sm disabled={pageChanged.length === 0} onClick={resetPage}>
              这页恢复默认
            </PaperButton>
          )}
        </div>
      </header>

      <nav ref={tabsRef} className="vn-sp-tabs" role="tablist" aria-label="设置页签">
        {playerTabs.map(tabButton)}
        <span className="vn-sp-sep">进阶</span>
        {advTabs.map(tabButton)}
      </nav>

      {phone && preview && <LivePreview strip data={preview} settings={settings} />}

      <div className={`vn-sp-content${preview && !phone ? ' has-preview' : ''}`}>

      <div
        key={tab}
        ref={scroller}
        className="vn-sp-page"
        role="tabpanel"
        onScroll={(e) => {
          memory.scroll[tab] = e.currentTarget.scrollTop;
        }}
      >
        {currentExtra ? (
          <div className="st-group">{currentExtra.render()}</div>
        ) : (
          current?.groups.map((g, gi) => (
            <div key={g.id ?? gi} className="st-group" data-group={g.id}>
              {g.title && (
                <SettingGroupHead title={g.title} en={g.en} note={g.note}>
                  {g.action && (
                    <PaperButton sm onClick={onOpenVoice}>
                      {g.action.text}
                    </PaperButton>
                  )}
                </SettingGroupHead>
              )}
              {g.rows.map((r) => (
                <RowView key={r.id} row={r} onReset={reset} onJump={jump} />
              ))}
            </div>
          ))
        )}
        {phone && pageResettable.length > 0 && (
          <div className="vn-sp-foot">
            <PaperButton kind="ghost" sm disabled={pageChanged.length === 0} onClick={resetPage}>
              这页恢复默认
            </PaperButton>
          </div>
        )}
      </div>
      {!phone && preview && <LivePreview data={preview} settings={settings} />}
      </div>
      </div>
    </div>
  );
}
