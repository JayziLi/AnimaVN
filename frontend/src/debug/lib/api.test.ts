import { beforeAll, describe, expect, it } from 'vitest';

// api.ts 加载时就要读地址栏(后端地址跟着 hostname 走),测试环境没有 location
let filenameFromDisposition: (h: string) => string | null;
beforeAll(async () => {
  (globalThis as { location?: unknown }).location ??= { hostname: 'localhost' };
  ({ filenameFromDisposition } = await import('./api'));
});

describe('filenameFromDisposition', () => {
  it('prefers the UTF-8 filename* over the ASCII fallback', () => {
    const h = `attachment; filename="Amiya - .jsonl"; filename*=UTF-8''${encodeURIComponent('阿米娅 - 草地.jsonl')}`;
    expect(filenameFromDisposition(h)).toBe('阿米娅 - 草地.jsonl');
  });

  it('falls back to the plain filename', () => {
    expect(filenameFromDisposition('attachment; filename="chat-tree.zip"')).toBe('chat-tree.zip');
  });

  it('survives a broken percent-encoding and an empty header', () => {
    expect(filenameFromDisposition(`attachment; filename="a.jsonl"; filename*=UTF-8''%E9%9`)).toBe('a.jsonl');
    expect(filenameFromDisposition('')).toBeNull();
  });
});
