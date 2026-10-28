import { describe, expect, it } from 'vitest';
import type { GeneratedImage } from './api';
import {
  clockText,
  dayText,
  drawnOnly,
  groupByDay,
  groupBySave,
  jumpTargetOf,
  landingOf,
  lineText,
  ORPHAN_GROUP,
  whereLine,
  type JumpWorld,
} from './menuAlbumModel';
import { albumEntries, type AlbumEntry } from './studioAlbumModel';

const img = (id: string, o: Partial<GeneratedImage> = {}): GeneratedImage => ({
  id,
  sha: `sha-${id}`,
  card_id: 'kq',
  chat_id: 'c1',
  entry_id: 'e1',
  swipe: 0,
  line: 2,
  trigger: 'manual',
  title: `图${id}`,
  description: '',
  picture: {},
  prompt: '',
  negative: '',
  chars: [],
  params: {},
  ms: 4000,
  kept_asset_id: null,
  created_at: '2026-10-18T06:56:00Z',
  ...o,
});

const entries = (images: GeneratedImage[]): AlbumEntry[] => albumEntries(images, null);
const ids = (es: readonly AlbumEntry[]) => es.map((e) => e.image?.id);

const saves = [
  { id: 'c1', name: '夜路' },
  { id: 'c2', name: '客厅' },
];

describe('groupBySave', () => {
  it('每个存档一组,组内新的在前,组按各自最新的一张排', () => {
    const es = entries([
      img('a', { chat_id: 'c2', created_at: '2026-10-18T05:17:00Z' }),
      img('b', { chat_id: 'c1', created_at: '2026-10-18T06:00:00Z' }),
      img('c', { chat_id: 'c1', created_at: '2026-10-18T06:56:00Z' }),
      img('d', { chat_id: 'c1', created_at: '2026-10-18T06:30:00Z' }),
    ]);
    const groups = groupBySave(es, saves, null);
    expect(groups.map((g) => g.id)).toEqual(['c1', 'c2']);
    expect(groups.map((g) => g.title)).toEqual(['夜路', '客厅']);
    expect(ids(groups[0].items)).toEqual(['c', 'd', 'b']);
  });

  it('后画的存档排前面,和相册传进来的顺序无关', () => {
    const es = entries([
      img('a', { chat_id: 'c1', created_at: '2026-10-17T05:00:00Z' }),
      img('b', { chat_id: 'c2', created_at: '2026-10-18T05:00:00Z' }),
    ]);
    expect(groupBySave(es, saves, null).map((g) => g.id)).toEqual(['c2', 'c1']);
  });

  it('标出正在玩的存档;可以读的存档带编号', () => {
    const groups = groupBySave(entries([img('a'), img('b', { chat_id: 'c2' })]), saves, 'c1');
    expect(groups.map((g) => [g.id, g.current, g.chatId])).toEqual([
      ['c1', true, 'c1'],
      ['c2', false, 'c2'],
    ]);
  });

  it('存档删了、老图没记存档的合成最后一组,不能读档', () => {
    const es = entries([
      img('a', { chat_id: null, created_at: '2026-10-19T00:00:00Z' }),
      img('b', { chat_id: 'gone', created_at: '2026-10-19T01:00:00Z' }),
      img('c', { chat_id: 'c1', created_at: '2026-10-10T00:00:00Z' }),
    ]);
    const groups = groupBySave(es, saves, null);
    expect(groups.map((g) => g.id)).toEqual(['c1', ORPHAN_GROUP]);
    expect(groups[1].chatId).toBeNull();
    expect(ids(groups[1].items)).toEqual(['b', 'a']);
  });

  it('没有图就没有组', () => {
    expect(groupBySave([], saves, 'c1')).toEqual([]);
  });

  it('创建时间读不出来的排在组内最后', () => {
    const es = entries([img('a', { created_at: 'bad' }), img('b', { created_at: '2026-10-18T06:56:00Z' })]);
    expect(ids(groupBySave(es, saves, null)[0].items)).toEqual(['b', 'a']);
  });
});

describe('groupByDay', () => {
  it('一天一组,新的在前,不分存档', () => {
    const es = entries([
      img('a', { created_at: '2026-10-18T06:00:00' }),
      img('b', { chat_id: 'c2', created_at: '2026-10-20T06:00:00' }),
      img('c', { created_at: '2026-10-18T08:00:00' }),
    ]);
    const groups = groupByDay(es);
    expect(groups.map((g) => g.items.map((e) => e.image?.id))).toEqual([['b'], ['c', 'a']]);
    expect(groups.every((g) => g.chatId === null)).toBe(true);
  });

  it('时间读不出来的归「时间不详」', () => {
    const groups = groupByDay(entries([img('a', { created_at: 'bad' })]));
    expect(groups.map((g) => g.title)).toEqual(['时间不详']);
  });
});

describe('时间、句子的写法', () => {
  it('后端的时间没带时区也按 UTC 算(本机时区再换成日子和钟点)', () => {
    const d = new Date('2026-10-18T06:56:00Z');
    const two = (n: number) => String(n).padStart(2, '0');
    expect(dayText('2026-10-18T06:56:00')).toBe(`${two(d.getMonth() + 1)}-${two(d.getDate())}`);
    expect(clockText('2026-10-18T06:56:00')).toBe(`${two(d.getHours())}:${two(d.getMinutes())}`);
    expect(clockText('2026-10-18T06:56:00')).toBe(clockText('2026-10-18T06:56:00Z'));
  });

  it('读不出来是空串', () => {
    expect(dayText('x')).toBe('');
    expect(clockText('x')).toBe('');
  });

  it('句子从 0 数,给人看的从 1 数;没记位置不写', () => {
    expect(lineText(0)).toBe('第 1 句');
    expect(lineText(12)).toBe('第 13 句');
    expect(lineText(null)).toBe('');
    expect(lineText(undefined)).toBe('');
  });

  it('格子下面那行:几点 · 第几句', () => {
    const [e] = entries([img('a', { line: 4, created_at: '2026-10-18T06:56:00Z' })]);
    expect(whereLine(e)).toBe(`${clockText('2026-10-18T06:56:00Z')} · 第 5 句`);
    const [none] = entries([img('b', { line: null })]);
    expect(whereLine(none)).toBe(clockText('2026-10-18T06:56:00Z'));
  });
});

describe('drawnOnly', () => {
  it('只留相册里有记录的,只在 CG 包里的不要', () => {
    const only: AlbumEntry = { key: 'cg:x', image: null, cg: null, kept: true };
    const [a] = entries([img('a')]);
    expect(drawnOnly([a, only])).toEqual([a]);
  });
});

describe('jumpTargetOf', () => {
  const world = (o: Partial<JumpWorld> = {}): JumpWorld => ({
    currentChatId: 'c1',
    saveIds: new Set(['c1', 'c2']),
    swipeOf: (id) => (id === 'e1' ? 0 : null),
    ...o,
  });
  const of = (o: Partial<GeneratedImage>) => entries([img('a', o)])[0];

  it('同一个对话、回复还在、还是那一版:跳到那一句', () => {
    expect(jumpTargetOf(of({ line: 7 }), world())).toEqual({ kind: 'jump', entryId: 'e1', line: 7 });
  });

  it('画它时没记分支的也能跳', () => {
    expect(jumpTargetOf(of({ swipe: null }), world()).kind).toBe('jump');
  });

  it('第 0 句也是句子', () => {
    expect(jumpTargetOf(of({ line: 0 }), world())).toEqual({ kind: 'jump', entryId: 'e1', line: 0 });
  });

  it('回复换了分支就跳不了', () => {
    const t = jumpTargetOf(of({ swipe: 1 }), world());
    expect(t.kind).toBe('none');
    expect(t).toMatchObject({ why: expect.stringContaining('换掉') });
  });

  it('回复删了就跳不了', () => {
    const t = jumpTargetOf(of({ entry_id: 'gone' }), world());
    expect(t).toMatchObject({ kind: 'none', why: expect.stringContaining('删') });
  });

  it('在这张卡的另一个存档里:先读那个档,带着要落的那一句', () => {
    expect(jumpTargetOf(of({ chat_id: 'c2', entry_id: 'e9', line: 4 }), world())).toMatchObject({
      kind: 'load',
      chatId: 'c2',
      entryId: 'e9',
      line: 4,
    });
  });

  it('另一个存档的图:那条回复在当前对话里有没有都不影响(读完才判断)', () => {
    const t = jumpTargetOf(of({ chat_id: 'c2', entry_id: 'gone', swipe: 3 }), world());
    expect(t.kind).toBe('load');
  });

  it('存档删了:跳不了也读不了', () => {
    expect(jumpTargetOf(of({ chat_id: 'gone' }), world())).toMatchObject({ kind: 'none', why: expect.stringContaining('存档') });
  });

  it('老图没记位置:说清楚', () => {
    for (const o of [{ chat_id: null }, { entry_id: null }, { line: null }]) {
      expect(jumpTargetOf(of(o), world())).toMatchObject({ kind: 'none', why: expect.stringContaining('没记') });
    }
  });

  it('没有当前存档时,同一个存档也要先读', () => {
    expect(jumpTargetOf(of({}), world({ currentChatId: null }))).toMatchObject({ kind: 'load', chatId: 'c1' });
  });

  it('相册里没有记录的(只在 CG 包里)没有位置', () => {
    const e: AlbumEntry = { key: 'cg:x', image: null, cg: null, kept: true };
    expect(jumpTargetOf(e, world()).kind).toBe('none');
  });
});

describe('landingOf(跨存档跳转读完档以后)', () => {
  const of = (o: Partial<GeneratedImage>) => entries([img('a', { chat_id: 'c2', entry_id: 'e5', swipe: 1, line: 3, ...o })])[0];
  const loaded = (swipes: Record<string, number>) => (id: string) => swipes[id] ?? null;

  it('那条回复还在、还是那一版:落到那一句', () => {
    expect(landingOf(of({}), 'c2', loaded({ e5: 1 }))).toEqual({ entryId: 'e5', line: 3 });
  });

  it('画它时没记分支的,回复还在就落', () => {
    expect(landingOf(of({ swipe: null }), 'c2', loaded({ e5: 4 }))).toEqual({ entryId: 'e5', line: 3 });
  });

  it('那条回复在读到的对话里没了:停在最新一句,说为什么', () => {
    const r = landingOf(of({}), 'c2', loaded({ e1: 0 }));
    expect(r).toEqual({ note: expect.stringContaining('删了') });
    expect(r).toEqual({ note: expect.stringContaining('最新一句') });
  });

  it('换了分支:停在最新一句,说为什么', () => {
    expect(landingOf(of({}), 'c2', loaded({ e5: 0 }))).toEqual({ note: expect.stringContaining('换掉') });
  });

  it('读到的不是画它的存档(不该发生,也不乱跳)', () => {
    expect(landingOf(of({}), 'c1', loaded({ e5: 1 }))).toEqual({ note: expect.stringContaining('不是画它的') });
  });

  it('老图没记位置:不跳', () => {
    expect(landingOf(of({ line: null }), 'c2', loaded({ e5: 1 }))).toMatchObject({ note: expect.stringContaining('没记') });
  });
});
