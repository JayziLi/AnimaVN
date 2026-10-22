import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveResponse, savedName } from './download';

const withHeader = (h: string | null) => ({ headers: new Headers(h === null ? {} : { 'Content-Disposition': h }) });

describe('savedName', () => {
  it('takes the UTF-8 name from Content-Disposition', () => {
    const h = `attachment; filename="Keqing.animavn"; filename*=UTF-8''${encodeURIComponent('刻晴.animavn')}`;
    expect(savedName(withHeader(h), 'x.animavn')).toBe('刻晴.animavn');
  });

  it('falls back when the header is missing or empty', () => {
    expect(savedName(withHeader(null), '刻晴.animavn')).toBe('刻晴.animavn');
    expect(savedName(withHeader('attachment'), 'pack.animapack')).toBe('pack.animapack');
  });
});

describe('saveResponse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('clicks a download link with the header name and reports the size', async () => {
    vi.useFakeTimers();
    const clicked: { href: string; download: string }[] = [];
    const anchor = {
      href: '',
      download: '',
      click() {
        clicked.push({ href: this.href, download: this.download });
      },
      remove: vi.fn(),
    };
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:1', revokeObjectURL: revoke });

    const res = new Response(new Uint8Array(1234), {
      headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('刻晴 · 玉衡星.animapack')}` },
    });
    const saved = await saveResponse(res, 'pack.animapack');

    expect(saved).toEqual({ name: '刻晴 · 玉衡星.animapack', bytes: 1234 });
    expect(clicked).toEqual([{ href: 'blob:1', download: '刻晴 · 玉衡星.animapack' }]);
    expect(anchor.remove).toHaveBeenCalled();
    // 点完再收回
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });
});
