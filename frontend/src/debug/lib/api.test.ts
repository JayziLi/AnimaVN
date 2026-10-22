import { beforeAll, describe, expect, it } from 'vitest';

// api.ts 加载时就要读地址栏(后端地址跟着 hostname 走),测试环境没有 location
let filenameFromDisposition: (h: string) => string | null;
let api: typeof import('./api');
beforeAll(async () => {
  (globalThis as { location?: unknown }).location ??= { hostname: 'localhost' };
  api = await import('./api');
  ({ filenameFromDisposition } = api);
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

describe('asset urls', () => {
  const sprite = {
    id: 's1',
    pack_id: 'p1',
    label: '平静',
    aliases: [],
    description: '',
    has_image: true,
    image_version: 7,
    sort: 0,
    enabled: true,
    face_scan: null,
  };
  const bg = {
    id: 'a1',
    pack_id: 'p2',
    kind: 'bg' as const,
    label: '教室',
    aliases: [],
    description: '',
    has_file: true,
    mime: 'image/png',
    size: 1,
    file_version: 9,
    focus_x: 50,
    bgm_id: null,
    sort: 0,
    enabled: true,
  };
  const sha = 'ab'.repeat(32);

  it('uses the blob store when the sha is known', () => {
    const spriteUrl = api.spriteImageUrl({ ...sprite, image_sha: sha }) ?? '';
    expect(spriteUrl.split('?')[0].endsWith(`/api/blobs/${sha}`)).toBe(true);
    expect(spriteUrl.split('?')[1]).toMatch(/^w=[0-9]+$/);
    expect(api.sceneFileUrl({ ...bg, data_sha: sha })?.endsWith(`/api/blobs/${sha}`)).toBe(true);
    expect(api.sceneThumbUrl({ ...bg, data_sha: sha }, 64)?.endsWith(`/api/blobs/${sha}?w=64`)).toBe(true);
  });

  it('keeps the old per-row addresses without a sha', () => {
    expect(api.spriteImageUrl(sprite)).toContain('/api/sprite-packs/p1/sprites/s1/image?v=7&w=');
    expect(api.sceneThumbUrl({ ...bg, data_sha: null }, 64)?.endsWith('/assets/a1/file?v=9&w=64')).toBe(true);
    expect(api.spriteImageUrl({ ...sprite, has_image: false, image_sha: sha })).toBeNull();
  });
});

describe('exportPackUrl', () => {
  it('points at the single-pack export with an encoded id', () => {
    expect(api.exportPackUrl('scene', 'a b')).toBe('http://localhost:8000/api/export/pack/scene/a%20b');
  });
});
