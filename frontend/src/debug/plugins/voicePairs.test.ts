import { describe, expect, it } from 'vitest';
import type { VoiceProfile } from '../lib/api';
import type { EmotionContext } from './emotionMatch';
import { planVoiceLines, voiceKey } from './voice';

const row = (id: string, label: string) => ({ id, label, aliases: [] });
const main = {
  id: 'v1',
  name: '星绘',
  aliases: [],
  text_lang: 'zh',
  emotions: [row('e1', '平静'), row('e2', '微笑'), row('e4', '害羞')],
} as unknown as VoiceProfile;
const other = { id: 'v2', name: '路人', aliases: [], text_lang: 'zh', emotions: [row('o1', '平静')] } as unknown as VoiceProfile;
const ctx = { charName: '星绘', rawOnFail: true, resolve: () => ({ state: 'none' }) } as unknown as EmotionContext;

const LINES = [
  { speaker: '星绘', text: '早上好。' },
  { speaker: '路人', text: '你好。' },
  { speaker: '星绘', text: '走吧。' },
];

const plan = (o: { pickRow?: (emotion: string | null) => string | undefined; fixedEmotion?: boolean; waitRows?: boolean } = {}) =>
  planVoiceLines({
    lines: LINES,
    hits: [],
    emotionBefore: '微笑',
    ctx,
    cast: { main, extras: [other] },
    streaming: false,
    fixedEmotion: o.fixedEmotion ?? false,
    pickRow: o.pickRow,
    waitRows: o.waitRows,
  });

describe('语音按配对表念(表情认法 = 认词记录)', () => {
  it('主声音带上配对表挑好的那一行,表情名照旧;别的声音不查表', () => {
    const asked: (string | null)[] = [];
    const pickRow = (e: string | null) => {
      asked.push(e);
      return e === '微笑' ? 'e4' : undefined;
    };
    expect(plan({ pickRow })).toEqual([
      { profile_id: 'v1', emotion: '微笑', emotion_id: 'e4', text: '早上好。' },
      { profile_id: 'v2', emotion: null, text: '你好。' },
      { profile_id: 'v1', emotion: '微笑', emotion_id: 'e4', text: '走吧。' },
    ]);
    expect(asked).toEqual(['微笑', '微笑']);
  });

  it('表里查不到时不带 emotion_id,交给后端按名字挑', () => {
    const got = plan({ pickRow: () => undefined });
    expect(got).toEqual(plan());
    for (const r of got) expect(r).not.toHaveProperty('emotion_id');
  });

  it('不传 pickRow(旧算法)时和以前一模一样:没有 emotion_id 这个键', () => {
    const got = plan();
    expect(got).toEqual([
      { profile_id: 'v1', emotion: '微笑', text: '早上好。' },
      { profile_id: 'v2', emotion: null, text: '你好。' },
      { profile_id: 'v1', emotion: '微笑', text: '走吧。' },
    ]);
    for (const r of got) expect(r).not.toHaveProperty('emotion_id');
  });

  it('开关或配对表还没读到时,主声音带表情的台词先不念;别的声音照念', () => {
    expect(plan({ waitRows: true })).toEqual([null, { profile_id: 'v2', emotion: null, text: '你好。' }, null]);
    // 情绪不变时不看表情,不用等
    expect(plan({ waitRows: true, fixedEmotion: true })[0]).toEqual({ profile_id: 'v1', emotion: null, text: '早上好。' });
  });

  it('情绪不变时主声音也不查表', () => {
    for (const r of plan({ fixedEmotion: true, pickRow: () => 'e4' })) expect(r).not.toHaveProperty('emotion_id');
  });

  it('缓存键带上 emotion_id:同一句配到不同的行是两段语音', () => {
    const [byName] = plan();
    const [paired] = plan({ pickRow: () => 'e4' });
    expect(voiceKey(byName!)).toBe('v1\u0000微笑\u0000\u0000早上好。');
    expect(voiceKey(paired!)).toBe('v1\u0000微笑\u0000e4\u0000早上好。');
    expect(voiceKey(paired!)).not.toBe(voiceKey(plan({ pickRow: () => 'e1' })[0]!));
  });
});
