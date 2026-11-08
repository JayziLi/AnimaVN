/**
 * 导入器的纯逻辑:确认框每一行写什么、重复的那几行给哪些选择、默认选什么、发给 apply 的请求体,
 * 导完以后提示条的字、打开素材页的哪一栏(没有卡时打开素材管理页的哪一页、选中哪个包)、出错时的一句话。
 *
 * 确认框照画布 Confirms 第一个(10-15 定):拖到卡上先问「给「刻晴」挂上这些素材?」,逐行列要建的东西;
 * 和库里一样的默认「另存一份(推荐)」;卡重复问「是同一张,更新它 / 另存一张」;
 * 拖到原有的卡上带了立绘时有「挂上以后直接换成这套」;认不出的文件这里就能选类型。
 */

import type {
  ClassifyKind,
  ExportPackKind,
  ImportApplyBody,
  ImportBundleDetail,
  ImportDecision,
  ImportCreated,
  ImportGroup,
  ImportKind,
  ImportPackDetail,
  ImportPlan,
  ImportResult,
  ImportVoiceDetail,
  ImportVoiceFolderDetail,
  ScenePack,
  TtsConnection,
} from '../lib/api';
import type { LibraryRoute } from '../library/libraryModel';
import type { ImportNotice, SlotKey } from '../studio/types';
import { pickRows, type PickBind, type PickRow } from '../vn/pick/pickLogic';
import type { ImportTarget } from './dropTarget';

/** 拖到的那张卡现在挂着几套立绘、当前那套叫什么(确认框说「现在用的那套不变」用);读不到时是 null */
export interface TargetSprites {
  count: number;
  current: string | null;
}

export interface ChoiceOption {
  value: ImportDecision;
  label: string;
  note: string;
}

/** 重复的那一行要选一个 */
export interface RowChoice {
  /** 「「刻晴 · 玉衡星」库里已经有一模一样的」 */
  lead: string;
  options: ChoiceOption[];
  initial: ImportDecision;
}

export type RowIcon = 'card' | 'sprite' | 'bg' | 'bgm' | 'scene' | 'cg' | 'voice';

export interface ConfirmRow {
  key: string;
  icon: RowIcon;
  /** 「立绘包「刻晴 · 新衣服」· 16 张」 */
  title: string;
  /** 会怎样:「挂成刻晴的立绘,算再挂一套;现在用的那套不变」;重复的卡由选项说,这里是空的 */
  effect: string;
  choice: RowChoice | null;
}

export interface UnknownRow {
  path: string;
  name: string;
  /** 在哪个文件夹里(暂存路径去掉文件名);在最上层是空串 */
  folder: string;
}

export interface ConfirmModel {
  title: string;
  confirmLabel: string;
  rows: ConfirmRow[];
  /** 「挂上以后直接换成这套」:拖到原有的卡上、带了立绘、那张卡已经有立绘(或者读不到)时才有;key = 勾选框放在哪一行下面 */
  makeCurrent: { key: string; label: string } | null;
  unknown: UnknownRow[];
  skipped: string[];
}

/** 认不出的文件能选的类型(确认框、提示条的「查看」都用);不选 = 先放着 */
export const CLASSIFY_CHOICES: readonly { value: ClassifyKind; label: string }[] = [
  { value: 'sprite', label: '立绘' },
  { value: 'bg', label: '背景' },
  { value: 'bgm', label: 'BGM' },
  { value: 'cg', label: 'CG' },
  { value: 'skip', label: '不要' },
];

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const folderOf = (path: string) => path.split(/[\\/]/).slice(0, -1).join('/');

/** 「两张卡」「3 张卡」:画布上的说法 */
const cards = (n: number) => (n === 2 ? '两张卡' : `${n} 张卡`);

function sceneWhat(g: ImportGroup): { icon: RowIcon; word: string } {
  const bg = g.bg_count ?? 0;
  const bgm = g.bgm_count ?? 0;
  if (bg > 0 && bgm > 0) return { icon: 'scene', word: '背景和 BGM' };
  return bgm > 0 ? { icon: 'bgm', word: 'BGM' } : { icon: 'bg', word: '背景' };
}

function titleOf(g: ImportGroup): { icon: RowIcon; title: string } {
  switch (g.type) {
    case 'card':
      return { icon: 'card', title: `角色卡「${g.name}」` };
    case 'sprite_pack':
      return { icon: 'sprite', title: `立绘包「${g.name}」· ${g.count} 张` };
    case 'scene_pack': {
      const { icon, word } = sceneWhat(g);
      const bg = g.bg_count ?? 0;
      const bgm = g.bgm_count ?? 0;
      const title =
        icon === 'scene'
          ? `${word}「${g.name}」· 背景 ${bg} 张 · BGM ${bgm} 首`
          : icon === 'bgm'
            ? `BGM「${g.name}」· ${bgm} 首`
            : `背景「${g.name}」· ${bg} 张`;
      return { icon, title };
    }
    case 'cg_pack': {
      const v = g.variant_count ?? 0;
      return { icon: 'cg', title: `CG 包「${g.name}」· ${g.count} 张构图${v > 0 ? ` · 差分 ${v} 张` : ''}` };
    }
    case 'bundle':
      return { icon: 'card', title: `角色包「${g.name}」` };
    case 'voice_folder': {
      const d = voiceFolderDetail(g);
      return { icon: 'voice', title: `声音「${d?.name ?? g.name}」${d ? `· ${voiceFolderCounts(d)}` : ''}` };
    }
    case 'pack_file': {
      const d = packDetail(g);
      const kind = d?.kind ?? 'sprite';
      return { icon: PACK_ICON[kind], title: `${PACK_WORD[kind]}「${d?.name ?? g.name}」${d?.detail ? `· ${d.detail}` : ''}` };
    }
  }
}

// ---------------------------------------------------------------- 角色包 / 单包(第 3 步)

const PACK_ICON: Record<ExportPackKind, RowIcon> = { sprite: 'sprite', scene: 'scene', cg: 'cg', voice: 'voice' };
const PACK_WORD: Record<ExportPackKind, string> = { sprite: '立绘包', scene: '背景和 BGM', cg: 'CG 包', voice: '声音' };
/** 导入确认里一类包那一行左边写什么(和导出面板一样) */
const PACK_LABEL: Record<ExportPackKind, string> = { sprite: '立绘', scene: '背景 · BGM', cg: 'CG', voice: '声音' };

const bundleDetail = (g: ImportGroup): ImportBundleDetail | null =>
  g.type === 'bundle' && g.detail && 'cards' in g.detail ? g.detail : null;
const packDetail = (g: ImportGroup): ImportPackDetail | null =>
  g.type === 'pack_file' && g.detail && 'kind' in g.detail ? g.detail : null;

/** 计划里只有一个角色包(拖进来的就是一个 .animavn):确认框照画布 ImportBundle 画 */
export function bundleOnly(plan: ImportPlan): ImportGroup | null {
  const g = plan.groups[0];
  return plan.groups.length === 1 && plan.unknown.length === 0 && g && bundleDetail(g) ? g : null;
}

/** 角色包确认框里的一行 */
export interface BundleRow {
  key: string;
  /** 左边那一格:「角色卡」「立绘」;同一类第二行起是空的 */
  label: string;
  text: string;
  thumbs: string[];
  /** 背景、CG 的缩略图是横的 */
  wide: boolean;
}

export interface BundleView {
  key: string;
  name: string;
  /** 一组状态卡时写「普通 / 约会」 */
  badge: string | null;
  note: string;
  preview: string | null;
  rows: BundleRow[];
  /** 作者建议的预设(勾选框的字);没带是 null */
  preset: { label: string; hint: string } | null;
  /** 底部那行灰字;带了声音时是 null */
  voiceNote: string | null;
  /** 带了声音时那一行灰字:模型加载时会执行代码;没带是 null */
  codeWarn: string | null;
  bytes: number;
}

/** 一类包最多放几张缩略图 */
const MAX_THUMBS = 3;

export function bundleView(g: ImportGroup): BundleView {
  const d = bundleDetail(g);
  if (!d) throw new Error('不是角色包');
  const cardRows = d.cards.map(
    (c, i): BundleRow => ({
      key: `card-${i}`,
      label: i === 0 ? '角色卡' : '',
      text: c.state ? `${c.name}(${c.state})` : c.name,
      thumbs: [],
      wide: false,
    }),
  );
  const kinds: ExportPackKind[] = ['sprite', 'scene', 'cg'];
  const packRows = kinds.flatMap((kind): BundleRow[] => {
    const packs = d.packs.filter((p) => p.kind === kind);
    if (packs.length === 0) return [];
    return [
      {
        key: `pack-${kind}`,
        label: PACK_LABEL[kind],
        text: packs.map((p) => (p.detail ? `${p.name} · ${p.detail}` : p.name)).join('、'),
        thumbs: packs.flatMap((p) => p.thumbs).slice(0, MAX_THUMBS),
        wide: kind !== 'sprite',
      },
    ];
  });
  const follows: BundleRow[] =
    d.follows.length > 0
      ? [{ key: 'follows', label: '跟着走', text: d.follows.join('、'), thumbs: [], wide: false }]
      : [];
  const states = d.cards.map((c) => c.state).filter((s): s is string => !!s);
  return {
    key: g.key,
    name: g.name,
    badge: d.cards.length > 1 && states.length > 0 ? states.join(' / ') : null,
    note: d.note.trim(),
    preview: d.preview,
    rows: [...cardRows, ...packRows, ...follows],
    preset: d.preset ? { label: `也导入作者建议的预设「${d.preset.name}」`, hint: '另建一套,绑到这张卡' } : null,
    voiceNote: d.has_voice ? null : '这个包里没有声音:导入后在卡编辑器的声音栏挂一个',
    codeWarn: d.has_voice || (d.voices?.length ?? 0) > 0 ? MODEL_CODE_WARN : null,
    bytes: d.bytes,
  };
}

// ---------------------------------------------------------------- 声音(第 4 步)

/** 导入带声音的包时那一行灰字 */
export const MODEL_CODE_WARN = '模型文件加载时会执行里面的代码,只导入信得过的人给的包';

/** 这一组里的声音:角色包的 detail.voices、声音包的 detail.voices;别的组没有 */
export function groupVoices(g: ImportGroup): ImportVoiceDetail[] {
  return bundleDetail(g)?.voices ?? packDetail(g)?.voices ?? [];
}

/** 语音服务的地址是不是本机(127.0.0.1 / localhost / ::1);地址写不全(没写 http://)也认 */
export function isLocalUrl(baseUrl: string): boolean {
  const raw = baseUrl.trim();
  if (!raw) return false;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    return false;
  }
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** 每个带声音的组默认导到哪个语音服务:后端给的那个(第一个 GPT-SoVITS 连接);一个都没有的组不放 */
export function defaultVoiceConnections(plan: ImportPlan): Record<string, string> {
  return Object.fromEntries(
    plan.groups.flatMap((g) => {
      const id = groupVoices(g).find((v) => v.connection)?.connection?.id;
      return id ? [[g.key, id] as const] : [];
    }),
  );
}

/** 计划里有没有声音(要读语音服务列表、给下拉) */
export const planHasVoices = (plan: ImportPlan) =>
  plan.groups.some((g) => groupVoices(g).length > 0 || g.type === 'voice_folder');

/** 选了这个语音服务以后会怎样 */
// 地址是 127.0.0.1 也可能是隧道到别的电脑,这里不说「在本机」,真要不要送由后端测过再定
export const VOICE_LOCAL = '导完自动准备好文件,好了就能念';
export const VOICE_REMOTE = '语音服务在另一台电脑,导完自动送过去';
export const VOICE_EXISTS = '库里已经有一样的声音:不再存一份,直接用那条';
export const VOICE_CLOUD = '导完就能念,参考音频念的时候带过去';
export const VOICE_NO_SERVICE = '没有语音服务:会自动连本机 GPT-SoVITS(127.0.0.1:9880),没装也能先导进来';

/** 声音那一行要画的 */
export interface VoiceLine {
  key: string;
  /** 左边那一格:第一个声音写「声音」,后面的空着 */
  label: string;
  /** 「刻晴(日语) · 12 段参考 + 2 个模型」 */
  text: string;
  /** 缺文件时的灰字;不缺是 null */
  missing: string | null;
}

export function voiceLines(g: ImportGroup): VoiceLine[] {
  return groupVoices(g).map((v, i) => ({
    key: `voice-${i}`,
    label: i === 0 ? '声音' : '',
    text: v.detail ? `${v.name} · ${v.detail}` : v.name,
    missing: v.missing > 0 ? `包里缺 ${v.missing} 个文件,导完这个声音只有设置` : null,
  }));
}

/** 「→ [连接名]」那一格:选中的是哪个、能不能下拉、导完会怎样 */
export interface VoiceTarget {
  /** 选中的语音服务;没有是 null */
  id: string | null;
  /** 只有一个(或者列表读不到)时直接写名字 */
  name: string;
  /** 不止一个语音服务时给下拉 */
  options: { value: string; label: string }[] | null;
  /** 导完会怎样:导完就能念 / 要把文件放过去 / 还没有语音服务 */
  status: string;
  local: boolean;
}

/**
 * chosen = 选了哪个(没选过用后端给的默认);connections = 语音服务列表(读不到是 null,只能照后端给的那个写)
 */
export function voiceTarget(
  g: ImportGroup,
  chosen: string | undefined,
  connections: readonly (Pick<TtsConnection, 'id' | 'name' | 'base_url'> & Partial<Pick<TtsConnection, 'api_type'>>)[] | null,
): VoiceTarget {
  const voices = groupVoices(g);
  const fallback = voices.find((v) => v.connection)?.connection ?? null;
  const voice = voices.find((v) => v.targets) ?? voices[0];
  const targets = voice?.targets ?? null;
  // 下拉里只放念得了这个声音的连接(后端算的;老后端没给就全放)
  const pickable = connections && targets ? connections.filter((c) => targets.some((t) => t.id === c.id && t.usable)) : connections;
  let id = chosen ?? fallback?.id ?? null;
  // 列表里已经没有这个了(刚删掉),或者这个声音挂不上:换成第一个能挂的
  if (id && pickable && !pickable.some((c) => c.id === id) && (pickable.length > 0 || targets)) id = pickable[0]?.id ?? null;
  const hit = id ? connections?.find((c) => c.id === id) : undefined;
  const local = hit ? isLocalUrl(hit.base_url) : fallback !== null && fallback.id === id ? fallback.local : false;
  const name = hit?.name ?? (fallback && fallback.id === id ? fallback.name : '');
  const options = pickable && pickable.length > 1 ? pickable.map((c) => ({ value: c.id, label: c.name })) : null;
  if (!id) return { id: null, name: '', options, status: voice?.empty_note ?? VOICE_NO_SERVICE, local: false };
  if (voice?.existing) return { id, name, options: null, status: VOICE_EXISTS, local };
  const note = targets?.find((t) => t.id === id)?.note;
  const cloud = hit?.api_type === 'fish' || hit?.api_type === 'openai';
  const status = note ? (voice?.has_models ? `${note};以后加了 GPT-SoVITS 可以改挂` : note) : cloud ? VOICE_CLOUD : local ? VOICE_LOCAL : VOICE_REMOTE;
  return { id, name, options, status, local };
}

// ---------------------------------------------------------------- 从文件夹导入声音

export const voiceFolderDetail = (g: ImportGroup): ImportVoiceFolderDetail | null =>
  g.type === 'voice_folder' && g.detail && 'refs' in g.detail ? g.detail : null;

/** 计划里只有一个声音文件夹(拖进来的就是一个文件夹):确认框照画布 Import 画 */
export function voiceFolderOnly(plan: ImportPlan): ImportGroup | null {
  const g = plan.groups[0];
  return plan.groups.length === 1 && plan.unknown.length === 0 && g && voiceFolderDetail(g) ? g : null;
}

/** 「2 个模型 + 12 段参考」(没有模型的只写参考) */
export function voiceFolderCounts(d: Pick<ImportVoiceFolderDetail, 'models' | 'refs'>): string {
  return [d.models.length > 0 ? `${d.models.length} 个模型` : '', d.refs.length > 0 ? `${d.refs.length} 段参考` : '']
    .filter(Boolean)
    .join(' + ');
}

/** 导入框里「情绪」先列几行,剩下的点「展开」 */
export const VOICE_FOLDER_SHOWN = 4;

export const VOICE_FOLDER_LANGS: readonly { value: string; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日语' },
];

/** 导入框里用户改了的:名字、念哪种语言(没改的不放) */
export interface VoiceFolderEdit {
  name?: string;
  lang?: string;
}

export interface VoiceFolderTargetRow {
  id: string;
  name: string;
  /** 右边的灰字:最像 / 只拿参考音频 / 不能挂的原因 */
  note: string;
  disabled: boolean;
  /** 绿字(最像) */
  good: boolean;
}

const listed = (names: readonly string[]) =>
  names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 个` : names.join('、');

const isModelFile = (name: string) => /\.(ckpt|pth)$/i.test(name);

/** 没导的文件说一句:音频是名字不合格,模型是多出来的旧一轮 */
export function voiceFolderSkipped(skipped: readonly string[]): string[] {
  const models = skipped.filter(isModelFile);
  const audio = skipped.filter((n) => !isModelFile(n));
  return [
    ...(audio.length > 0 ? [`${listed(audio)} 看不出情绪和原文,先不导。要用就改名成「【情绪】原文.wav」再导一次。`] : []),
    ...(models.length > 0 ? [`${listed(models)} 是旧的一轮,没导(同一种模型只取轮数最大的)。`] : []),
  ];
}

/** 挂到哪条:选过且能用的用选的,不然后端推荐的,再不然第一条能用的;一条能用的都没有是 null */
export function voiceFolderPick(d: ImportVoiceFolderDetail, chosen: string | undefined): string | null {
  const ok = (id: string | undefined) => d.connections.find((c) => c.id === id && c.usable)?.id ?? null;
  return ok(chosen) ?? d.connections.find((c) => c.best)?.id ?? d.connections.find((c) => c.usable)?.id ?? null;
}

export function voiceFolderTargets(d: ImportVoiceFolderDetail): VoiceFolderTargetRow[] {
  return d.connections.map((c) => {
    const best = c.best && c.api_type === 'gpt_sovits' && d.models.length > 0;
    return {
      id: c.id,
      name: c.name,
      disabled: !c.usable,
      good: best,
      note: !c.usable ? c.reason : best ? '最像:模型和参考音频都用上' : c.note,
    };
  });
}

export interface VoiceFolderView {
  key: string;
  /** 导入框标题旁的灰字:「三月七_ja · 14 个文件 · 390 MB」(大小是模型的) */
  meta: { source: string; files: number; modelBytes: number };
  /** 模型一行:「2 个」+ 文件名 */
  models: { count: number; names: string };
  refCount: number;
  /** 原文里有假名(语言选日语的缘由) */
  kana: boolean;
  lang: string;
  emotions: { label: string; text: string }[];
  hidden: number;
  skipped: string[];
  existing: { id: string; name: string } | null;
}

export function voiceFolderView(g: ImportGroup, source: string | null, expanded: boolean): VoiceFolderView {
  const d = voiceFolderDetail(g);
  if (!d) throw new Error('不是声音文件夹');
  const root = d.folder.split('/')[0] || g.name;
  const shown = expanded ? d.refs : d.refs.slice(0, VOICE_FOLDER_SHOWN);
  return {
    key: g.key,
    meta: {
      source: source ?? root,
      files: d.models.length + d.refs.length + d.skipped.length,
      modelBytes: d.models.reduce((n, m) => n + m.size, 0),
    },
    models: { count: d.models.length, names: d.models.map((m) => m.name).join(' · ') },
    refCount: d.refs.length,
    kana: d.lang === 'ja',
    lang: d.lang,
    emotions: shown.map((r) => ({ label: r.label, text: r.text })),
    hidden: d.refs.length - shown.length,
    skipped: voiceFolderSkipped(d.skipped),
    existing: d.existing,
  };
}

/** 「会怎样」那一行 */
export function voiceFolderEffect(
  d: ImportVoiceFolderDetail,
  chosen: string | null,
  connections: readonly (Pick<TtsConnection, 'id' | 'name' | 'base_url'> & Partial<Pick<TtsConnection, 'api_type'>>)[] | null,
): string {
  if (d.existing) return '库里已经有一样的声音:不再存一份,直接用那条。';
  if (d.connections.length === 0) {
    return d.models.length > 0 ? VOICE_NO_SERVICE : '没有语音服务:会自动连本机 IndexTTS(127.0.0.1:9890),没装也能先导进来';
  }
  if (!chosen) {
    const need = d.models.length > 0 ? '要 GPT-SoVITS 才能念' : '没有模型,要 Fish Audio 或 IndexTTS 才能念';
    return `${need}:文件先存着,以后加了连接,在声音编辑器里挂上。`;
  }
  const hit = connections?.find((c) => c.id === chosen);
  if (!hit) return '';
  if (hit.api_type === 'fish' || hit.api_type === 'openai') return `${hit.name}:${VOICE_CLOUD}。`;
  return isLocalUrl(hit.base_url)
    ? `${hit.name}:${VOICE_LOCAL}。`
    : `${hit.name}在另一台电脑:导完自动把文件送过去,送完就能念。`;
}

/** 角色包的预设默认勾着(作者建议的) */
export function defaultBundlePresets(plan: ImportPlan): Record<string, boolean> {
  return Object.fromEntries(
    plan.groups.flatMap((g) => {
      const d = bundleDetail(g);
      return d?.preset ? [[g.key, true] as const] : [];
    }),
  );
}

/** 拖到的卡上要挂的立绘包(按计划里的先后);make_current 换成的是第一套 */
const targetSprites = (plan: ImportPlan) => plan.groups.filter((g) => g.type === 'sprite_pack' && g.owner === 'target');

/** 确认框要先读哪张卡的立绘(说「现在用的那套不变」):有立绘要挂到拖到的卡上时才读 */
export function spritesToCheck(plan: ImportPlan, target: ImportTarget): string | null {
  return target.cardId && targetSprites(plan).length > 0 ? target.cardId : null;
}

function packChoice(g: ImportGroup): RowChoice {
  const dup = g.duplicate_of!;
  const n = dup.card_count;
  const lead = `「${dup.name}」库里已经有一模一样的`;
  const SAVE = '另存一份(推荐)';
  if (g.owner === null) {
    return {
      lead,
      initial: 'new',
      options: [
        { value: 'new', label: SAVE, note: '以后改这份不影响已有的那份' },
        { value: 'share', label: '不导这份', note: '库里已经有了,这次不再建' },
      ],
    };
  }
  const saveNote =
    n === 1 ? '两张卡各用各的,以后改这份不影响另一张' : n && n > 1 ? `各用各的,以后改这份不影响另外 ${n} 张卡` : '以后改这份不影响已有的那份';
  const shareNote =
    n === undefined ? '改一处,用它的卡一起变' : n === 0 ? '现在没有卡在用' : `现在被 ${n} 张卡用;改一处,${cards(n + 1)}一起变`;
  return {
    lead,
    initial: 'new',
    options: [
      { value: 'new', label: SAVE, note: saveNote },
      { value: 'share', label: '共用已有的那份', note: shareNote },
    ],
  };
}

function cardChoice(g: ImportGroup): RowChoice {
  return {
    lead: `「${g.duplicate_of!.name}」库里已经有一张一样的`,
    initial: 'new',
    options: [
      { value: 'update', label: '是同一张,更新它', note: '对话、存档、挂的素材都留着' },
      { value: 'new', label: '另存一张', note: '两张卡各用各的' },
    ],
  };
}

export function confirmModel(
  plan: ImportPlan,
  target: ImportTarget,
  sprites: TargetSprites | null,
  makeCurrent: boolean,
): ConfirmModel {
  const who = target.cardName ?? '这张卡';
  const cardName = (key: string) => plan.groups.find((g) => g.key === key)?.name ?? '新卡';
  const mine = targetSprites(plan);
  const first = mine[0]?.key;
  const canSwitch = target.cardId !== null && mine.length > 0 && (sprites === null || sprites.count > 0);

  const spriteEffect = (g: ImportGroup) => {
    const base = `挂成${who}的立绘`;
    if (sprites && sprites.count === 0 && g.key === first) return `${base}(${who}还没有立绘,这套直接用上)`;
    const more = `${base},算再挂一套`;
    if (g.key === first && makeCurrent && canSwitch) return `${more};挂上以后直接换成这套`;
    if (!sprites || sprites.count === 0) return more;
    return `${more};现在用的${sprites.current ? `「${sprites.current}」` : '那套'}不变`;
  };

  const effectOf = (g: ImportGroup): string => {
    if (g.type === 'bundle') {
      const packs = bundleDetail(g)?.packs.length ?? 0;
      return `新建角色卡${packs > 0 ? `和 ${packs} 个包` : ''},都是另存的一份`;
    }
    if (g.type === 'voice_folder') {
      return voiceFolderDetail(g)?.existing ? '库里已经有一样的声音:不再存一份,直接用那条' : '另建一个声音,先放进素材库,不挂到卡上';
    }
    if (g.type === 'pack_file') {
      return packDetail(g)?.kind === 'voice' ? '另建一个声音,先放进素材库,不挂到卡上' : '另建一个新的包,先放进素材库,不绑到卡上';
    }
    if (g.type === 'card') {
      if (g.duplicate_of) return '';
      const owns = plan.groups.some((x) => x.owner === g.key);
      return owns ? '新建一张卡,一起拖进来的素材挂到它上面' : '新建一张卡';
    }
    if (g.owner === null) return '先放进素材库,不绑到卡上';
    if (g.owner !== 'target') return `跟着角色卡「${cardName(g.owner)}」一起挂上`;
    if (g.type === 'sprite_pack') return spriteEffect(g);
    if (g.type === 'scene_pack') {
      const { word } = sceneWhat(g);
      // 中文和英文之间空一格:「挂成刻晴的 BGM」
      return `挂成${who}的${/^[A-Za-z]/.test(word) ? ' ' : ''}${word},接在已有的后面`;
    }
    return `挂成${who}的 CG,接在已有的后面`;
  };

  const rows = plan.groups.map((g): ConfirmRow => ({
    key: g.key,
    ...titleOf(g),
    effect: effectOf(g),
    choice: g.duplicate_of ? (g.type === 'card' ? cardChoice(g) : packChoice(g)) : null,
  }));

  return {
    title: target.cardId ? `给「${who}」挂上这些素材?` : '导入这些素材?',
    confirmLabel: target.cardId ? '确定挂上' : '导入',
    rows,
    makeCurrent: canSwitch
      ? { key: mine[0].key, label: mine.length > 1 ? `挂上以后直接换成第一套「${mine[0].name}」` : '挂上以后直接换成这套' }
      : null,
    unknown: plan.unknown.map((path) => ({ path, name: fileName(path), folder: folderOf(path) })),
    skipped: plan.skipped,
  };
}

/** 重复的那几组一律先选「另存一份 / 另存一张」(10-15 定:重复导入默认另存一份) */
export function defaultDecisions(plan: ImportPlan): Record<string, ImportDecision> {
  return Object.fromEntries(plan.groups.filter((g) => g.duplicate_of).map((g) => [g.key, 'new' as const]));
}

/** 发给 apply 的:只带有选择的那几组、选了类型的文件;没给「换成这套」那个勾选框时不换 */
export function applyBody(
  model: ConfirmModel,
  decisions: Readonly<Record<string, ImportDecision>>,
  classify: Readonly<Record<string, ClassifyKind | null>>,
  makeCurrent: boolean,
  bundlePresets: Readonly<Record<string, boolean>> = {},
  voiceConnections: Readonly<Record<string, string>> = {},
  voiceFolders: Readonly<Record<string, VoiceFolderEdit>> = {},
): ImportApplyBody {
  const choosable = new Set(model.rows.filter((r) => r.choice).map((r) => r.key));
  const groups = new Set(model.rows.map((r) => r.key));
  const options: NonNullable<ImportApplyBody['options']> = {};
  for (const [k, preset] of Object.entries(bundlePresets)) if (groups.has(k)) options[k] = { preset };
  for (const [k, id] of Object.entries(voiceConnections)) if (groups.has(k) && id) options[k] = { ...options[k], connection_id: id };
  for (const [k, edit] of Object.entries(voiceFolders)) {
    if (!groups.has(k)) continue;
    const name = edit.name?.trim();
    options[k] = { ...options[k], ...(name ? { name } : {}), ...(edit.lang ? { lang: edit.lang } : {}) };
  }
  return {
    decisions: Object.fromEntries(Object.entries(decisions).filter(([k]) => choosable.has(k))),
    classify: Object.fromEntries(
      Object.entries(classify).filter((e): e is [string, ClassifyKind] => e[1] !== null),
    ),
    make_current: makeCurrent && model.makeCurrent !== null,
    // 角色包那一组:要不要也导入作者建议的预设;带声音的组:导到哪个语音服务
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

/** 要不要先弹确认框:计划说要(拖到卡上、有重复)、有角色包、有声音,或者什么都没认出来、只剩认不出的文件 */
export function shouldConfirm(plan: ImportPlan): boolean {
  return (
    plan.needs_confirm ||
    // 角色包一律先给人看一眼:作者的说明、会新建什么、要不要那套预设
    plan.groups.some((g) => g.type === 'bundle') ||
    // 声音包也问:导到哪个语音服务,还要提醒模型会执行代码
    planHasVoices(plan) ||
    (plan.groups.length === 0 && plan.unknown.length > 0)
  );
}

/** 一样都没认出来(全是无关文件):不用执行 */
export function nothingToImport(plan: ImportPlan): boolean {
  return plan.groups.length === 0 && plan.unknown.length === 0;
}

/** 导完打开素材页的哪一栏:拖到哪一栏就开哪一栏;否则按立绘、背景、BGM、CG 的先后开第一种进来了的 */
export function slotAfterImport(plan: ImportPlan, kind: ImportKind | null): SlotKey {
  if (kind) return kind;
  const has = (pred: (g: ImportGroup) => boolean) => plan.groups.some(pred);
  if (has((g) => g.type === 'sprite_pack')) return 'sprite';
  if (has((g) => g.type === 'scene_pack' && (g.bg_count ?? 0) > 0)) return 'bg';
  if (has((g) => g.type === 'scene_pack' && (g.bgm_count ?? 0) > 0)) return 'bgm';
  if (has((g) => g.type === 'cg_pack')) return 'cg';
  return 'sprite';
}

/** 卡编辑器素材页 / 素材管理页顶上那条提示 */
export function noticeOf(result: ImportResult): ImportNotice {
  return { ...result.notice, jobId: result.job_id, report: result.report, voices: result.created?.voices };
}

/** 场景包有几张背景、几首曲子(lib/api 的 ScenePack 里这几样就够) */
export type SceneSides = Pick<ScenePack, 'id' | 'bg_count' | 'bgm_count'>;

/** 场景包开在哪一页:有背景开「背景」,只有曲子开「BGM」;两边都空、读不到也开「背景」(空包两边都列) */
function sceneTab(id: string, packs: readonly SceneSides[] | null): 'bg' | 'bgm' {
  const p = packs?.find((x) => x.id === id);
  return p && p.bg_count === 0 && p.bgm_count > 0 ? 'bgm' : 'bg';
}

/**
 * 没有卡可开(只导了包、没拖到卡上)时素材管理页开在哪:
 * 1. 第一个新建的包 —— 按立绘、场景包、CG、声音的先后(和 slotAfterImport 一样),选中它;
 * 2. 什么都没新建、选了「不导这份」(库里有一模一样的):开计划里第一个这样的包那一类,选中库里那份;
 * 3. 都不是(只剩认不出的文件、后端是旧版没给 created):开「导入记录」,标出这一次。
 * scenePacks:新建的场景包有没有背景(读不到给 null)
 */
export function libraryRouteAfterImport(
  result: ImportResult,
  plan: ImportPlan,
  body: ImportApplyBody,
  scenePacks: readonly SceneSides[] | null,
): LibraryRoute {
  const c = result.created;
  if (c?.sprite_packs[0]) return { tab: 'sprite', id: c.sprite_packs[0] };
  if (c?.scene_packs[0]) return { tab: sceneTab(c.scene_packs[0], scenePacks), id: c.scene_packs[0] };
  if (c?.cg_packs[0]) return { tab: 'cg', id: c.cg_packs[0] };
  if (c?.voices?.[0]) return { tab: 'voice', id: c.voices[0] };
  // 导的是库里已经有的声音:打开那一条
  const twin = plan.groups.map((g) => voiceFolderDetail(g)?.existing).find((x) => x);
  if (twin) return { tab: 'voice', id: twin.id };
  const shared = plan.groups.find((g) => g.type !== 'card' && g.duplicate_of && body.decisions?.[g.key] === 'share');
  if (shared?.duplicate_of) {
    const id = shared.duplicate_of.id;
    if (shared.type === 'sprite_pack') return { tab: 'sprite', id };
    if (shared.type === 'cg_pack') return { tab: 'cg', id };
    return { tab: (shared.bg_count ?? 0) === 0 && (shared.bgm_count ?? 0) > 0 ? 'bgm' : 'bg', id };
  }
  return { tab: 'jobs', id: result.job_id };
}

/** 出错时的一句话。后端的话已经说清楚的(文件太大、「导入失败,库里什么都没改……」)原样用 */
export function importErrorText(e: unknown, prefix = '导入失败'): string {
  const message = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 413 || message.startsWith(prefix)) return message;
  return `${prefix}:${message}`;
}

/** 上传中途点了取消(DOMException 在老浏览器里不算 Error,按名字认) */
export const isAbort = (e: unknown) => (e as { name?: unknown } | null)?.name === 'AbortError';

// ---------------------------------------------------------------- 游戏里的「导入完成」

/** 这次新建了的那几类才列;老后端没给 created 就都列(「没有立绘包」这类空行不列) */
export function doneRows(bind: PickBind | undefined, spriteCount: number, created: ImportCreated | undefined): PickRow[] {
  const made: Record<PickRow['kind'], boolean> = created
    ? {
        sprite: created.sprite_packs.length > 0,
        scene: created.scene_packs.length > 0 || created.cg_packs.length > 0,
        voice: (created.voices?.length ?? 0) > 0,
        preset: (created.presets?.length ?? 0) > 0,
        persona: false,
      }
    : { sprite: true, scene: true, voice: true, preset: true, persona: false };
  return pickRows(bind, spriteCount).filter((r) => made[r.kind] && !r.v.startsWith('没有'));
}
