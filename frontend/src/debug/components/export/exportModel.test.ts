import { describe, expect, it } from 'vitest';
import type { ExportBundleSummary } from '../../lib/api';
import {
  absoluteUrl,
  bundleBody,
  cardLine,
  excludeOf,
  fileNameOf,
  initialChecks,
  nextPreview,
  PACK_EXPORT_LABEL,
  packExportNote,
  packKindOf,
  packRows,
  previewSrc,
  rowSize,
  stateBadge,
  totalBytes,
  totalLabel,
} from './exportModel';

const summary = (over: Partial<ExportBundleSummary> = {}): ExportBundleSummary => ({
  title: '刻晴',
  file_name: '刻晴.animavn',
  avatar: 'data:image/png;base64,AAA',
  cards: [{ id: 'c1', name: '刻晴', state: null, main: true }],
  card_bytes: 412_000,
  items: [
    { key: 'sprite:a', kind: 'sprite', name: '玉衡星', detail: '14 张', bytes: 21_300_000, current: true, thumb: '/api/t/a' },
    { key: 'sprite:b', kind: 'sprite', name: '玉衡星(平涂)', detail: '15 张', bytes: 18_500_000, thumb: null },
    { key: 'scene:s', kind: 'scene', name: '原神 · 璃月', detail: '16 张背景、7 首 BGM', bytes: 17_500_000, thumb: null },
  ],
  follows: ['认词记录 32 条'],
  preset: { id: 'p1', name: '刻晴 DeepSeek', bytes: 90_000 },
  previews: [{ kind: 'avatar' }, { kind: 'sprite', id: 's1', thumb: '/api/t/s1' }, { kind: 'sprite', id: 's2', thumb: '/api/t/s2' }],
  not_included: ['声音(第 4 步再加)'],
  ...over,
});

describe('checks, exclude and total', () => {
  it('starts with everything ticked and nothing excluded', () => {
    const s = summary();
    const checks = initialChecks(s);
    expect(excludeOf(s, checks)).toEqual([]);
    expect(totalBytes(s, checks, true)).toBe(412_000 + 21_300_000 + 18_500_000 + 17_500_000 + 90_000);
  });

  it('puts unticked packs into exclude and leaves them out of the size', () => {
    const s = summary();
    const checks = { ...initialChecks(s), 'sprite:b': false };
    expect(excludeOf(s, checks)).toEqual(['sprite:b']);
    expect(totalBytes(s, checks, false)).toBe(412_000 + 21_300_000 + 17_500_000);
  });

  it('never counts a preset the card does not have', () => {
    const s = summary({ preset: null, items: [] });
    expect(totalBytes(s, {}, true)).toBe(412_000);
    expect(bundleBody(s, {}, true, '', { kind: 'avatar' }).preset).toBe(false);
  });

  it('builds the request body with a trimmed note', () => {
    const s = summary();
    const body = bundleBody(s, { 'scene:s': false }, true, '  原神刻晴 \n', { kind: 'sprite', id: 's1' });
    expect(body).toEqual({ exclude: ['scene:s'], preset: true, note: '原神刻晴', preview: { kind: 'sprite', id: 's1' } });
  });
});

describe('labels', () => {
  it('uses the backend file name, else the card name', () => {
    expect(fileNameOf(summary())).toBe('刻晴.animavn');
    expect(fileNameOf(summary({ file_name: '' }))).toBe('刻晴.animavn');
    expect(fileNameOf(summary({ file_name: '', title: '' }))).toBe('角色.animavn');
  });

  it('writes sizes like the canvas', () => {
    expect(rowSize(412_000)).toBe('0.4 MB');
    expect(rowSize(21_300_000)).toBe('21.3 MB');
    expect(rowSize(10_000)).toBe('<0.1 MB');
    expect(totalLabel(57_802_000)).toBe('约 58 MB');
    expect(totalLabel(2_340_000)).toBe('约 2.3 MB');
    expect(totalLabel(1_520_000_000)).toBe('约 1.5 GB');
  });

  it('names the pack kind only on the first row and lists missing kinds', () => {
    const rows = packRows(summary());
    expect(rows.map((r) => [r.type, r.label, r.title])).toEqual([
      ['item', '立绘', '玉衡星 · 14 张'],
      ['item', '', '玉衡星(平涂) · 15 张'],
      ['item', '背景 · BGM', '原神 · 璃月 · 16 张背景、7 首 BGM'],
      ['none', 'CG', '没绑 CG 包'],
    ]);
  });

  it('describes a single card and a state group', () => {
    expect(cardLine(summary())).toBe('刻晴 · 头像、开场白、世界书');
    expect(stateBadge(summary())).toBeNull();
    const group = summary({
      cards: [
        { id: 'c1', name: '爱弥斯', state: '普通', main: true },
        { id: 'c2', name: '爱弥斯', state: '约会', main: false },
      ],
    });
    expect(cardLine(group)).toBe('爱弥斯(普通)、爱弥斯(约会) · 整组一起');
    expect(stateBadge(group)).toBe('普通 / 约会');
  });
});

describe('preview', () => {
  it('cycles through the previews and wraps around', () => {
    const s = summary();
    let p = nextPreview(s, { kind: 'avatar' });
    expect(p).toEqual({ kind: 'sprite', id: 's1' });
    p = nextPreview(s, p);
    expect(p).toEqual({ kind: 'sprite', id: 's2' });
    expect(nextPreview(s, p)).toEqual({ kind: 'avatar' });
  });

  it('stays put when there is nothing to switch to', () => {
    expect(nextPreview(summary({ previews: [] }), { kind: 'avatar' })).toEqual({ kind: 'avatar' });
  });

  it('shows the avatar or the sprite thumb with the backend address', () => {
    const s = summary();
    const base = (p: string) => `http://h:8000${p}`;
    const resolve = (u: string) => absoluteUrl(u, base);
    expect(previewSrc(s, { kind: 'avatar' }, resolve)).toBe('data:image/png;base64,AAA');
    expect(previewSrc(s, { kind: 'sprite', id: 's2' }, resolve)).toBe('http://h:8000/api/t/s2');
    expect(previewSrc(s, { kind: 'sprite', id: 'gone' }, resolve)).toBeNull();
    expect(absoluteUrl('data:x', base)).toBe('data:x');
  });
});

describe('single pack export', () => {
  it('maps library tabs to pack kinds (background and BGM are one scene pack)', () => {
    expect(packKindOf('sprite')).toBe('sprite');
    expect(packKindOf('bg')).toBe('scene');
    expect(packKindOf('bgm')).toBe('scene');
    expect(packKindOf('cg')).toBe('cg');
  });

  it('says what the file carries', () => {
    expect(PACK_EXPORT_LABEL).toBe('导出这个包(.animapack)');
    expect(packExportNote('sprite')).toBe('只有这套立绘,连认词记录和位置');
    expect(packExportNote('scene')).toBe('只有这套背景和 BGM,连认词记录');
    expect(packExportNote('cg')).toBe('只有这套 CG,连差分');
  });
});
