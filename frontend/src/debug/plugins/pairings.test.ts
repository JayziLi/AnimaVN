import { describe, expect, it } from 'vitest';
import type { PairingFillOut, PairingFollower, PairingTableOut, SceneAsset } from '../lib/api';
import {
  cgFrameFromPairs,
  missingCell,
  PairingFiller,
  PairingStore,
  voiceRowFromPairs,
  type PairingsLoader,
} from './pairings';
import { RETRY_MS } from './wordRecords';

const flush = () => new Promise((r) => setTimeout(r, 0));

const table = (target: string, cells: [item: string, value: string | null][]): PairingTableOut => ({
  id: `t-${target}`,
  follower: 'voice',
  list_ref: 'pack:p1',
  target,
  cards: [],
  cells: cells.map(([item, value]) => ({ item, value, source: 'migrated', guessed: false, pending: false, unstable: false })),
});

/** 假后端:按「跟随者 名单」回库里的共用表 */
function fakeLoader(tables: Record<string, PairingTableOut[]>) {
  const calls: string[] = [];
  const state = { fail: null as Error | null };
  const load: PairingsLoader = async (follower, listRef) => {
    calls.push(`${follower} ${listRef}`);
    if (state.fail) throw state.fail;
    return tables[`${follower} ${listRef}`] ?? [];
  };
  return { load, calls, state };
}

describe('PairingStore', () => {
  it('每份名单读一次,读到以后按声音、立绘查', async () => {
    const { load, calls } = fakeLoader({
      'voice pack:p1': [table('v1', [['s1', 'e2'], ['s2', 'e1']]), table('v2', [['s1', 'x1']])],
    });
    const store = new PairingStore(load);
    let changed = 0;
    store.sync('voice', 'pack:p1', () => changed++);
    expect(store.tables('voice', 'pack:p1')).toBeNull();
    store.sync('voice', 'pack:p1', () => changed++); // 正在读的不重复读
    await flush();
    expect(changed).toBe(1);
    const got = store.tables('voice', 'pack:p1');
    expect(got?.get('v1')?.get('s1')).toBe('e2');
    expect(got?.get('v1')?.get('s2')).toBe('e1');
    expect(got?.get('v2')?.get('s1')).toBe('x1');
    store.sync('voice', 'pack:p1', () => changed++);
    await flush();
    expect(calls).toEqual(['voice pack:p1']);
    expect(changed).toBe(1);
    // 语音和 CG、不同的名单各读各的
    expect(store.tables('cg', 'pack:p1')).toBeNull();
    expect(store.tables('voice', 'pack:p2')).toBeNull();
  });

  it('读不到当没有表,过一会儿再读', async () => {
    let t = 1000;
    const { load, calls, state } = fakeLoader({ 'voice pack:p1': [table('v1', [['s1', 'e2']])] });
    state.fail = new Error('后端还是旧版');
    const store = new PairingStore(load, () => t);
    store.sync('voice', 'pack:p1', () => {});
    await flush();
    expect(store.tables('voice', 'pack:p1')?.size).toBe(0);
    store.sync('voice', 'pack:p1', () => {});
    expect(calls).toHaveLength(1);
    state.fail = null;
    t += RETRY_MS + 1;
    store.sync('voice', 'pack:p1', () => {});
    await flush();
    expect(calls).toHaveLength(2);
    expect(store.tables('voice', 'pack:p1')?.get('v1')?.get('s1')).toBe('e2');
  });

  it('改一格:马上生效,换成新的表(旧的不动),别的声音的表照旧', async () => {
    const { load } = fakeLoader({
      'voice pack:p1': [table('v1', [['s1', 'e2'], ['s2', 'e1']]), table('v2', [['s1', 'x1']])],
    });
    const store = new PairingStore(load);
    store.sync('voice', 'pack:p1');
    await flush();
    const before = store.tables('voice', 'pack:p1');
    store.putCell('voice', 'pack:p1', 'v1', 's1', 'e3');
    const after = store.tables('voice', 'pack:p1');
    expect(after).not.toBe(before);
    expect(after?.get('v1')?.get('s1')).toBe('e3');
    expect(after?.get('v1')?.get('s2')).toBe('e1');
    expect(after?.get('v2')).toBe(before?.get('v2'));
    expect(before?.get('v1')?.get('s1')).toBe('e2');
    // 没有的格子、没有的表都新加
    store.putCell('voice', 'pack:p1', 'v1', 's3', 'e1');
    store.putCell('voice', 'pack:p1', 'v3', 's1', 'y1');
    expect(store.tables('voice', 'pack:p1')?.get('v1')?.get('s3')).toBe('e1');
    expect(store.tables('voice', 'pack:p1')?.get('v3')?.get('s1')).toBe('y1');
  });

  it('补配回来的格子加进表里;一格都没补上不换表', async () => {
    const { load } = fakeLoader({ 'cg pack:p1': [table('c1', [['s1', 'c1a']])] });
    const store = new PairingStore(load);
    store.sync('cg', 'pack:p1');
    await flush();
    const cell = (item: string, value: string | null) => ({
      item,
      value,
      source: 'name',
      guessed: false,
      pending: true,
      unstable: false,
    });
    store.addCells('cg', 'pack:p1', 'c1', [cell('s2', null), cell('s3', 'c1b')]);
    store.addCells('cg', 'pack:p1', 'c2', [cell('s1', null)]);
    const got = store.tables('cg', 'pack:p1');
    expect(got?.get('c1')).toEqual(
      new Map([
        ['s1', 'c1a'],
        ['s2', null],
        ['s3', 'c1b'],
      ]),
    );
    expect(got?.get('c2')).toEqual(new Map([['s1', null]]));
    store.addCells('cg', 'pack:p1', 'c1', []);
    expect(store.tables('cg', 'pack:p1')).toBe(got);
  });

  it('重读:读完换成新的表;正在读时叫重读,读完再读一次', async () => {
    const tables: Record<string, PairingTableOut[]> = { 'voice pack:p1': [table('v1', [['s1', 'e2']])] };
    const { load, calls } = fakeLoader(tables);
    const store = new PairingStore(load);
    store.sync('voice', 'pack:p1');
    await flush();
    tables['voice pack:p1'] = [table('v1', [['s1', 'e5']])];
    store.reload('voice', 'pack:p1');
    store.reload('voice', 'pack:p1');
    await flush();
    await flush();
    expect(calls).toEqual(['voice pack:p1', 'voice pack:p1', 'voice pack:p1']);
    expect(store.tables('voice', 'pack:p1')?.get('v1')?.get('s1')).toBe('e5');
    // 没读过的名单也能重读
    store.reload('cg', 'pack:p2');
    await flush();
    expect(calls).toHaveLength(4);
    expect(store.tables('cg', 'pack:p2')?.size).toBe(0);
  });

  it('还在读的时候改了:读回来的可能是改之前的,再读一次', async () => {
    const tables: Record<string, PairingTableOut[]> = { 'voice pack:p1': [table('v1', [['s1', 'e2']])] };
    const { load, calls } = fakeLoader(tables);
    const store = new PairingStore(load);
    store.sync('voice', 'pack:p1');
    store.putCell('voice', 'pack:p1', 'v1', 's1', 'e3');
    tables['voice pack:p1'] = [table('v1', [['s1', 'e3']])];
    await flush();
    await flush();
    expect(calls).toHaveLength(2);
    expect(store.tables('voice', 'pack:p1')?.get('v1')?.get('s1')).toBe('e3');
  });

  it('读到、改格、补配、重读都通知订阅的;退订以后不再通知', async () => {
    const { load } = fakeLoader({ 'voice pack:p1': [table('v1', [['s1', 'e2']])] });
    const store = new PairingStore(load);
    let heard = 0;
    const off = store.subscribe(() => heard++);
    store.sync('voice', 'pack:p1');
    await flush();
    expect(heard).toBe(1);
    store.putCell('voice', 'pack:p1', 'v1', 's1', 'e3');
    store.addCells('voice', 'pack:p1', 'v1', [
      { item: 's2', value: 'e1', source: 'local', guessed: false, pending: true, unstable: false },
    ]);
    expect(heard).toBe(3);
    store.reload('voice', 'pack:p1');
    await flush();
    expect(heard).toBe(4);
    off();
    store.putCell('voice', 'pack:p1', 'v1', 's1', 'e1');
    expect(heard).toBe(4);
  });
});

describe('voiceRowFromPairs', () => {
  const sprites = [
    { id: 's1', label: '微笑' },
    { id: 's2', label: '平静' },
    { id: 's3', label: '生气' },
    // 同名的立绘:和舞台一样认排前面的那张
    { id: 's4', label: '微笑' },
  ];
  const pick = voiceRowFromPairs(
    new Map([
      ['s1', 'e2'],
      ['s2', null],
      ['s4', 'e9'],
    ]),
    sprites,
  );

  it('表情名 → 包里那张立绘 → 配的那一行', () => {
    expect(pick('微笑')).toBe('e2');
  });

  it('表里没有、格子是空的、不是包里的表情、没有表情,都交给后端按名字挑', () => {
    expect(pick('平静')).toBeUndefined();
    expect(pick('生气')).toBeUndefined();
    expect(pick('嘟嘴')).toBeUndefined();
    expect(pick(null)).toBeUndefined();
  });
});

describe('cgFrameFromPairs', () => {
  const cg = (id: string, label: string, parent: string | null, hasFile = true): SceneAsset =>
    ({ id, kind: 'cg', label, aliases: [], has_file: hasFile, parent_id: parent, forms: [] }) as unknown as SceneAsset;
  const hug = cg('c1', '拥抱', null);
  const smile = cg('c1a', '微笑', 'c1');
  const calm = cg('c1b', '平静', 'c1');
  const noFile = cg('c1c', '生气', 'c1', false);
  const walk = cg('c2', '散步', null, false);
  const walkSmile = cg('c2a', '微笑', 'c2');
  const other = cg('c3', '看海', null);
  const otherSmile = cg('c3a', '微笑', 'c3');
  const assets = [hug, smile, calm, noFile, walk, walkSmile, other, otherSmile];
  const sprites = [
    { id: 's1', label: '微笑' },
    { id: 's2', label: '平静' },
    { id: 's3', label: '生气' },
    { id: 's4', label: '害羞' },
    { id: 's5', label: '困' },
    // 同名的立绘:和舞台一样认排前面的那张
    { id: 's6', label: '微笑' },
  ];
  const pick = cgFrameFromPairs(
    new Map([
      [
        'c1',
        new Map<string, string | null>([
          ['s1', 'c1b'], // 和名字对不上也按表
          ['s2', null], // 构图本身
          ['s3', 'c1c'], // 那张差分没传图
          ['s4', 'gone'], // 那张差分删了
          ['s5', 'c3a'], // 别的构图的差分
          ['s6', 'c1a'],
        ]),
      ],
      ['c2', new Map<string, string | null>([['s1', null]])],
    ]),
    sprites,
    assets,
  );

  it('表情名 → 包里那张立绘 → 表里配的那张差分', () => {
    expect(pick(hug, '微笑')).toBe(calm);
  });

  it('格子是空的、那张差分没图、不在了、不是这张构图的:用构图本身', () => {
    for (const label of ['平静', '生气', '害羞', '困']) expect(pick(hug, label)).toBe(hug);
    // 构图本身没传图:用第一张有图的差分(和按名字找时一样)
    expect(pick(walk, '微笑')).toBe(walkSmile);
  });

  it('这张构图没有表、表里没有这一格、不是包里的表情、没有表情:照旧按名字找', () => {
    expect(pick(other, '微笑')).toBeUndefined();
    expect(pick(walk, '平静')).toBeUndefined();
    expect(pick(hug, '嘟嘴')).toBeUndefined();
    expect(pick(hug, null)).toBeUndefined();
  });
});

describe('missingCell', () => {
  const sprites = [
    { id: 's1', label: '微笑' },
    { id: 's2', label: '平静' },
    { id: 's3', label: '微笑' },
  ];

  it('这句的表情是包里一张立绘、表里没有它的格子(表都没有也算):那张立绘', () => {
    expect(missingCell(new Map([['s1', 'e1']]), sprites, '平静')).toBe('s2');
    expect(missingCell(undefined, sprites, '微笑')).toBe('s1');
  });

  it('有格子(空的也算)、不是包里的表情、没有表情:不用补', () => {
    expect(missingCell(new Map([['s1', 'e1']]), sprites, '微笑')).toBeNull();
    expect(missingCell(new Map([['s2', null]]), sprites, '平静')).toBeNull();
    expect(missingCell(new Map(), sprites, '嘟嘴')).toBeNull();
    expect(missingCell(new Map(), sprites, null)).toBeNull();
  });
});

describe('PairingFiller', () => {
  const out = (added: string[], skipped: string[] = []): PairingFillOut => ({
    table_id: 't',
    added: added.map((item) => ({ item, value: 'e1', source: 'name', guessed: false, pending: false, unstable: false })),
    skipped: skipped.map((item) => ({ item, reason: '本地模型没装' })),
  });

  /** 假后端:每次补配记一笔,回答由测试一次一次给 */
  function fakeFill() {
    const calls: string[] = [];
    const answers: ((r: PairingFillOut | Error) => void)[] = [];
    const fill = (follower: PairingFollower, listRef: string, target: string) => {
      calls.push(`${follower} ${listRef} ${target}`);
      return new Promise<PairingFillOut>((resolve, reject) =>
        answers.push((r) => (r instanceof Error ? reject(r) : resolve(r))),
      );
    };
    const answer = async (r: PairingFillOut | Error) => {
      answers.shift()?.(r);
      await flush();
    };
    return { fill, calls, answer };
  }

  it('缺一格发一次;同一张表正在补时不再发,别的表照发', async () => {
    const { fill, calls, answer } = fakeFill();
    const filler = new PairingFiller(fill);
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(true);
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(false);
    expect(filler.want('voice', 'pack:p1', 'v1', 's3')).toBe(false);
    expect(filler.want('cg', 'pack:p1', 'c1', 's2')).toBe(true);
    expect(filler.want('voice', 'pack:p1', 'v2', 's2')).toBe(true);
    expect(calls).toEqual(['voice pack:p1 v1', 'cg pack:p1 c1', 'voice pack:p1 v2']);
    await answer(out(['s2', 's3']));
    // 补过的不再为它发(补上的别的项也算)
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(false);
    expect(filler.want('voice', 'pack:p1', 'v1', 's3')).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it('补完以后又缺了别的(后加的立绘):再发一次', async () => {
    const { fill, calls, answer } = fakeFill();
    const filler = new PairingFiller(fill);
    filler.want('voice', 'pack:p1', 'v1', 's2');
    await answer(out(['s2']));
    expect(filler.want('voice', 'pack:p1', 'v1', 's9')).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('后端说这一格已经有了(别处补过):也不再为它发', async () => {
    const { fill, calls, answer } = fakeFill();
    const filler = new PairingFiller(fill);
    filler.want('voice', 'pack:p1', 'v1', 's2');
    await answer(out([]));
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('请求失败、这一格没补上:过一分钟才再发', async () => {
    let t = 1000;
    const { fill, calls, answer } = fakeFill();
    const filler = new PairingFiller(fill, () => t);
    filler.want('voice', 'pack:p1', 'v1', 's2');
    await answer(new Error('后端没开'));
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(false);
    expect(filler.want('voice', 'pack:p1', 'v1', 's3')).toBe(false);
    t += RETRY_MS + 1;
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(true);
    // 本地模型还没好:这一格在 skipped 里,也是过一分钟再试
    await answer(out([], ['s2']));
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(false);
    t += RETRY_MS + 1;
    expect(filler.want('voice', 'pack:p1', 'v1', 's2')).toBe(true);
    expect(calls).toHaveLength(3);
  });
});
