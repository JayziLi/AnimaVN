import { describe, expect, it } from 'vitest';
import type { ImportApplyBody, ImportGroup, ImportPlan, ImportResult } from '../lib/api';
import type { ImportTarget } from './dropTarget';
import {
  applyBody,
  confirmModel,
  defaultDecisions,
  importErrorText,
  libraryRouteAfterImport,
  noticeOf,
  nothingToImport,
  shouldConfirm,
  slotAfterImport,
  spritesToCheck,
} from './importModel';

const group = (g: Pick<ImportGroup, 'key' | 'type' | 'name'> & Partial<ImportGroup>): ImportGroup => ({
  count: 1,
  owner: null,
  duplicate_of: null,
  ...g,
});
const plan = (groups: ImportGroup[], extra: Partial<ImportPlan> = {}): ImportPlan => ({
  plan_id: 'p1',
  groups,
  unknown: [],
  skipped: [],
  needs_confirm: false,
  ...extra,
});
const KQ: ImportTarget = { cardId: 'c1', cardName: '刻晴', kind: null };
const NONE: ImportTarget = { cardId: null, cardName: null, kind: null };

const sprite = (key: string, name: string, over: Partial<ImportGroup> = {}) =>
  group({ key, type: 'sprite_pack', name, count: 16, owner: 'target', ...over });

describe('confirmModel · title', () => {
  it('asks about the card it was dropped on', () => {
    const m = confirmModel(plan([sprite('s1', '刻晴 · 新衣服')]), KQ, null, false);
    expect(m.title).toBe('给「刻晴」挂上这些素材?');
    expect(m.confirmLabel).toBe('确定挂上');
  });

  it('asks a plain question when nothing was dropped on a card', () => {
    const m = confirmModel(plan([sprite('s1', 'X', { owner: null })]), NONE, null, false);
    expect(m.title).toBe('导入这些素材?');
    expect(m.confirmLabel).toBe('导入');
  });
});

describe('confirmModel · sprite packs on the dropped-on card', () => {
  it('adds one more set and keeps the current one, unless asked to switch', () => {
    const p = plan([sprite('s1', '刻晴 · 新衣服')]);
    const m = confirmModel(p, KQ, { count: 2, current: '刻晴 · 玉衡星' }, false);
    expect(m.rows[0].title).toBe('立绘包「刻晴 · 新衣服」· 16 张');
    expect(m.rows[0].effect).toBe('挂成刻晴的立绘,算再挂一套;现在用的「刻晴 · 玉衡星」不变');
    expect(m.makeCurrent).toEqual({ key: 's1', label: '挂上以后直接换成这套' });
    const on = confirmModel(p, KQ, { count: 2, current: '刻晴 · 玉衡星' }, true);
    expect(on.rows[0].effect).toBe('挂成刻晴的立绘,算再挂一套;挂上以后直接换成这套');
  });

  it('uses the first set right away when the card has none, without the switch box', () => {
    const p = plan([sprite('s1', '刻晴 · 新衣服'), sprite('s2', '刻晴 · 泳装')]);
    const m = confirmModel(p, KQ, { count: 0, current: null }, false);
    expect(m.rows.map((r) => r.effect)).toEqual([
      '挂成刻晴的立绘(刻晴还没有立绘,这套直接用上)',
      '挂成刻晴的立绘,算再挂一套',
    ]);
    expect(m.makeCurrent).toBeNull();
  });

  it('names the first set in the switch box when there are several, and only the first one switches', () => {
    const p = plan([sprite('s1', '刻晴 · 新衣服'), sprite('s2', '刻晴 · 泳装')]);
    const m = confirmModel(p, KQ, { count: 1, current: null }, true);
    expect(m.makeCurrent).toEqual({ key: 's1', label: '挂上以后直接换成第一套「刻晴 · 新衣服」' });
    expect(m.rows[0].effect).toBe('挂成刻晴的立绘,算再挂一套;挂上以后直接换成这套');
    expect(m.rows[1].effect).toBe('挂成刻晴的立绘,算再挂一套;现在用的那套不变');
  });

  it('stays vague when the card’s sprites could not be read', () => {
    const m = confirmModel(plan([sprite('s1', 'X')]), KQ, null, false);
    expect(m.rows[0].effect).toBe('挂成刻晴的立绘,算再挂一套');
    expect(m.makeCurrent).toEqual({ key: 's1', label: '挂上以后直接换成这套' });
  });

  it('says which card sprite info is needed for', () => {
    expect(spritesToCheck(plan([sprite('s1', 'X')]), KQ)).toBe('c1');
    expect(spritesToCheck(plan([sprite('s1', 'X', { owner: null })]), KQ)).toBeNull();
    expect(spritesToCheck(plan([sprite('s1', 'X')]), NONE)).toBeNull();
  });
});

describe('confirmModel · other rows', () => {
  it('titles and places scene packs by what they hold', () => {
    const p = plan([
      group({ key: 'a', type: 'scene_pack', name: '刻晴', owner: 'target', count: 11, bg_count: 8, bgm_count: 3 }),
      group({ key: 'b', type: 'scene_pack', name: '刻晴 · 背景', owner: 'target', count: 8, bg_count: 8, bgm_count: 0 }),
      group({ key: 'c', type: 'scene_pack', name: '刻晴 · BGM', owner: 'target', count: 3, bg_count: 0, bgm_count: 3 }),
    ]);
    const m = confirmModel(p, KQ, null, false);
    expect(m.rows.map((r) => [r.icon, r.title, r.effect])).toEqual([
      ['scene', '背景和 BGM「刻晴」· 背景 8 张 · BGM 3 首', '挂成刻晴的背景和 BGM,接在已有的后面'],
      ['bg', '背景「刻晴 · 背景」· 8 张', '挂成刻晴的背景,接在已有的后面'],
      ['bgm', 'BGM「刻晴 · BGM」· 3 首', '挂成刻晴的 BGM,接在已有的后面'],
    ]);
  });

  it('titles CG packs with compositions and variants', () => {
    const p = plan([group({ key: 'g', type: 'cg_pack', name: '爱弥斯 · CG', owner: 'target', count: 12, variant_count: 30 })]);
    const row = confirmModel(p, KQ, null, false).rows[0];
    expect(row.title).toBe('CG 包「爱弥斯 · CG」· 12 张构图 · 差分 30 张');
    expect(row.effect).toBe('挂成刻晴的 CG,接在已有的后面');
    const bare = plan([group({ key: 'g', type: 'cg_pack', name: 'X', count: 2, variant_count: 0 })]);
    expect(confirmModel(bare, NONE, null, false).rows[0].title).toBe('CG 包「X」· 2 张构图');
  });

  it('follows a card that comes in the same drop, or goes to the library', () => {
    const p = plan([
      group({ key: 'card:0', type: 'card', name: 'Seraphina' }),
      sprite('s1', 'Seraphina', { owner: 'card:0' }),
      group({ key: 'g', type: 'cg_pack', name: '散图', count: 3 }),
      group({ key: 'card:1', type: 'card', name: '光卡' }),
    ]);
    const m = confirmModel(p, NONE, null, false);
    expect(m.rows.map((r) => [r.icon, r.title, r.effect])).toEqual([
      ['card', '角色卡「Seraphina」', '新建一张卡,一起拖进来的素材挂到它上面'],
      ['sprite', '立绘包「Seraphina」· 16 张', '跟着角色卡「Seraphina」一起挂上'],
      ['cg', 'CG 包「散图」· 3 张构图', '先放进素材库,不绑到卡上'],
      ['card', '角色卡「光卡」', '新建一张卡'],
    ]);
    expect(m.rows.every((r) => r.choice === null)).toBe(true);
  });
});

describe('confirmModel · duplicates', () => {
  it('offers to save a copy (recommended) or share the one in use', () => {
    const p = plan([sprite('s1', '刻晴 · 玉衡星', { duplicate_of: { id: 'x', name: '刻晴 · 玉衡星', card_count: 1 } })]);
    const row = confirmModel(p, KQ, { count: 1, current: 'A' }, false).rows[0];
    expect(row.choice).toEqual({
      lead: '「刻晴 · 玉衡星」库里已经有一模一样的',
      initial: 'new',
      options: [
        { value: 'new', label: '另存一份(推荐)', note: '两张卡各用各的,以后改这份不影响另一张' },
        { value: 'share', label: '共用已有的那份', note: '现在被 1 张卡用;改一处,两张卡一起变' },
      ],
    });
  });

  it('counts the cards that would change together', () => {
    const dup = (n: number) =>
      confirmModel(plan([sprite('s1', 'X', { duplicate_of: { id: 'x', name: 'X', card_count: n } })]), KQ, null, false)
        .rows[0].choice?.options;
    expect(dup(3)?.map((o) => o.note)).toEqual([
      '各用各的,以后改这份不影响另外 3 张卡',
      '现在被 3 张卡用;改一处,4 张卡一起变',
    ]);
    expect(dup(0)?.map((o) => o.note)).toEqual(['以后改这份不影响已有的那份', '现在没有卡在用']);
  });

  it('lets an unbound duplicate be skipped instead of shared', () => {
    const p = plan([group({ key: 'b', type: 'scene_pack', name: 'X', bg_count: 2, bgm_count: 0, duplicate_of: { id: 'x', name: 'X', card_count: 2 } })]);
    expect(confirmModel(p, NONE, null, false).rows[0].choice?.options).toEqual([
      { value: 'new', label: '另存一份(推荐)', note: '以后改这份不影响已有的那份' },
      { value: 'share', label: '不导这份', note: '库里已经有了,这次不再建' },
    ]);
  });

  it('asks whether a duplicate card is the same one (update) or a new one', () => {
    const p = plan([group({ key: 'card:0', type: 'card', name: '刻晴', duplicate_of: { id: 'c9', name: '刻晴' } })]);
    const row = confirmModel(p, NONE, null, false).rows[0];
    expect(row.effect).toBe('');
    expect(row.choice).toEqual({
      lead: '「刻晴」库里已经有一张一样的',
      initial: 'new',
      options: [
        { value: 'update', label: '是同一张,更新它', note: '对话、存档、挂的素材都留着' },
        { value: 'new', label: '另存一张', note: '两张卡各用各的' },
      ],
    });
  });

  it('defaults every duplicate to a new copy and leaves the rest alone', () => {
    const p = plan([
      group({ key: 'card:0', type: 'card', name: '刻晴', duplicate_of: { id: 'c9', name: '刻晴' } }),
      sprite('s1', 'X', { duplicate_of: { id: 'x', name: 'X', card_count: 1 } }),
      sprite('s2', 'Y'),
    ]);
    expect(defaultDecisions(p)).toEqual({ 'card:0': 'new', s1: 'new' });
  });
});

describe('confirmModel · leftovers', () => {
  it('lists files it could not place, by name and folder', () => {
    const p = plan([], { unknown: ['刻晴/杂/IMG_0231.png', 'a.png'], skipped: ['跳过 3 个无关文件'] });
    const m = confirmModel(p, KQ, null, false);
    expect(m.unknown).toEqual([
      { path: '刻晴/杂/IMG_0231.png', name: 'IMG_0231.png', folder: '刻晴/杂' },
      { path: 'a.png', name: 'a.png', folder: '' },
    ]);
    expect(m.skipped).toEqual(['跳过 3 个无关文件']);
  });
});

describe('applyBody', () => {
  it('sends the duplicate choices, the picked kinds and the switch box when it was offered', () => {
    const p = plan([sprite('s1', 'X', { duplicate_of: { id: 'x', name: 'X', card_count: 1 } }), sprite('s2', 'Y')], {
      unknown: ['a.png', 'b.png'],
    });
    const m = confirmModel(p, KQ, { count: 1, current: 'Z' }, true);
    expect(applyBody(m, { s1: 'share', s2: 'update' }, { 'a.png': 'bg', 'b.png': null }, true)).toEqual({
      decisions: { s1: 'share' },
      classify: { 'a.png': 'bg' },
      make_current: true,
    });
  });

  it('never asks to switch sets when the box was not offered', () => {
    const m = confirmModel(plan([sprite('s1', 'X')]), KQ, { count: 0, current: null }, true);
    expect(applyBody(m, {}, {}, true)).toEqual({ decisions: {}, classify: {}, make_current: false });
  });
});

describe('when to ask', () => {
  it('asks when the plan says so or when only unplaced files came in', () => {
    expect(shouldConfirm(plan([sprite('s1', 'X')], { needs_confirm: true }))).toBe(true);
    expect(shouldConfirm(plan([sprite('s1', 'X')]))).toBe(false);
    expect(shouldConfirm(plan([], { unknown: ['a.png'] }))).toBe(true);
  });

  it('knows when nothing at all was recognised', () => {
    expect(nothingToImport(plan([], { skipped: ['跳过 2 个无关文件'] }))).toBe(true);
    expect(nothingToImport(plan([], { unknown: ['a.png'] }))).toBe(false);
  });
});

describe('slotAfterImport', () => {
  it('opens the slot that was dropped on', () => {
    expect(slotAfterImport(plan([sprite('s1', 'X')]), 'bgm')).toBe('bgm');
  });

  it('otherwise opens the first kind that came in: sprites, backgrounds, music, CG', () => {
    const bg = group({ key: 'b', type: 'scene_pack', name: 'X', bg_count: 2, bgm_count: 1 });
    const bgm = group({ key: 'm', type: 'scene_pack', name: 'X', bg_count: 0, bgm_count: 2 });
    const cg = group({ key: 'g', type: 'cg_pack', name: 'X' });
    expect(slotAfterImport(plan([cg, bg, sprite('s1', 'X')]), null)).toBe('sprite');
    expect(slotAfterImport(plan([cg, bgm, bg]), null)).toBe('bg');
    expect(slotAfterImport(plan([cg, bgm]), null)).toBe('bgm');
    expect(slotAfterImport(plan([cg]), null)).toBe('cg');
    expect(slotAfterImport(plan([group({ key: 'card:0', type: 'card', name: 'X' })]), null)).toBe('sprite');
  });
});

describe('noticeOf', () => {
  const result: ImportResult = {
    job_id: 'j1',
    card_id: null,
    notice: { title: '散图 导入完成 · 还没绑定到角色卡', detail: '新建 CG 包 1 个', unknown: ['x.png'] },
    report: ['CG 包「散图」3 张构图', '跳过 2 个无关文件'],
  };

  it('carries the job and the report into the notice', () => {
    expect(noticeOf(result)).toEqual({ ...result.notice, jobId: 'j1', report: result.report });
  });
});

describe('libraryRouteAfterImport', () => {
  const made = (created: Partial<NonNullable<ImportResult['created']>>): ImportResult => ({
    job_id: 'j1',
    card_id: null,
    notice: { title: 'x 导入完成', detail: '', unknown: [] },
    report: [],
    created: { cards: [], sprite_packs: [], scene_packs: [], cg_packs: [], ...created },
  });
  const NO_BODY: ImportApplyBody = { decisions: {}, classify: {}, make_current: false };
  const empty = plan([]);

  it('selects the first new pack: sprites, then scene packs, then CG', () => {
    const all = made({ sprite_packs: ['s1', 's2'], scene_packs: ['sc1'], cg_packs: ['g1'] });
    expect(libraryRouteAfterImport(all, empty, NO_BODY, null)).toEqual({ tab: 'sprite', id: 's1' });
    const scene = made({ scene_packs: ['sc1'], cg_packs: ['g1'] });
    expect(libraryRouteAfterImport(scene, empty, NO_BODY, null)).toEqual({ tab: 'bg', id: 'sc1' });
    expect(libraryRouteAfterImport(made({ cg_packs: ['g1', 'g2'] }), empty, NO_BODY, null)).toEqual({ tab: 'cg', id: 'g1' });
  });

  it('opens the voice tab on the first new voice when only voices came in', () => {
    expect(libraryRouteAfterImport(made({ voices: ['v1'] }), empty, NO_BODY, null)).toEqual({ tab: 'voice', id: 'v1' });
  });

  it('opens a new scene pack on the BGM tab when it only has music', () => {
    const r = made({ scene_packs: ['sc1'] });
    const sides = (bg: number, bgm: number) => [
      { id: 'other', bg_count: 0, bgm_count: 3 },
      { id: 'sc1', bg_count: bg, bgm_count: bgm },
    ];
    expect(libraryRouteAfterImport(r, empty, NO_BODY, sides(0, 2))).toEqual({ tab: 'bgm', id: 'sc1' });
    expect(libraryRouteAfterImport(r, empty, NO_BODY, sides(1, 2))).toEqual({ tab: 'bg', id: 'sc1' });
    // 两边都空的包两边都列;读不到、列表里还没有就开背景
    expect(libraryRouteAfterImport(r, empty, NO_BODY, sides(0, 0))).toEqual({ tab: 'bg', id: 'sc1' });
    expect(libraryRouteAfterImport(r, empty, NO_BODY, [])).toEqual({ tab: 'bg', id: 'sc1' });
  });

  it('selects the library copy when a duplicate was not imported again', () => {
    const dup = (over: Partial<ImportGroup>) =>
      group({ key: 'g', type: 'sprite_pack', name: 'X', duplicate_of: { id: 'old', name: 'X', card_count: 0 }, ...over });
    const share: ImportApplyBody = { ...NO_BODY, decisions: { g: 'share' } };
    const none = made({});
    expect(libraryRouteAfterImport(none, plan([dup({})]), share, null)).toEqual({ tab: 'sprite', id: 'old' });
    expect(libraryRouteAfterImport(none, plan([dup({ type: 'cg_pack' })]), share, null)).toEqual({ tab: 'cg', id: 'old' });
    const music = dup({ type: 'scene_pack', bg_count: 0, bgm_count: 4 });
    expect(libraryRouteAfterImport(none, plan([music]), share, null)).toEqual({ tab: 'bgm', id: 'old' });
    const both = dup({ type: 'scene_pack', bg_count: 2, bgm_count: 4 });
    expect(libraryRouteAfterImport(none, plan([both]), share, null)).toEqual({ tab: 'bg', id: 'old' });
    // 选了另存一份却没建成(文件都太大):不当成共用
    expect(libraryRouteAfterImport(none, plan([dup({})]), NO_BODY, null)).toEqual({ tab: 'jobs', id: 'j1' });
  });

  it('otherwise opens the import records on this import', () => {
    const leftovers = plan([], { unknown: ['a.png'] });
    expect(libraryRouteAfterImport(made({}), leftovers, NO_BODY, null)).toEqual({ tab: 'jobs', id: 'j1' });
    // 旧后端没有 created
    const old: ImportResult = { ...made({}), created: undefined };
    expect(libraryRouteAfterImport(old, plan([sprite('s1', 'X')]), NO_BODY, null)).toEqual({ tab: 'jobs', id: 'j1' });
  });
});

describe('importErrorText', () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { status });

  it('turns failures into one line', () => {
    expect(importErrorText(err(0, '连不上后端'))).toBe('导入失败:连不上后端');
    expect(importErrorText(err(413, '文件太多了:超过 5000 个,这批没有导入'))).toBe('文件太多了:超过 5000 个,这批没有导入');
    expect(importErrorText(err(404, '角色卡不存在'))).toBe('导入失败:角色卡不存在');
    expect(importErrorText(err(500, '导入失败,库里什么都没改:boom'))).toBe('导入失败,库里什么都没改:boom');
    expect(importErrorText('奇怪的东西')).toBe('导入失败:奇怪的东西');
    expect(importErrorText(err(400, '「a.png」不是音频,不能当 BGM'), '归类失败')).toBe('归类失败:「a.png」不是音频,不能当 BGM');
  });
});
