import { describe, expect, it } from 'vitest';
import type { WordRecordOut } from '../../lib/api';
import { filterRecords, firstPage, recordWho } from './recordsView';

const rec = (word: string, source: string, guessed = false): WordRecordOut => ({
  word,
  item: 'x',
  source,
  guessed,
  unstable: false,
  score: null,
});

describe('认词记录页签', () => {
  it('谁定的:你改的 / 模型猜的 / 模型认的 / 以前留下的 / 改名留下的', () => {
    expect(recordWho(rec('哼', 'player'))).toBe('你改的');
    expect(recordWho(rec('欸', 'model', true))).toBe('模型猜的');
    expect(recordWho(rec('嘛', 'model'))).toBe('模型认的');
    expect(recordWho(rec('好', 'migrated'))).toBe('以前留下的');
    expect(recordWho(rec('呜', 'rename'))).toBe('改名留下的');
    expect(recordWho(rec('?', 'jev'))).toBe('jev');
  });

  it('搜词不分大小写;只看模型猜的', () => {
    const all = [rec('才不是', 'model'), rec('OK啦', 'player'), rec('欸?!', 'model', true)];
    expect(filterRecords(all, '不是', false).map((r) => r.word)).toEqual(['才不是']);
    expect(filterRecords(all, 'ok', false).map((r) => r.word)).toEqual(['OK啦']);
    expect(filterRecords(all, '', true).map((r) => r.word)).toEqual(['欸?!']);
    expect(filterRecords(all, '  ', false)).toHaveLength(3);
  });

  it('超过 50 条先显示 50 条,其余写条数', () => {
    const many = Array.from({ length: 57 }, (_, i) => i);
    expect(firstPage(many, false)).toEqual({ shown: many.slice(0, 50), rest: 7 });
    expect(firstPage(many, true)).toEqual({ shown: many, rest: 0 });
    expect(firstPage([1, 2], false)).toEqual({ shown: [1, 2], rest: 0 });
  });
});
