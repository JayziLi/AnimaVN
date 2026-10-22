/**
 * 导出面板(画布 step3 Main)的纯逻辑:每行写什么、点掉的算进 exclude、总大小、文件名、预览图轮换、发给后端的请求体;
 * 素材管理 / 卡编辑器「⋯ → 导出这个包」那一项的字。
 */

import type { ExportBundleBody, ExportBundleItem, ExportBundleSummary, ExportPackKind, ExportPreview } from '../../lib/api';

/** 每个包勾没勾:key → true 带 / false 不带 */
export type ExportChecks = Readonly<Record<string, boolean>>;

/** 打开面板时全都勾着 */
export function initialChecks(summary: ExportBundleSummary): Record<string, boolean> {
  return Object.fromEntries(summary.items.map((it) => [it.key, true]));
}

/** 点掉的包(发给后端的 exclude) */
export function excludeOf(summary: ExportBundleSummary, checks: ExportChecks): string[] {
  return summary.items.filter((it) => checks[it.key] === false).map((it) => it.key);
}

/** 一共多大:卡 + 勾着的包 + 勾着的预设 */
export function totalBytes(summary: ExportBundleSummary, checks: ExportChecks, withPreset: boolean): number {
  const packs = summary.items.reduce((n, it) => n + (checks[it.key] === false ? 0 : it.bytes), 0);
  return summary.card_bytes + packs + (withPreset && summary.preset ? summary.preset.bytes : 0);
}

/** 存成什么名字:后端给了就用它,没给用卡名 */
export function fileNameOf(summary: ExportBundleSummary): string {
  return summary.file_name || `${summary.title || '角色'}.animavn`;
}

/** 每行右边的大小:「21.3 MB」;很小的写「<0.1 MB」 */
export function rowSize(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb < 0.05) return '<0.1 MB';
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1000).toFixed(1)} GB`;
}

/** 底部的总大小:「约 58 MB」;10 MB 以下留一位小数 */
export function totalLabel(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb < 0.05) return '约 0.1 MB';
  if (mb < 10) return `约 ${Number(mb.toFixed(1))} MB`;
  if (mb < 1000) return `约 ${Math.round(mb)} MB`;
  return `约 ${(mb / 1000).toFixed(1)} GB`;
}

/** 左边那一格写什么 */
export const KIND_LABEL: Record<ExportPackKind, string> = {
  sprite: '立绘',
  scene: '背景 · BGM',
  cg: 'CG',
  voice: '声音',
};

/** 这一类一个都没绑时那一行灰字 */
const NONE_LABEL: Record<ExportPackKind, string> = {
  sprite: '没绑立绘包',
  scene: '没绑背景和 BGM',
  cg: '没绑 CG 包',
  voice: '没挂声音',
};

const KIND_ORDER: readonly ExportPackKind[] = ['sprite', 'scene', 'cg', 'voice'];

/** 声音那一行拿不到文件时的灰字 */
export const VOICE_MISSING_NOTE = '语音机连不上,这个声音只能带设置';

/** 声音那一行底下的小字:黄字 warn(后端给的)、灰字「只能带设置」(有文件拿不到时);别的包都是 null */
export function voiceNotes(item: ExportBundleItem): { warn: string | null; missing: string | null } {
  if (item.kind !== 'voice') return { warn: null, missing: null };
  return { warn: item.warn || null, missing: (item.missing ?? 0) > 0 ? VOICE_MISSING_NOTE : null };
}

/** 导出中时底部的小字:勾着声音时要先从语音机取文件,会慢一些;没勾声音是 null */
export function busyNote(summary: ExportBundleSummary, checks: ExportChecks): string | null {
  const voice = summary.items.some((it) => it.kind === 'voice' && checks[it.key] !== false);
  return voice ? '正在从语音机取参考音频和模型,模型大时要等一会儿' : null;
}

/** 清单里的一行包:同一类只有第一行写类名;一类都没有时是一行灰字 */
export type PackRow =
  | { type: 'item'; item: ExportBundleItem; label: string; title: string }
  | { type: 'none'; kind: ExportPackKind; label: string; title: string };

export function packRows(summary: ExportBundleSummary): PackRow[] {
  return KIND_ORDER.flatMap((kind): PackRow[] => {
    const items = summary.items.filter((it) => it.kind === kind);
    if (items.length === 0) return [{ type: 'none', kind, label: KIND_LABEL[kind], title: NONE_LABEL[kind] }];
    return items.map((item, i) => ({
      type: 'item',
      item,
      label: i === 0 ? KIND_LABEL[kind] : '',
      title: item.detail ? `${item.name} · ${item.detail}` : item.name,
    }));
  });
}

/** 角色卡那一行:一张卡写「刻晴 · 头像、开场白、世界书」;一组状态卡写「爱弥斯(普通)、爱弥斯(约会)· 整组一起」 */
export function cardLine(summary: ExportBundleSummary): string {
  const { cards } = summary;
  if (cards.length <= 1) return `${cards[0]?.name ?? summary.title} · 头像、开场白、世界书`;
  return `${cards.map((c) => (c.state ? `${c.name}(${c.state})` : c.name)).join('、')} · 整组一起`;
}

/** 标题旁的小标签:一组状态卡时写「普通 / 约会」,单张卡没有 */
export function stateBadge(summary: ExportBundleSummary): string | null {
  if (summary.cards.length <= 1) return null;
  const states = summary.cards.map((c) => c.state).filter((s): s is string => !!s);
  return states.length > 0 ? states.join(' / ') : `${summary.cards.length} 张状态卡`;
}

const samePreview = (a: ExportPreview, b: ExportPreview) =>
  a.kind === b.kind && (a.kind === 'avatar' || (b.kind === 'sprite' && a.id === b.id));

/** 「换一张」:在 previews 里轮到下一张(到头回第一张);只有一张时不变 */
export function nextPreview(summary: ExportBundleSummary, current: ExportPreview): ExportPreview {
  const list = summary.previews;
  if (list.length === 0) return current;
  const at = list.findIndex((p) => samePreview(p, current));
  const next = list[(at + 1) % list.length];
  return next.kind === 'avatar' ? { kind: 'avatar' } : { kind: 'sprite', id: next.id };
}

/** 预览图的地址:卡头像用 summary.avatar,立绘用 previews 里的缩略图;resolve 把「/api/…」补成完整地址 */
export function previewSrc(
  summary: ExportBundleSummary,
  current: ExportPreview,
  resolve: (url: string) => string = (u) => u,
): string | null {
  if (current.kind === 'avatar') return summary.avatar;
  const hit = summary.previews.find((p) => samePreview(p, current));
  return hit?.thumb ? resolve(hit.thumb) : null;
}

/** 发给后端的 */
export function bundleBody(
  summary: ExportBundleSummary,
  checks: ExportChecks,
  withPreset: boolean,
  note: string,
  preview: ExportPreview,
): ExportBundleBody {
  return {
    exclude: excludeOf(summary, checks),
    preset: withPreset && summary.preset !== null,
    note: note.trim(),
    preview,
  };
}

/** 后端回的缩略图地址:「/api/…」要接上后端地址,data: / http 原样用 */
export function absoluteUrl(url: string, base: (path: string) => string): string {
  return url.startsWith('/') ? base(url) : url;
}

// ---------------------------------------------------------------- 单包导出

/** 素材管理 / 卡编辑器的立绘、背景、BGM、CG 页、素材管理的声音页:单包导出是哪一类 */
export function packKindOf(kind: 'sprite' | 'bg' | 'bgm' | 'cg' | 'voice'): ExportPackKind {
  return kind === 'bg' || kind === 'bgm' ? 'scene' : kind;
}

/** 「⋯」里那一项下面的小字 */
export function packExportNote(kind: ExportPackKind): string {
  if (kind === 'sprite') return '只有这套立绘,连认词记录和位置';
  if (kind === 'scene') return '只有这套背景和 BGM,连认词记录';
  if (kind === 'voice') return '参考音频、模型和设置;语音机连不上时只带设置';
  return '只有这套 CG,连差分';
}

export const PACK_EXPORT_LABEL = '导出这个包(.animapack)';

/** 「⋯」里那一项的字:声音写「导出这个声音」 */
export const packExportLabel = (kind: ExportPackKind) =>
  kind === 'voice' ? '导出这个声音(.animapack)' : PACK_EXPORT_LABEL;

/** 点了以后先提示一句:声音要先从语音机取文件,会慢一些;别的包直接存,不提示 */
export const packExportStarting = (kind: ExportPackKind) =>
  kind === 'voice' ? '正在从语音机取参考音频和模型,存好了会提示' : null;
