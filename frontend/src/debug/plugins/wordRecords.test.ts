import { describe, expect, it } from 'vitest';
import type { ResolveResult, WordRecordOut } from '../lib/api';
import { recordEntryOf, RETRY_MS, WordRecordStore, type RecordsApi } from './wordRecords';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 假后端:records 是库里已有的记录;resolve 一律认成 s2(模型认的) */
function fakeApi(records: Record<string, WordRecordOut[]>) {
  const calls = { records: [] as string[], resolve: [] as [string, string[]][] };
  const state = { fail: null as Error | null };
  const api: RecordsApi = {
    records: async (list) => {
      calls.records.push(list);
      if (state.fail) throw state.fail;
      return records[list] ?? [];
    },
    resolve: async (list, words) => {
      calls.resolve.push([list, [...words]]);
      if (state.fail) throw state.fail;
      return words.map((w): ResolveResult => ({ word: w, key: 's2', label: '生气', how: 'model', source: 'model', score: 0.5 }));
    },
  };
  return { api, calls, state };
}

const rec = (word: string, item: string, source = 'migrated'): WordRecordOut => ({
  word,
  item,
  source,
  guessed: true,
  unstable: false,
  score: null,
});
const KEYS = new Set(['s1', 's2']);

describe('WordRecordStore', () => {
  it('先读整份记录,读到以后只问记录里没有的词', async () => {
    const { api, calls } = fakeApi({ 'pack:p1': [rec('生理', 's2')] });
    const store = new WordRecordStore(api);
    let changed = 0;
    store.sync('pack:p1', ['生理', '嘟嘴'], KEYS, () => changed++);
    expect(calls.resolve).toEqual([]);
    expect(store.records('pack:p1')).toBeNull();
    await flush();
    expect(changed).toBe(1);
    expect(store.records('pack:p1')?.get('生理')).toEqual({ key: 's2', source: 'migrated' });
    store.sync('pack:p1', ['生理', '嘟嘴'], KEYS, () => changed++);
    expect(calls.resolve).toEqual([['pack:p1', ['嘟嘴']]]);
    store.sync('pack:p1', ['生理', '嘟嘴'], KEYS, () => changed++);
    expect(calls.resolve).toHaveLength(1); // 正在问的不重复问
    await flush();
    expect(store.answer('pack:p1', '嘟嘴')).toEqual({ key: 's2', score: 0.5 });
    store.sync('pack:p1', ['生理', '嘟嘴'], KEYS, () => changed++);
    expect(calls.resolve).toHaveLength(1);
    expect(calls.records).toEqual(['pack:p1']);
  });

  it('记录指向的那一项不在名单里了,照样问', async () => {
    const { api, calls } = fakeApi({ 'pack:p1': [rec('嘟嘴', 's9')] });
    const store = new WordRecordStore(api);
    store.sync('pack:p1', ['嘟嘴'], KEYS, () => {});
    await flush();
    store.sync('pack:p1', ['嘟嘴'], KEYS, () => {});
    expect(calls.resolve).toEqual([['pack:p1', ['嘟嘴']]]);
  });

  it('问失败了过一分钟再问', async () => {
    let now = 1000;
    const { api, calls, state } = fakeApi({});
    const store = new WordRecordStore(api, () => now);
    store.sync('builtin', ['嘟嘴'], KEYS, () => {});
    await flush();
    state.fail = new Error('情绪识别模型没装');
    store.sync('builtin', ['嘟嘴'], KEYS, () => {});
    await flush();
    expect(store.answer('builtin', '嘟嘴')).toEqual({ error: '情绪识别模型没装', at: 1000 });
    state.fail = null;
    store.sync('builtin', ['嘟嘴'], KEYS, () => {});
    expect(calls.resolve).toHaveLength(1);
    now += RETRY_MS + 1;
    store.sync('builtin', ['嘟嘴'], KEYS, () => {});
    expect(calls.resolve).toHaveLength(2);
  });

  it('读不到记录(后端还是旧版)就当一条都没有,词照样问,过一分钟再读', async () => {
    let now = 0;
    const { api, calls, state } = fakeApi({ 'pack:p1': [rec('生理', 's2')] });
    state.fail = new Error('404');
    const store = new WordRecordStore(api, () => now);
    store.sync('pack:p1', ['生理'], KEYS, () => {});
    await flush();
    expect(store.records('pack:p1')?.size).toBe(0);
    state.fail = null;
    store.sync('pack:p1', ['生理'], KEYS, () => {});
    expect(calls.resolve).toEqual([['pack:p1', ['生理']]]);
    now += RETRY_MS + 1;
    store.sync('pack:p1', ['生理'], KEYS, () => {});
    await flush();
    expect(calls.records).toHaveLength(2);
    expect(store.records('pack:p1')?.get('生理')?.key).toBe('s2');
  });

  it('后端说已经有记录的词,记进记录', async () => {
    const { api } = fakeApi({});
    api.resolve = async (_list, words) =>
      words.map((w): ResolveResult => ({ word: w, key: 's1', label: '微笑', how: 'record', source: 'player', score: null }));
    const store = new WordRecordStore(api);
    store.sync('pack:p1', ['嘟嘴'], KEYS, () => {});
    await flush();
    store.sync('pack:p1', ['嘟嘴'], KEYS, () => {});
    await flush();
    expect(store.records('pack:p1')?.get('嘟嘴')).toEqual({ key: 's1', source: 'player' });
    expect(store.answer('pack:p1', '嘟嘴')).toBeUndefined();
  });

  it('改一条:马上生效,清掉这个词的模型答案', async () => {
    const { api } = fakeApi({ 'pack:p1': [rec('生理', 's2')] });
    const store = new WordRecordStore(api);
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    await flush();
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    await flush();
    expect(store.answer('pack:p1', '嘟嘴')).toEqual({ key: 's2', score: 0.5 });
    store.put('pack:p1', '嘟嘴', { key: 's1', source: 'player' });
    expect(store.records('pack:p1')?.get('嘟嘴')).toEqual({ key: 's1', source: 'player' });
    expect(store.answer('pack:p1', '嘟嘴')).toBeUndefined();
    // 已有的改成别的
    store.put('pack:p1', '生理', { key: 's1', source: 'player' });
    expect(store.records('pack:p1')?.get('生理')).toEqual({ key: 's1', source: 'player' });
  });

  it('删一条:这个词下次重新问', async () => {
    const { api, calls } = fakeApi({ 'pack:p1': [rec('嘟嘴', 's1')] });
    const store = new WordRecordStore(api);
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    await flush();
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    expect(calls.resolve).toEqual([]);
    store.remove('pack:p1', '嘟嘴');
    expect(store.records('pack:p1')?.has('嘟嘴')).toBe(false);
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    expect(calls.resolve).toEqual([['pack:p1', ['嘟嘴']]]);
    await flush();
    expect(store.answer('pack:p1', '嘟嘴')).toEqual({ key: 's2', score: 0.5 });
    // 删掉模型认过的词,答案也清掉
    store.remove('pack:p1', '嘟嘴');
    expect(store.answer('pack:p1', '嘟嘴')).toBeUndefined();
  });

  it('还在读的时候改了:读回来的可能是改之前的,再读一次', async () => {
    const records: Record<string, WordRecordOut[]> = { 'pack:p1': [] };
    const { api, calls } = fakeApi(records);
    const store = new WordRecordStore(api);
    store.sync('pack:p1', [], KEYS);
    store.put('pack:p1', '嘟嘴', { key: 's1', source: 'player' });
    records['pack:p1'] = [rec('嘟嘴', 's1', 'player')];
    await flush();
    await flush();
    expect(calls.records).toEqual(['pack:p1', 'pack:p1']);
    expect(store.records('pack:p1')?.get('嘟嘴')).toEqual({ key: 's1', source: 'player' });
  });

  it('读到、问到、改、删都通知订阅的;每份名单各记各的版本;退订以后不再通知', async () => {
    const { api } = fakeApi({});
    const store = new WordRecordStore(api);
    let heard = 0;
    const off = store.subscribe(() => heard++);
    expect(store.version('pack:p1')).toBe(0);
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    await flush();
    expect(heard).toBe(1);
    store.sync('pack:p1', ['嘟嘴'], KEYS);
    await flush();
    expect(heard).toBe(2);
    store.put('pack:p1', '生理', { key: 's1', source: 'player' });
    store.remove('pack:p1', '生理');
    expect(heard).toBe(4);
    expect(store.version('pack:p1')).toBe(4);
    expect(store.version('pack:p2')).toBe(0);
    off();
    store.put('pack:p1', '生理', { key: 's1', source: 'player' });
    expect(heard).toBe(4);
    expect(store.version('pack:p1')).toBe(5);
  });
});

describe('recordEntryOf', () => {
  it('后端的一条 → 缓存里的一条;不认识的来源当模型认的', () => {
    expect(recordEntryOf(rec('嘟嘴', 's1', 'player'))).toEqual({ key: 's1', source: 'player' });
    expect(recordEntryOf(rec('嘟嘴', 's1', 'jev'))).toEqual({ key: 's1', source: 'model' });
  });
});
