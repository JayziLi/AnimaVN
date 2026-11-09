/**
 * 本地 SD 画的时候的过程预览(设计 docs/superpowers/specs/2026-11-07-imagegen-backends-design.md 第 8 节):
 * 发 /generate 之前先开 GET /jobs/{job_id}/events(SSE),收 {image, progress}。
 * 图是不带前缀的 base64;Forge 加载模型时 progress 卡在 0.01,所以进度数字不显示,只用来定模糊程度。
 * 纯逻辑和连接都在这里,有测试(preview.test.ts)
 */

import { apiUrl } from '../../lib/api';

export function newJobId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // 局域网用 http 打开时没有 randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function previewMime(b64: string): string {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

export const previewSrc = (b64: string): string => (b64.startsWith('data:') ? b64 : `data:${previewMime(b64)};base64,${b64}`);

/** 预览要模糊几个像素:刚开始 14,快画完 2,真图出来时换掉。进度是乱值当刚开始 */
export function previewBlur(progress: number): number {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.round((2 + (1 - p) * 12) * 10) / 10;
}

export interface PreviewFrame {
  /** 能直接放进 img 的地址 */
  src: string;
  progress: number;
}

function frameOf(data: string): PreviewFrame | null {
  try {
    const body: unknown = JSON.parse(data);
    if (body === null || typeof body !== 'object') return null;
    const { image, progress } = body as { image?: unknown; progress?: unknown };
    if (typeof image !== 'string' || !image) return null;
    return { src: previewSrc(image), progress: typeof progress === 'number' ? progress : 0 };
  } catch {
    return null;
  }
}

/** 开始收这张的预览。返回的函数关掉连接(能调多次);收到 done、连接出错都会自己关,不让浏览器重连 */
export function openPreview(jobId: string, onFrame: (f: PreviewFrame) => void): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const es = new EventSource(apiUrl(`/api/imagegen/jobs/${encodeURIComponent(jobId)}/events`));
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    es.close();
  };
  es.onmessage = (e: MessageEvent<string>) => {
    if (!open) return;
    const f = frameOf(e.data);
    if (f) onFrame(f);
  };
  es.addEventListener('done', close);
  es.onerror = close;
  return close;
}

/** 局内这一张的预览挂在哪:哪条回复的哪个分支第几句 */
export interface LivePreview extends PreviewFrame {
  jobId: string;
  entryId: string;
  swipe: number;
  line: number;
}

/** 这一句该显示哪张预览:和画好的图一样,从那句往后都算(读过了也显示);同时画几张时后开始的优先 */
export function previewAt(list: readonly LivePreview[], entryId: string, swipe: number, line: number): LivePreview | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.entryId === entryId && p.swipe === swipe && line >= p.line) return p;
  }
  return null;
}
