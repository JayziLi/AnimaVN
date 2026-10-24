/**
 * 生图卡带的设置。全局一份存 app_settings 的 plugin.imagegen;按卡的一份(外貌、画风另选、只画全年龄、这张卡关自动)
 * 存 card_prefs 的同一个键,卡带自己读写、自己合并(不走 cardPrefs.ts 的字段白名单:那边是「全局之上改几项」,
 * 外貌这类本来就只属于一张卡)。纯函数,有测试。
 */

import { DEFAULT_HOLD_LINES } from './marks';

export const IMAGEGEN_SETTING_KEY = 'plugin.imagegen';

export type SizeKey = 'landscape' | 'portrait' | 'square' | 'screen';
export type Gender = 'female' | 'male';
export type WriterThinking = 'off' | 'conn';
/** 镜头:pov 第一人称(玩家是镜头,不画玩家)/ auto 指导模型每张挑 / third 第三人称(玩家画成看不清脸的男生) */
export type Camera = 'pov' | 'auto' | 'third';
export const CAMERAS: readonly { value: Camera; name: string }[] = [
  { value: 'pov', name: '第一人称' },
  { value: 'auto', name: '让指导模型挑' },
  { value: 'third', name: '第三人称' },
];
const isCamera = (v: unknown): v is Camera => v === 'pov' || v === 'auto' || v === 'third';

/** size 是方向:横 / 竖 / 方,「跟屏幕走」竖屏用竖的、横屏用横的;多大看分辨率预设(res) */
export const SIZE_KEYS: readonly SizeKey[] = ['landscape', 'portrait', 'square', 'screen'];
export const SIZE_NAMES: Record<SizeKey, string> = { landscape: '横', portrait: '竖', square: '方', screen: '跟屏幕走' };

type Orient = Exclude<SizeKey, 'screen'>;
type Size = { w: number; h: number };
/** 分辨率预设(10-12 照 NovelAI 网页抄的,宽屏是我们加的:贴合游戏画面,还在免费范围里) */
export type ResPreset = 'wide' | 'normal' | 'large' | 'wallpaper' | 'small' | 'custom';
export const RESOLUTIONS: readonly { value: ResPreset; name: string; sizes: Partial<Record<Orient, Size>> }[] = [
  {
    value: 'wide',
    name: '宽屏 16:9(配游戏画面)',
    sizes: { landscape: { w: 1344, h: 768 }, portrait: { w: 768, h: 1344 }, square: { w: 1024, h: 1024 } },
  },
  {
    value: 'normal',
    name: 'Normal',
    sizes: { landscape: { w: 1216, h: 832 }, portrait: { w: 832, h: 1216 }, square: { w: 1024, h: 1024 } },
  },
  {
    value: 'large',
    name: 'Large',
    sizes: { landscape: { w: 1536, h: 1024 }, portrait: { w: 1024, h: 1536 }, square: { w: 1472, h: 1472 } },
  },
  { value: 'wallpaper', name: 'Wallpaper', sizes: { landscape: { w: 1920, h: 1088 }, portrait: { w: 1088, h: 1920 } } },
  {
    value: 'small',
    name: 'Small',
    sizes: { landscape: { w: 768, h: 512 }, portrait: { w: 512, h: 768 }, square: { w: 640, h: 640 } },
  },
  { value: 'custom', name: '自定义 Custom', sizes: {} },
];
const isRes = (v: unknown): v is ResPreset => RESOLUTIONS.some((r) => r.value === v);
/** 这个预设能选的方向(Wallpaper 没有方的) */
export const orientsOf = (res: ResPreset): SizeKey[] =>
  res === 'wallpaper' ? SIZE_KEYS.filter((k) => k !== 'square') : [...SIZE_KEYS];
/** 自定义的边长:64 的倍数,256–2048(后端收的范围) */
export const snapSide = (v: number) => Math.min(2048, Math.max(256, Math.round(v / 64) * 64));

/** 采样器:NovelAI 网页给 V4.5 / V5 列的那几个 */
export const SAMPLERS: readonly { value: string; name: string }[] = [
  { value: 'k_euler_ancestral', name: 'Euler Ancestral(推荐)' },
  { value: 'k_euler', name: 'Euler' },
  { value: 'k_dpmpp_2s_ancestral', name: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m_sde', name: 'DPM++ 2M SDE' },
  { value: 'k_dpmpp_2m', name: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', name: 'DPM++ SDE' },
];
/** 噪声调度(只有 V4.5 能选,V5 固定 Karras) */
export type NoiseSchedule = 'karras' | 'exponential' | 'polyexponential';
export const NOISES: readonly { value: NoiseSchedule; name: string }[] = [
  { value: 'karras', name: 'Karras' },
  { value: 'exponential', name: 'Exponential' },
  { value: 'polyexponential', name: 'Polyexponential' },
];
/** 换采样器时噪声调度跟着换成它的默认(网页也这样) */
export const noiseFor = (sampler: string): NoiseSchedule => (sampler === 'k_dpmpp_2m' ? 'exponential' : 'karras');

/** 质量词(Quality Tags)、反向预设(UC Preset):原文在后端,按最后用的模型挑 */
export type QualityPreset = 'standard' | 'light' | 'none';
export type UcPreset = 'heavy' | 'light' | 'human' | 'none';
export const UC_PRESETS: readonly { value: UcPreset; name: string }[] = [
  { value: 'heavy', name: 'Heavy' },
  { value: 'light', name: 'Light' },
  { value: 'human', name: 'Human Focus' },
  { value: 'none', name: 'None' },
];
/** 这个模型的质量词选项(V4.5 只有 Standard) */
export const qualityOptions = (model: string): { value: QualityPreset; name: string }[] => [
  { value: 'standard', name: 'Standard' },
  ...(model.startsWith('nai-diffusion-5') ? [{ value: 'light' as const, name: 'Light' }] : []),
  { value: 'none', name: 'None' },
];
/** 网页上每个模型默认的引导 */
export const defaultScale = (model: string) => (model.startsWith('nai-diffusion-5') ? 7 : 5);

export const MODELS: readonly { id: string; name: string }[] = [
  { id: 'nai-diffusion-5-curated', name: 'V5 Curated(全年龄)' },
  { id: 'nai-diffusion-5-full', name: 'V5 Full' },
  { id: 'nai-diffusion-4-5-full', name: 'V4.5 Full(Opus 不限张数)' },
  { id: 'nai-diffusion-4-5-curated', name: 'V4.5 Curated(全年龄,Opus 不限张数)' },
];

/** 只画全年龄的卡画的时候换成的模型(和后端 nai.SFW_OF 一样) */
export const SFW_MODEL: Record<string, string> = {
  'nai-diffusion-5-full': 'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full': 'nai-diffusion-4-5-curated',
};

/** 以前默认的反向:NovelAI 网页 V5 的「Light」反向预设原文(10-09 从用户贴的图里读出来的)。
 *  10-12 起反向预设按名字存(ucPreset),原文在后端;这串只用来认出库里存的旧设置 */
export const UC_LIGHT =
  'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::';

export interface ImageStyle {
  id: string;
  name: string;
  tags: string;
  negative: string;
  /** 画师串(artist:xxx, …):放在人数标签后面 */
  artists: string;
}

/** 内置画风。速写漫画是用户 10-09 挑的那张(加 spot color,发色单独上色,认得出是谁);
 *  10-12 用户看了 36 位画师的原图挑了几位,一张图一位画师比过以后定了两套(第 4 版,之前加的十几套都去掉了) */
export const BUILTIN_STYLES: readonly ImageStyle[] = [
  { id: 'fuzi_rella', name: 'fuzichoco + rella', tags: 'anime coloring', negative: '', artists: 'artist:fuzichoco, artist:rella' },
  {
    id: 'yd_hiten',
    name: 'yd + hiten',
    tags: 'anime coloring',
    negative: '',
    artists: 'artist:yd (orange maru), artist:hiten (hitenkei)',
  },
  {
    id: 'sketch',
    name: '速写漫画 · 黑白点色',
    tags: 'dynamic, soft shadow, rough sketch, manga style, monochrome, greyscale, spot color',
    negative: '',
    artists: '',
  },
  { id: 'anime', name: '彩色动画', tags: 'flat color, cel shading, anime coloring', negative: '', artists: '' },
  { id: 'plain', name: '不加画风', tags: '', negative: '', artists: '' },
];
const STYLES_VERSION = 4;
/** 每一版新加的内置画风:库里存的版本比它旧就补在后面 */
const ADDED_IN: Record<number, readonly string[]> = { 4: ['fuzi_rella', 'yd_hiten'] };
/** 第 4 版去掉的(第 2、3 版加的,用户看过说不要):库里存的版本比 4 旧就删掉 */
const REMOVED_IN_4 = [
  'galgame', 'soft', 'painterly', 'watercolor', 'retro',
  'arca9', 'arcafine', 'nai5bot', 'softpaint',
];
/** 以前版本里内置画风的样子:库里那份和它一样(没动过)就换成现在的 */
const OLD_BUILTINS: Record<string, Omit<ImageStyle, 'id'>> = {
  anime: { name: '动画截图 · 干净平涂', tags: 'anime screencap, anime coloring, cel shading, detailed background', negative: '3d, realistic', artists: 'artist:mignon' },
};
export const DEFAULT_STYLE_ID = 'fuzi_rella';

export interface PlayerLook {
  look: string;
  /** 平时穿的(10-22 起只当参考给指导模型看,画的时候照它写的这一刻穿的) */
  outfit: string;
  negative: string;
  gender: Gender;
}

export interface ImageGenConfig {
  model: string;
  /** 方向(横 / 竖 / 方 / 跟屏幕走) */
  size: SizeKey;
  /** 分辨率预设;custom 用 custom 的宽高(按方向对调) */
  res: ResPreset;
  custom: Size;
  steps: number;
  scale: number;
  sampler: string;
  noise: NoiseSchedule;
  /** 种子;null = 每张随机 */
  seed: number | null;
  /** 引导重缩放(Prompt Guidance Rescale,0–1) */
  rescale: number;
  /** Variety+(只 V4.5) */
  variety: boolean;
  /** 质量词(Quality Tags) */
  quality: QualityPreset;
  /** 反向预设(UC Preset) */
  ucPreset: UcPreset;
  /** 反向预设之外另外写的反向 */
  uc: string;
  /** 一张图在游戏里至少显示几句(从玩家第一次看到它的那句算,含那句;过了指导模型判的结束句也挂够) */
  holdLines: number;
  /** 图在游戏里放哪:above 对话框上面那一块(整张居中,不被挡,默认)/ screen 铺满屏幕 */
  place: 'above' | 'screen';
  /** 内置画风是第几版(新加的内置画风补进库里那份用) */
  stylesVersion: number;
  /** 超出免费范围也画(每张扣 Anlas) */
  allowPaid: boolean;
  styles: ImageStyle[];
  styleId: string;
  writer: { connectionId: string | null; thinking: WriterThinking };
  /** 改写过的说明书;null = 用后端默认的 */
  skills: {
    manual: string | null;
    auto: string | null;
    /** 每条回复写完记状态笔记的说明书 */
    note: string | null;
  };
  auto: { enabled: boolean; cooldown: number };
  /** 镜头(10-12 用户定默认第一人称;只有这一个全局设置,临时换在右键画笔的设置里) */
  camera: Camera;
  /** 第三人称、两人同框时男主(玩家)的样子;第一人称时只用「平时穿的」定袖子颜色 */
  player: PlayerLook;
}

export const DEFAULT_PLAYER: PlayerLook = {
  look: 'faceless male, short black hair',
  outfit: 'black shirt',
  negative: 'long hair',
  gender: 'male',
};

export const DEFAULT_IMAGEGEN_CONFIG: ImageGenConfig = {
  model: MODELS[0].id,
  size: 'screen',
  res: 'wide',
  custom: { w: 1344, h: 768 },
  steps: 23,
  scale: 7,
  sampler: 'k_euler_ancestral',
  noise: 'karras',
  seed: null,
  rescale: 0,
  variety: false,
  quality: 'standard',
  ucPreset: 'light',
  uc: '',
  holdLines: DEFAULT_HOLD_LINES,
  place: 'above',
  stylesVersion: STYLES_VERSION,
  allowPaid: false,
  styles: BUILTIN_STYLES.map((s) => ({ ...s })),
  styleId: DEFAULT_STYLE_ID,
  writer: { connectionId: null, thinking: 'off' },
  skills: {
    manual: null,
    auto: null,
    note: null,
  },
  auto: { enabled: true, cooldown: 3 },
  camera: 'pov',
  player: DEFAULT_PLAYER,
};

/** 参考图(只有 V4.5 能用):sprite = 立绘(id 是 null = 当前立绘包的默认立绘)/ upload = 上传的 / off = 不用 */
export type RefKind = 'sprite' | 'upload' | 'off';
export interface CardRef {
  kind: RefKind;
  /** 选的立绘编号 / 上传的编号;null = 默认立绘 */
  id: string | null;
  /** 预览用的指纹 */
  sha: string | null;
  /** 连画风一起参考(默认只参考人,画风照这里选的) */
  style: boolean;
}
export const DEFAULT_CARD_REF: CardRef = { kind: 'sprite', id: null, sha: null, style: false };

/** 这张卡自己的那份 */
export interface CardImagePrefs {
  /** 角色名标签(danbooru 写法,比如 keqing (genshin impact));NovelAI 认得的角色写名字最像,原创角色空着 */
  nameTag: string;
  /** 角色的长相(英文标签):发型发色、瞳色、身材 */
  look: string;
  /** 平时穿的(指导模型写了这一刻穿什么就换掉它) */
  outfit: string;
  negative: string;
  gender: Gender;
  /** 画风另选;null = 跟全局 */
  styleId: string | null;
  sfwOnly: boolean;
  /** 这张卡不自动出图 */
  autoOff: boolean;
  /** 画师串;空 = 跟画风 */
  artists: string;
  ref: CardRef;
}

export const DEFAULT_CARD_PREFS: CardImagePrefs = {
  nameTag: '',
  look: '',
  outfit: '',
  negative: '',
  gender: 'female',
  styleId: null,
  sfwOnly: false,
  autoOff: false,
  artists: '',
  ref: DEFAULT_CARD_REF,
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d: string, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : d);
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const gender = (v: unknown, d: Gender): Gender => (v === 'female' || v === 'male' ? v : d);
const nullableText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.slice(0, 8000) : null);

function normalizeStyles(v: unknown): ImageStyle[] {
  if (!Array.isArray(v)) return DEFAULT_IMAGEGEN_CONFIG.styles.map((s) => ({ ...s }));
  const out: ImageStyle[] = [];
  const seen = new Set<string>();
  for (const s of v) {
    if (!isObj(s) || typeof s.id !== 'string' || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      name: str(s.name, s.id, 60) || s.id,
      tags: str(s.tags, ''),
      negative: str(s.negative, ''),
      artists: str(s.artists, ''),
    });
  }
  return out.length ? out : DEFAULT_IMAGEGEN_CONFIG.styles.map((x) => ({ ...x }));
}

/** 库里存的是旧版内置画风:第 4 版去掉的删掉,没动过的旧版换成现在的,新加的补在后面;
 *  记了版本号以后,玩家自己再删掉的不会冒回来 */
function upgradeStyles(styles: ImageStyle[], version: number): ImageStyle[] {
  if (version >= STYLES_VERSION) return styles;
  const same = (a: Omit<ImageStyle, 'id'>, b: Omit<ImageStyle, 'id'>) =>
    a.name === b.name && a.tags === b.tags && a.negative === b.negative && a.artists === b.artists;
  const out = styles
    .filter((s) => !(version < 4 && REMOVED_IN_4.includes(s.id)))
    .map((s) => {
      const old = OLD_BUILTINS[s.id];
      const now = BUILTIN_STYLES.find((b) => b.id === s.id);
      return old && now && same(s, old) ? { ...now } : s;
    });
  for (let v = version + 1; v <= STYLES_VERSION; v++) {
    for (const id of ADDED_IN[v] ?? []) {
      const b = BUILTIN_STYLES.find((x) => x.id === id);
      if (b && !out.some((s) => s.id === id)) out.unshift({ ...b });
    }
  }
  return out.length ? out : BUILTIN_STYLES.map((x) => ({ ...x }));
}

const isUcPreset = (v: unknown): v is UcPreset => UC_PRESETS.some((p) => p.value === v);
const isNoise = (v: unknown): v is NoiseSchedule => NOISES.some((p) => p.value === v);
function quality(v: unknown): QualityPreset {
  if (v === 'standard' || v === 'light' || v === 'none') return v;
  return v === false ? 'none' : 'standard';
}
/** 反向:以前存的是一整串(默认是 V5 的 Light 原文)。是那串 → Light 预设;自己改过的 → 不用预设、原样留着 */
function ucOf(raw: Record<string, unknown>): { ucPreset: UcPreset; uc: string } {
  if (isUcPreset(raw.ucPreset)) return { ucPreset: raw.ucPreset, uc: str(raw.uc, '') };
  if (raw.uc === undefined || raw.uc === UC_LIGHT) return { ucPreset: 'light', uc: '' };
  return { ucPreset: 'none', uc: str(raw.uc, '') };
}

export function normalizeImageGenConfig(raw: unknown): ImageGenConfig {
  const d = DEFAULT_IMAGEGEN_CONFIG;
  if (!isObj(raw)) return { ...d, styles: d.styles.map((s) => ({ ...s })) };
  const styles = Array.isArray(raw.styles)
    ? upgradeStyles(normalizeStyles(raw.styles), Math.round(num(raw.stylesVersion, 1, 1, 99)))
    : normalizeStyles(undefined);
  // 选的画风去掉了:换成默认的那套(还在的话)
  const fallback = styles.some((s) => s.id === DEFAULT_STYLE_ID) ? DEFAULT_STYLE_ID : styles[0].id;
  const styleId = typeof raw.styleId === 'string' && styles.some((s) => s.id === raw.styleId) ? raw.styleId : fallback;
  const writer = isObj(raw.writer) ? raw.writer : {};
  const skills = isObj(raw.skills) ? raw.skills : {};
  const auto = isObj(raw.auto) ? raw.auto : {};
  const player = isObj(raw.player) ? raw.player : {};
  const custom = isObj(raw.custom) ? raw.custom : {};
  const sampler = typeof raw.sampler === 'string' && SAMPLERS.some((s) => s.value === raw.sampler) ? raw.sampler : d.sampler;
  return {
    model: typeof raw.model === 'string' && MODELS.some((m) => m.id === raw.model) ? raw.model : d.model,
    size: SIZE_KEYS.includes(raw.size as SizeKey) ? (raw.size as SizeKey) : d.size,
    // 以前没有预设:横是 1344×768、竖 832×1216,宽屏最接近
    res: isRes(raw.res) ? raw.res : d.res,
    custom: { w: snapSide(num(custom.w, d.custom.w, 256, 2048)), h: snapSide(num(custom.h, d.custom.h, 256, 2048)) },
    steps: Math.round(num(raw.steps, d.steps, 1, 50)),
    scale: Math.round(num(raw.scale, d.scale, 0, 10) * 10) / 10,
    sampler,
    noise: isNoise(raw.noise) ? raw.noise : noiseFor(sampler),
    seed: typeof raw.seed === 'number' && Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed <= 4294967295 ? raw.seed : null,
    rescale: Math.round(num(raw.rescale, d.rescale, 0, 1) * 100) / 100,
    variety: bool(raw.variety, d.variety),
    quality: quality(raw.quality),
    ...ucOf(raw),
    holdLines: Math.round(num(raw.holdLines, d.holdLines, 1, 20)),
    place: raw.place === 'screen' ? 'screen' : 'above',
    stylesVersion: STYLES_VERSION,
    allowPaid: bool(raw.allowPaid, d.allowPaid),
    styles,
    styleId,
    writer: {
      connectionId: typeof writer.connectionId === 'string' && writer.connectionId ? writer.connectionId : null,
      thinking: writer.thinking === 'conn' ? 'conn' : 'off',
    },
    skills: {
      manual: nullableText(skills.manual),
      auto: nullableText(skills.auto),
      note: nullableText(skills.note),
    },
    auto: { enabled: bool(auto.enabled, d.auto.enabled), cooldown: Math.round(num(auto.cooldown, d.auto.cooldown, 0, 20)) },
    camera: isCamera(raw.camera) ? raw.camera : d.camera,
    player: {
      look: str(player.look, d.player.look),
      outfit: str(player.outfit, d.player.outfit),
      negative: str(player.negative, d.player.negative),
      gender: gender(player.gender, d.player.gender),
    },
  };
}

const id = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 64) : null);

function normalizeRef(raw: unknown): CardRef {
  const d = DEFAULT_CARD_REF;
  if (!isObj(raw)) return { ...d };
  const kind: RefKind = raw.kind === 'upload' || raw.kind === 'off' ? raw.kind : 'sprite';
  // 上传的没有编号就是没传成:退回默认立绘
  if (kind === 'upload' && !id(raw.id)) return { ...d, style: bool(raw.style, d.style) };
  return { kind, id: kind === 'off' ? null : id(raw.id), sha: kind === 'off' ? null : id(raw.sha), style: bool(raw.style, d.style) };
}

export function normalizeCardPrefs(raw: unknown): CardImagePrefs {
  const d = DEFAULT_CARD_PREFS;
  if (!isObj(raw)) return { ...d, ref: { ...d.ref } };
  return {
    nameTag: str(raw.nameTag, d.nameTag, 200),
    look: str(raw.look, d.look),
    outfit: str(raw.outfit, d.outfit),
    negative: str(raw.negative, d.negative),
    gender: gender(raw.gender, d.gender),
    styleId: typeof raw.styleId === 'string' && raw.styleId ? raw.styleId : null,
    sfwOnly: bool(raw.sfwOnly, d.sfwOnly),
    autoOff: bool(raw.autoOff, d.autoOff),
    artists: str(raw.artists, d.artists),
    ref: normalizeRef(raw.ref),
  };
}

/** 这张卡用哪个画风:卡另选的(还在)> 全局选的 > 第一个 */
export function styleFor(config: ImageGenConfig, prefs: CardImagePrefs): ImageStyle {
  return (
    config.styles.find((s) => s.id === prefs.styleId) ??
    config.styles.find((s) => s.id === config.styleId) ??
    config.styles[0]
  );
}

/** 指导模型读卡写的外貌并进这张卡的设置:角色名没认出来时留着原来的,衣服没写时也留着 */
export function withLook(
  prefs: CardImagePrefs,
  r: { tags: string; outfit: string; gender: Gender; name_tag?: string },
): CardImagePrefs {
  return { ...prefs, look: r.tags, outfit: r.outfit || prefs.outfit, gender: r.gender, nameTag: r.name_tag || prefs.nameTag };
}

/** 出图用的画风:卡另选的 > 全局的(styleFor) */
export function drawStyle(config: ImageGenConfig, prefs: CardImagePrefs): ImageStyle {
  return styleFor(config, prefs);
}

/** 出图用的模型:只画全年龄的卡换成 Curated(后端也会换,结果一样) */
export function drawModel(config: ImageGenConfig, prefs: CardImagePrefs): string {
  if (prefs.sfwOnly) return SFW_MODEL[config.model] ?? config.model;
  return config.model;
}

/** 这张卡用的画师串:卡上填了用卡的,没填跟这次用的画风 */
export function artistsFor(config: ImageGenConfig, prefs: CardImagePrefs): string {
  return prefs.artists.trim() || drawStyle(config, prefs).artists;
}

/** 角色参考只有 V4.5 能用(10-09 实测 V5 发了回 500) */
export const supportsReference = (model: string) => model.startsWith('nai-diffusion-4-5');

/** 这次出图带不带参考图:模型能用、卡上没关 */
export const usesReference = (config: ImageGenConfig, prefs: CardImagePrefs) =>
  supportsReference(config.model) && prefs.ref.kind !== 'off';

/** 画多大:分辨率预设 × 方向;「跟屏幕走」看窗口是竖的还是横的。自定义的按方向把长边短边对调,方的取同样面积 */
export function sizeOf(
  c: Pick<ImageGenConfig, 'res' | 'custom'>,
  key: SizeKey,
  screen: { width: number; height: number },
): Size {
  const o: Orient = key === 'screen' ? (screen.height > screen.width ? 'portrait' : 'landscape') : key;
  if (c.res === 'custom') {
    const long = Math.max(c.custom.w, c.custom.h);
    const short = Math.min(c.custom.w, c.custom.h);
    if (o === 'square') {
      const side = snapSide(Math.sqrt(c.custom.w * c.custom.h));
      return { w: side, h: side };
    }
    return o === 'portrait' ? { w: short, h: long } : { w: long, h: short };
  }
  const sizes = (RESOLUTIONS.find((r) => r.value === c.res) ?? RESOLUTIONS[0]).sizes;
  return sizes[o] ?? sizes.landscape ?? { w: 1344, h: 768 };
}

/** Opus 免费范围:面积不超过 1024×1024、不超过 28 步 */
export const isFree = (w: number, h: number, steps: number) => w * h <= 1024 * 1024 && steps <= 28;

/** 带参考图每张另扣的(10-12 Opus 上 V4.5 实测) */
export const REFERENCE_ANLAS = 5;

/** 一张扣多少 Anlas(10-12 照 NovelAI 网页前端的算法抄的):Opus 在免费范围里是 0(V5 走额度条);
 *  不是 Opus 或者超出免费范围按面积和步数算,V5 贵一半,最少 2。参考图另算(REFERENCE_ANLAS) */
export function anlasCost(o: { model: string; w: number; h: number; steps: number; opus: boolean }): number {
  if (o.opus && isFree(o.w, o.h, o.steps)) return 0;
  const px = Math.max(o.w * o.h, 65536);
  let n = Math.ceil(2.951823174884865e-6 * px + 5.753298233447344e-7 * px * o.steps);
  if (o.model.startsWith('nai-diffusion-5')) n *= 1.5;
  return Math.max(Math.ceil(n), 2);
}
