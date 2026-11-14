/**
 * 画图连接(11-07,设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 2、7、11 节)界面上用的纯逻辑:
 * 卡片小字、连上后自动起的名字、为什么画不了、实际发出去的大小、按钮上写的花费、查连接的结果、相册里的用时。
 * 有测试(connModel.test.ts)。
 */

import type { CheckResult, ConnKind, GeneratedImage, ImageConn, ImageConnPatch, NaiAccount } from './api';
import {
  anlasCost,
  NOISES,
  qualityOptions,
  REFERENCE_ANLAS,
  SAMPLERS,
  sizeOf,
  snapSide,
  supportsReference,
  usesReference,
  type CardImagePrefs,
  type ImageGenConfig,
} from './config';
import type { ImageSetup } from './setup';

export const KIND_NAMES: Record<ConnKind, string> = { novelai: 'NovelAI', sdapi: '本地 SD', openai: '中转站' };
/** 加一条连接小窗里三种的顺序,和每种下面那行小字(效果图 2) */
export const KIND_ORDER: readonly ConnKind[] = ['openai', 'novelai', 'sdapi'];
export const KIND_HINTS: Record<ConnKind, string> = { openai: 'OpenAI 兼容接口', novelai: '官方', sdapi: 'A1111 · Forge' };
/** 每种要填什么(设计第 2 节的表);NovelAI 不填地址 = 官方 */
export const KIND_FIELDS: Record<ConnKind, { url: boolean; urlPlaceholder: string; key: string; keyPlaceholder: string }> = {
  openai: { url: true, urlPlaceholder: 'https://你的中转站/v1', key: 'Key', keyPlaceholder: 'sk-…' },
  novelai: { url: false, urlPlaceholder: '', key: 'Token', keyPlaceholder: 'pst- 开头的那串' },
  sdapi: { url: true, urlPlaceholder: 'http://地址:7860', key: '用户:密码', keyPlaceholder: '可不填' },
};
/** 「找一找」试的本机地址(A1111、Forge 默认的端口) */
export const LOCAL_SD = 'http://127.0.0.1:7860';
/** 能真出图的连接种类。不在这里的能加、能查(后端回「这种连接还不能用」),画面页、画笔说「这种连接还不能出图」 */
export const DRAWABLE_KINDS: readonly ConnKind[] = ['novelai', 'openai', 'sdapi'];

/** 新加的中转连接默认的可用尺寸(gpt-image 只收这几种),和后端 openai.DEFAULT_SIZES 一样 */
export const DEFAULT_RELAY_SIZES = '1536x1024, 1024x1536, 1024x1024';

export type RelayApi = 'auto' | 'images' | 'chat' | 'gemini';
export const RELAY_APIS: readonly { value: RelayApi; name: string }[] = [
  { value: 'auto', name: '自动' },
  { value: 'images', name: '图片' },
  { value: 'chat', name: '聊天' },
  { value: 'gemini', name: 'Gemini' },
];

/** 这条中转连接的可用尺寸:没存过是默认那几种,存了空串 = 原样发 */
export const relaySizes = (c: Pick<ImageConn, 'options'>): string =>
  typeof c.options.sizes === 'string' ? c.options.sizes : DEFAULT_RELAY_SIZES;

/** 可用尺寸里长宽比最接近的一种,一样接近时挑面积接近的;一种都没填原样(和后端 openai.snap_size 同一个算法) */
export function snapToSizes(want: { w: number; h: number }, sizes: string): { w: number; h: number } {
  const found = [...sizes.matchAll(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
  if (found.length === 0) return want;
  const gap = (s: { w: number; h: number }) => Math.round(Math.abs(s.w / s.h - want.w / want.h) * 1e4) / 1e4;
  const area = (s: { w: number; h: number }) => Math.abs(s.w * s.h - want.w * want.h);
  return found.reduce((best, s) => (gap(s) < gap(best) || (gap(s) === gap(best) && area(s) < area(best)) ? s : best));
}

/** 额外参数填得对不对:空的算对;不是 JSON 对象回一句话 */
export function extraError(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? null : '额外参数要是一个 JSON 对象,比如 {"quality": "low"}';
  } catch {
    return '额外参数不是合法的 JSON';
  }
}

/** 这张卡在这条连接下选的模型:设置的默认值是 NovelAI 的模型,别的种类还没选过时算空 */
export const modelOf = (kind: ConnKind, model: string): string => (kind !== 'novelai' && model.startsWith('nai-') ? '' : model);

/** 本地 SD 的采样器:设置的默认值是 NovelAI 的 k_ 开头那种,还没选过时算空(服务默认) */
export const sdSampler = (sampler: string): string => (sampler.startsWith('k_') ? '' : sampler);

/** 质量词的选项:本地 SD 三个都有(后端按 SD_QUALITY 转);NovelAI 照模型 */
export const qualityChoices = (kind: ConnKind, model: string) => qualityOptions(kind === 'novelai' ? model : 'nai-diffusion-5');

/** 卡片小字里的地址:去掉 http(s)://;NovelAI 没填是官方地址 */
export function addressText(c: Pick<ImageConn, 'kind' | 'base_url'>): string {
  if (!c.base_url) return c.kind === 'novelai' ? '官方地址' : '没填地址';
  return c.base_url.replace(/^https?:\/\//, '');
}

/** 存之前、比较之前把地址收拾干净:去掉空白和末尾的 /,空的算没填(后端存的时候也这样) */
export function tidyUrl(v: string): string | null {
  return v.trim().replace(/\/+$/, '') || null;
}

/** 输入框里的地址和存着的不一样(NovelAI 没有地址这一项) */
export function urlChanged(conn: Pick<ImageConn, 'kind' | 'base_url'>, url: string): boolean {
  return KIND_FIELDS[conn.kind].url && tidyUrl(url) !== conn.base_url;
}

/** 点「保存」要发的:地址变了带地址,填了 key 带 key;什么都没变是 null */
export function connPatch(conn: Pick<ImageConn, 'kind' | 'base_url'>, url: string, key: string): ImageConnPatch | null {
  const patch: ImageConnPatch = {};
  if (urlChanged(conn, url)) patch.base_url = tidyUrl(url);
  if (key.trim()) patch.api_key = key.trim();
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * key 输入框的灰字。key 只写不读,界面上只有「已保存」三个字;
 * 改了地址又没一起给 key,后端会把旧 key 清掉(免得被别的地址拿走),所以写「要重填」
 */
export function keyHint(conn: Pick<ImageConn, 'kind' | 'base_url' | 'has_key'>, url: string): string {
  if (!conn.has_key) return KIND_FIELDS[conn.kind].keyPlaceholder;
  return urlChanged(conn, url) ? '改了地址,要重填' : '已保存(留空不变)';
}

/** 去掉一个键(按连接存的账户、报错) */
export function without<T>(m: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...m };
  delete next[key];
  return next;
}

/** 地址里的主机名;本机写「本机」 */
function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    const host = new URL(url.includes('://') ? url : `http://${url}`).hostname;
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) ? '本机' : host;
  } catch {
    return url;
  }
}

/** 连上后自动起的名字(玩家能改):「NovelAI · Opus」「本地 SD · 本机」「中转 · api.example.com」 */
export function autoName(kind: ConnKind, baseUrl: string | null, checkMessage: string | null): string {
  if (kind === 'novelai') {
    // 查连接回的是「Opus · Anlas 1200」,没在订阅时档位后面带「(没有在订阅)」
    const tier = (checkMessage ?? '').split(' · ')[0].replace(/[(（].*$/, '').trim();
    return tier ? `NovelAI · ${tier}` : 'NovelAI';
  }
  const host = hostOf(baseUrl);
  if (kind === 'sdapi') return host ? `本地 SD · ${host}` : '本地 SD';
  return host ? `中转 · ${host}` : '中转站';
}

/** 连接编号 → 种类(换连接时「同一种抄原来那条」用) */
export const kindsOf = (conns: readonly ImageConn[] | null): Record<string, ConnKind> =>
  Object.fromEntries((conns ?? []).map((c) => [c.id, c.kind]));

/** 画不了的原因:还没读完 / 一条连接都没有 / 这张卡没选(或者选的删了)/ 选的那种还不能出图 / 中转站还没选模型;能画是 null */
export type DrawBlock = 'loading' | 'none' | 'pick' | 'unsupported' | 'model' | null;

export function drawBlockOf(conns: readonly ImageConn[] | null, setup: ImageSetup | null, hasCard: boolean): DrawBlock {
  if (conns === null || (hasCard && setup === null)) return 'loading';
  if (conns.length === 0) return 'none';
  const c = setup?.conn ? conns.find((x) => x.id === setup.conn) : undefined;
  if (!c) return 'pick';
  if (!DRAWABLE_KINDS.includes(c.kind)) return 'unsupported';
  // 中转站没有默认模型,没选的话发出去的是 NovelAI 的模型名
  const picked = setup?.byConn[c.id]?.model;
  return c.kind === 'openai' && !(typeof picked === 'string' && modelOf(c.kind, picked)) ? 'model' : null;
}

/** 画不了时提示的那句 */
export const BLOCK_TEXT: Record<Exclude<DrawBlock, null>, string> = {
  loading: '生图设置还没读完,等一下再画',
  none: '还没接画图:生图设置 → 连接,加一条',
  pick: '这张卡还没选画图连接:生图设置 → 画面',
  unsupported: '这种画图连接还不能出图',
  model: '这条中转站还没选模型:生图设置 → 画面',
};

/** 实际发出去的大小:NovelAI、本地 SD 对齐 64 的倍数;中转按连接的「可用尺寸」换成最接近的一种(没给 sizes 原样) */
export function sentSize(kind: ConnKind | null, want: { w: number; h: number }, sizes = ''): { w: number; h: number } {
  if (kind === 'openai') return snapToSizes(want, sizes);
  return { w: snapSide(want.w), h: snapSide(want.h) };
}

/** NovelAI 画一张扣多少 Anlas:照网页的算法(config.anlasCost),带参考图另加 5 */
export function novelaiCost(c: ImageGenConfig, size: { w: number; h: number }, opus: boolean, withRef: boolean): number {
  return anlasCost({ model: c.model, w: size.w, h: size.h, steps: c.steps, opus }) + (withRef ? REFERENCE_ANLAS : 0);
}

/** 按钮上写的花费 */
export function costText(kind: ConnKind, anlas: number): string {
  if (kind === 'openai') return '按你的中转站计费';
  if (kind === 'sdapi') return '本地';
  return anlas > 0 ? `扣 ${anlas} Anlas` : '免费';
}

/**
 * 测试出图按钮上的花费:NovelAI 照这张卡在这条连接下的尺寸、步数算(账户查不到按 Opus 算;
 * 没选卡时测试出图不带参考图);本地 SD 写「本地」;中转按中转站计费
 */
export function trialCost(
  conn: Pick<ImageConn, 'kind'>,
  config: ImageGenConfig,
  prefs: CardImagePrefs,
  account: NaiAccount | undefined,
  hasCard: boolean,
  screen: { width: number; height: number },
): string {
  if (conn.kind !== 'novelai') return costText(conn.kind, 0);
  const size = sentSize(conn.kind, sizeOf(config, config.size, screen));
  const opus = account ? account.tier === 3 : true;
  return costText(conn.kind, novelaiCost(config, size, opus, hasCard && usesReference(config, prefs)));
}

/**
 * NovelAI 的账户还在查:这时按钮上的花费是按 Opus 猜的,别的档位点下去可能要扣钱,先别让点。
 * 查到了、查不到(那行写着「按 Opus 算」)、别的种类都不用等
 */
export function costPending(
  conn: Pick<ImageConn, 'id' | 'kind'>,
  accounts: Readonly<Record<string, NaiAccount>>,
  errors: Readonly<Record<string, string>>,
): boolean {
  return conn.kind === 'novelai' && !accounts[conn.id] && errors[conn.id] === undefined;
}

/** 画面页下拉里的一条:自动起的名字里看得出种类,自己起的名字后面带上种类(效果图 3) */
export function connOption(c: Pick<ImageConn, 'name' | 'kind'>): string {
  return c.name.includes(KIND_NAMES[c.kind].replace(/站$/, '')) ? c.name : `${c.name}(${KIND_NAMES[c.kind]})`;
}

/** 「更多」收着时后面那行小字(效果图 3):步数 23 · 引导 5.0 · Euler Ancestral · Karras · 种子随机 */
export function moreSummary(c: Pick<ImageGenConfig, 'model' | 'steps' | 'scale' | 'sampler' | 'noise' | 'seed'>): string {
  const sampler = (SAMPLERS.find((s) => s.value === c.sampler)?.name ?? c.sampler).replace(/[(（].*$/, '').trim();
  // 只有 V4.5 能选噪声调度,V5 固定 Karras
  const noise = supportsReference(c.model) ? (NOISES.find((n) => n.value === c.noise)?.name ?? c.noise) : 'Karras';
  return [`步数 ${c.steps}`, `引导 ${c.scale.toFixed(1)}`, sampler, noise, c.seed === null ? '种子随机' : `种子 ${c.seed}`].join(' · ');
}

/** 本地 SD「更多」收着时那行小字:步数 28 · 引导 6.0 · DPM++ 2M · Karras · 种子随机(没选的不写) */
export function sdMoreSummary(c: Pick<ImageGenConfig, 'steps' | 'scale' | 'sampler' | 'scheduler' | 'seed'>): string {
  return [`步数 ${c.steps}`, `引导 ${c.scale.toFixed(1)}`, sdSampler(c.sampler), c.scheduler, c.seed === null ? '种子随机' : `种子 ${c.seed}`]
    .filter(Boolean)
    .join(' · ');
}

/** 查额度那一行:「Opus · Anlas 1200 · V5 额度还剩 80%」 */
export function accountText(a: NaiAccount): string {
  const tier = a.tier === 3 ? 'Opus' : `等级 ${a.tier ?? '?'}`;
  return `${tier} · Anlas ${a.anlas}${a.v5_percent !== null ? ` · V5 额度还剩 ${a.v5_percent}%` : ''}`;
}

/** 查连接那一行:通了写「通了 · 档位 · 0.4 秒」,没通原样给接口回的原文 */
export function checkText(r: CheckResult): string {
  return r.ok ? `通了 · ${r.message} · ${(r.ms / 1000).toFixed(1)} 秒` : r.message;
}

export type Timing = NonNullable<GeneratedImage['params']['timing']>;

/** 三段用时(排队 / 画 / 传回),测试出图那条横条用;老图没记是空的 */
export function timingParts(t: Timing | undefined): { key: 'queue' | 'draw' | 'fetch'; label: string; ms: number }[] {
  if (!t) return [];
  return [
    { key: 'queue', label: '排队', ms: t.queue },
    { key: 'draw', label: '画', ms: t.draw },
    { key: 'fetch', label: '传回', ms: t.fetch },
  ];
}

const sec = (ms: number) => (ms / 1000).toFixed(1);

/** 相册里那一行:「构思 2.4 · 排队 0.0 · 画 2.8 · 传回 0.3 秒」;老图没记是空串 */
export function timingText(t: Timing | undefined): string {
  if (!t) return '';
  const parts = [
    ...(typeof t.plan === 'number' ? [`构思 ${sec(t.plan)}`] : []),
    ...timingParts(t).map((p) => `${p.label} ${sec(p.ms)}`),
  ];
  return `${parts.join(' · ')} 秒`;
}

/** 哪条连接画的;老图没记是空串 */
export const connectionText = (params: GeneratedImage['params']): string => params.connection?.name ?? '';
