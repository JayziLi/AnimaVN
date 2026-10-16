import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../../lib/api';
import type { GeneratedImage } from './api';
import { DEFAULT_CARD_PREFS, DEFAULT_IMAGEGEN_CONFIG, type ImageGenConfig } from './config';
import {
  albumCounts,
  albumEntries,
  albumNote,
  albumSummary,
  emptyNote,
  filterAlbum,
  keptText,
  metaLine,
  modelName,
  narrationOf,
  paramRows,
  pickEntry,
  PLACE_OPTIONS,
  placeName,
  promptText,
  referenceText,
  settingsCells,
  triggerName,
  withCardName,
} from './studioAlbumModel';

const img = (id: string, o: Partial<GeneratedImage> = {}): GeneratedImage => ({
  id,
  sha: `sha-${id}`,
  card_id: 'kq',
  chat_id: 'c1',
  entry_id: 'e1',
  swipe: 0,
  line: 0,
  trigger: 'manual',
  title: `图${id}`,
  description: '',
  picture: {},
  prompt: '1girl, night',
  negative: '',
  chars: [],
  params: {},
  ms: 4321,
  kept_asset_id: null,
  created_at: '2026-10-13T18:30:00',
  ...o,
});

const cg = (id: string, o: Partial<SceneAsset> = {}): SceneAsset => ({
  id,
  pack_id: 'pk-ai',
  kind: 'cg',
  label: `CG${id}`,
  aliases: [],
  description: '',
  has_file: true,
  mime: 'image/png',
  size: 1,
  file_version: 1,
  data_sha: `sha-${id}`,
  focus_x: 50,
  bgm_id: null,
  sort: 0,
  enabled: true,
  parent_id: null,
  source: 'cg',
  ...o,
});

describe('相册条目:相册里的图 + 只在 CG 包里的', () => {
  const images = [
    img('a', { trigger: 'manual', kept_asset_id: 'x1' }),
    img('b', { trigger: 'auto' }),
    img('c', { trigger: 'reroll', kept_asset_id: 'gone' }),
    img('d', { trigger: 'auto', kept_asset_id: 'x2' }),
  ];

  it('CG 包还没读到:收藏看记录上的 kept_asset_id,不出只在包里的', () => {
    const list = albumEntries(images, null);
    expect(list.map((e) => [e.key, e.kept, e.cg])).toEqual([
      ['a', true, null],
      ['b', false, null],
      ['c', true, null],
      ['d', true, null],
    ]);
  });

  it('CG 包读到了:收藏以包里还在为准(包里删掉了 = 没收藏),包里多出来的接在后面', () => {
    const kept = [cg('x1'), cg('x2'), cg('x3', { label: '只在包里' }), cg('v1', { parent_id: 'x3' })];
    const list = albumEntries(images, kept);
    expect(list.map((e) => [e.key, e.kept, e.cg?.id ?? null, e.image?.id ?? null])).toEqual([
      ['a', true, 'x1', 'a'],
      ['b', false, null, 'b'],
      ['c', false, null, 'c'],
      ['d', true, 'x2', 'd'],
      ['cg:x3', true, 'x3', null],
    ]);
  });

  it('刚收藏、CG 包还没重读:记录上的那张算收藏了', () => {
    const list = albumEntries([img('a', { kept_asset_id: 'new' }), img('b', { kept_asset_id: 'old' })], [], new Set(['new']));
    expect(list.map((e) => [e.key, e.kept, e.cg])).toEqual([
      ['a', true, null],
      ['b', false, null],
    ]);
  });

  it('筛选和计数:手动含「换一张」;全部只数相册里的;已收藏含只在包里的', () => {
    const list = albumEntries(images, [cg('x1'), cg('x2'), cg('x3')]);
    expect(albumCounts(list)).toEqual({ all: 4, manual: 2, auto: 2, kept: 3 });
    expect(filterAlbum(list, 'all').map((e) => e.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterAlbum(list, 'manual').map((e) => e.key)).toEqual(['a', 'c']);
    expect(filterAlbum(list, 'auto').map((e) => e.key)).toEqual(['b', 'd']);
    expect(filterAlbum(list, 'kept').map((e) => e.key)).toEqual(['a', 'd', 'cg:x3']);
  });

  it('左栏的数:相册几张、收藏几张(包读到了按包里的构图数)', () => {
    expect(albumSummary(null, null)).toBeNull();
    expect(albumSummary(images, null)).toEqual({ total: 4, kept: 3 });
    expect(albumSummary(images, [cg('x1'), cg('x9'), cg('v', { parent_id: 'x9' })])).toEqual({ total: 4, kept: 2 });
    expect(albumSummary([], [])).toEqual({ total: 0, kept: 0 });
  });

  it('选中的那张:还在列表里就留着,不在了换成第一张,空的是 null', () => {
    const list = albumEntries(images, null);
    expect(pickEntry(list, 'c')?.key).toBe('c');
    expect(pickEntry(list, 'zz')?.key).toBe('a');
    expect(pickEntry(list, null)?.key).toBe('a');
    expect(pickEntry([], 'a')).toBeNull();
  });
});

describe('右栏的字', () => {
  it('手动 / 自动 / 换一张', () => {
    expect(triggerName('manual')).toBe('手动');
    expect(triggerName('auto')).toBe('自动');
    expect(triggerName('reroll')).toBe('换一张');
  });

  it('时间 · 怎么来的 · 用时;不是今年的带上年份', () => {
    const now = new Date(2026, 9, 15, 12, 0);
    expect(metaLine(img('a'), now)).toBe('10-13 18:30 · 手动 · 4.3 秒');
    expect(metaLine(img('a', { created_at: '2025-01-02T03:04:00', trigger: 'auto', ms: 0 }), now)).toBe(
      '2025-01-02 03:04 · 自动',
    );
    expect(metaLine(img('a', { created_at: 'nope', ms: 900 }), now)).toBe('手动 · 0.9 秒');
  });

  it('模型的叫法:去掉括号里的说明,不认得的原样', () => {
    expect(modelName('nai-diffusion-5-full')).toBe('V5 Full');
    expect(modelName('nai-diffusion-4-5-curated')).toBe('V4.5 Curated');
    expect(modelName('nai-diffusion-9')).toBe('nai-diffusion-9');
    expect(modelName(undefined)).toBe('—');
  });

  it('参考图:带了 / 设了没带上 / V4.5 没用 / V5 用不了', () => {
    expect(referenceText({ model: 'nai-diffusion-4-5-full', reference: { who: '刻晴', kind: 'sprite', id: null, style: false } })).toBe(
      '用了默认立绘',
    );
    expect(referenceText({ model: 'nai-diffusion-4-5-full', reference: { who: '刻晴', kind: 'sprite', id: 's1', style: true } })).toBe(
      '用了立绘 · 连画风一起',
    );
    expect(referenceText({ model: 'nai-diffusion-4-5-full', reference: { who: '刻晴', kind: 'upload', id: 'u1', style: false } })).toBe(
      '用了上传的图',
    );
    expect(referenceText({ model: 'nai-diffusion-4-5-full', reference: null, reference_note: '立绘读不到' })).toBe('没用(立绘读不到)');
    expect(referenceText({ model: 'nai-diffusion-4-5-full' })).toBe('没用');
    expect(referenceText({ model: 'nai-diffusion-5-full' })).toBe('没用(只有 V4.5 能用)');
  });

  it('生成参数五行;缺的写「—」', () => {
    const rows = paramRows(
      img('a', { params: { model: 'nai-diffusion-5-full', width: 1216, height: 832, steps: 23, scale: 5.7, seed: 2061208307 } }),
    );
    expect(rows).toEqual([
      { label: '模型', value: 'V5 Full' },
      { label: '尺寸', value: '1216 × 832' },
      { label: '步数 · 引导', value: '23 · 5.7' },
      { label: '种子', value: '2061208307' },
      { label: '参考图', value: '没用(只有 V4.5 能用)' },
    ]);
    expect(paramRows(img('b')).map((r) => r.value)).toEqual(['—', '—', '— · —', '—', '没用(只有 V4.5 能用)']);
  });

  it('提示词:主提示词 + 每个人的,空的不要', () => {
    expect(
      promptText(
        img('a', {
          prompt: ' 1girl, night ',
          chars: [
            { prompt: 'keqing', negative: '', x: 0.5, y: 0.5 },
            { prompt: '', negative: '', x: 0, y: 0 },
          ],
        }),
      ),
    ).toBe('1girl, night\n\nkeqing');
  });

  it('收藏状态', () => {
    const [a, b] = albumEntries([img('a', { kept_asset_id: 'x1' }), img('b')], [cg('x1', { label: '肩头星夜倚' }), cg('x3')]);
    const orphan = albumEntries([], [cg('x3')])[0];
    expect(keptText(b)).toBe('还没收藏,游戏里 AI / Jev 选不到它');
    expect(keptText(a)).toBe('已收藏 · CG 名「肩头星夜倚」· 游戏里 AI / Jev 能选它');
    expect(keptText(albumEntries([img('a', { kept_asset_id: 'x1' })], null)[0])).toBe('已收藏 · 游戏里 AI / Jev 能选它');
    expect(keptText(orphan)).toBe('已收藏 · CG 名「CGx3」· 游戏里 AI / Jev 能选它');
  });

  it('旁白:画面描述截短,没写用标题;只在包里的用构图', () => {
    expect(narrationOf(albumEntries([img('a', { description: '星空下,刻晴侧头靠在你的肩上,十指相扣。' })], null)[0])).toBe(
      '星空下,刻晴侧头靠在你的肩上,十指相扣。',
    );
    expect(narrationOf(albumEntries([img('a', { title: '肩头星夜倚' })], null)[0])).toBe('肩头星夜倚');
    expect(narrationOf(albumEntries([], [cg('x', { label: '海边', description: '' })])[0])).toBe('海边');
    expect(narrationOf(albumEntries([img('a', { description: '一'.repeat(60) })], null)[0])).toHaveLength(40);
  });

  it('「?」里的卡名换成真的', () => {
    expect(withCardName('收藏后复制进「AI 生图 · 卡名」CG 包', '刻晴')).toBe('收藏后复制进「AI 生图 · 刻晴」CG 包');
    expect(withCardName('「AI 生图 · 卡名」', '  ')).toBe('「AI 生图 · 卡名」');
  });

  it('相册标题旁的小字、空的时候的说法', () => {
    expect(albumNote(7, '刻晴')).toBe('7 张 · ☆ 收藏后进「AI 生图 · 刻晴」CG 包');
    expect(emptyNote('all')).toBe('相册还是空的 · 在游戏里点画笔画一张,或者开自动出图');
    expect(emptyNote('kept')).toContain('☆');
    expect(emptyNote('manual')).not.toBe(emptyNote('auto'));
  });
});

describe('舞台「放在哪」', () => {
  it('两个选项,名字照设置页', () => {
    expect(PLACE_OPTIONS.map((o) => o.value)).toEqual(['above', 'screen']);
    expect(placeName('above')).toBe('对话框上面');
    expect(placeName('screen')).toBe('铺满屏幕');
  });
});

describe('设置摘要', () => {
  const config: ImageGenConfig = { ...DEFAULT_IMAGEGEN_CONFIG, model: 'nai-diffusion-5-full' };

  it('角色名、画风(跟全局)、参考图(V5 不生效)、自动出图', () => {
    const cells = settingsCells(config, { ...DEFAULT_CARD_PREFS, nameTag: 'keqing (genshin impact)' });
    expect(cells.map((c) => [c.label, c.value])).toEqual([
      ['角色名', 'keqing (genshin impact)'],
      ['画风', '跟「画面」里的 · fuzichoco + rella'],
      ['参考图', '用立绘 · V5 不生效'],
      ['自动出图', '开'],
    ]);
    expect(cells[2].help).toBeTruthy();
  });

  it('这张卡另选的画风、V4.5 的参考图、关掉的自动出图、没填角色名', () => {
    const v45 = { ...config, model: 'nai-diffusion-4-5-full' };
    const cells = settingsCells(v45, { ...DEFAULT_CARD_PREFS, styleId: 'sketch', autoOff: true, ref: { ...DEFAULT_CARD_PREFS.ref, kind: 'upload', id: 'u' } });
    expect(cells.map((c) => c.value)).toEqual(['没填(原创角色)', '这张卡另选 · 速写漫画 · 黑白点色', '用上传的图', '这张卡关了']);
    expect(settingsCells({ ...config, auto: { ...config.auto, enabled: false } }, { ...DEFAULT_CARD_PREFS, ref: { ...DEFAULT_CARD_PREFS.ref, kind: 'off' } }).map((c) => c.value).slice(2)).toEqual([
      '不用',
      '关(全局)',
    ]);
  });
});
