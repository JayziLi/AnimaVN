import { describe, expect, it } from 'vitest';
import type { PackSprite } from '../lib/api';
import type { TagHit } from '../vn/script';
import {
  emotionListRef,
  isRecognized,
  matchTag,
  type EmotionCandidate,
  type ModelEntry,
  type RecordEntry,
} from './emotionMatch';
import { spriteLabelAfter } from './voice';

const cands: EmotionCandidate[] = [
  { key: 's1', label: '微笑', aliases: ['说话'] },
  { key: 's2', label: '生气', aliases: [] },
];
const none = (): ModelEntry | undefined => undefined;
const records = new Map<string, RecordEntry>([
  ['嘟嘴', { key: 's1', source: 'migrated' }],
  ['说话', { key: 's2', source: 'player' }],
  ['停用的', { key: 's9', source: 'model' }],
]);

describe('matchTag', () => {
  it('名字和别名最先,认词记录其次', () => {
    expect(matchTag(' 说话 ', cands, none, records)).toEqual({ state: 'exact', label: '微笑' });
    expect(matchTag('嘟嘴', cands, none, records)).toEqual({ state: 'record', label: '微笑', source: 'migrated' });
  });

  it('记录指向的那一项不在名单里了,当没记,交给模型', () => {
    const lookup = (t: string): ModelEntry | undefined => (t === '停用的' ? { key: 's2', score: 0.6 } : undefined);
    expect(matchTag('停用的', cands, lookup, records)).toEqual({ state: 'model', label: '生气', score: 0.6 });
    expect(matchTag('停用的', cands, none, records)).toEqual({ state: 'pending' });
  });

  it('不传认词记录时和以前一样', () => {
    expect(matchTag('嘟嘴', cands, none)).toEqual({ state: 'pending' });
    expect(matchTag('嘟嘴', cands, () => ({ error: '没装', at: 0 }))).toEqual({ state: 'failed', reason: '没装' });
    expect(matchTag('长'.repeat(41), cands, none, records)).toEqual({ state: 'failed', reason: '标签太长' });
    expect(matchTag('  ', cands, none, records)).toEqual({ state: 'failed', reason: '标签里没写表情' });
  });

  it('名字、记录、模型认出来的都算认出来了', () => {
    expect(isRecognized({ state: 'record', label: '微笑', source: 'model' })).toBe(true);
    expect(isRecognized({ state: 'model', label: '微笑', score: 0.5 })).toBe(true);
    expect(isRecognized({ state: 'pending' })).toBe(false);
  });
});

describe('emotionListRef', () => {
  it('有立绘是当前立绘包,没有是内置表情', () => {
    expect(emotionListRef([{ id: 's1', pack_id: 'p1' } as PackSprite])).toBe('pack:p1');
    expect(emotionListRef([])).toBe('builtin');
  });
});

describe('spriteLabelAfter', () => {
  it('认词记录认出来的也换表情', () => {
    const hit: TagHit = { kind: 'sprite', raw: '<sprite:嘟嘴>', label: '嘟嘴', lineIndex: 0, speaker: null };
    const ctx = { resolve: (l: string) => matchTag(l, cands, none, records), rawOnFail: false, charName: '星绘' };
    expect(spriteLabelAfter([hit], ctx, '生气')).toBe('微笑');
  });
});
