import { describe, expect, it } from 'vitest';
import type { VoiceProfile } from '../lib/api';
import type { TagHit } from '../vn/script';
import type { EmotionContext, TagMatch } from './emotionMatch';
import type { VoiceVersion } from './cartridges';
import { planVoiceLines } from './voice';

const row = (id: string, label: string) => ({ id, label, aliases: [] });
const main = {
  id: 'v1',
  name: '星绘',
  aliases: [],
  text_lang: 'zh',
  emotions: [row('e1', '平静'), row('e2', '微笑'), row('e4', '害羞'), row('e5', '害羞·另一版')],
} as unknown as VoiceProfile;
const other = { id: 'v2', name: '路人', aliases: [], text_lang: 'zh', emotions: [] } as unknown as VoiceProfile;

const LINES = [
  { speaker: '星绘', text: '早上好。' },
  { speaker: '星绘', text: '今天去哪?' },
  { speaker: '路人', text: '你好。' },
];
/** 第 0 句上有个还在问模型的标签 */
const HITS: TagHit[] = [{ kind: 'sprite', raw: '<sprite:嘟嘴>', label: '嘟嘴', lineIndex: 0, speaker: '星绘' }];
const pendingCtx = {
  charName: '星绘',
  rawOnFail: false,
  resolve: (): TagMatch => ({ state: 'pending' }),
} as unknown as EmotionContext;
const plainCtx = { charName: '星绘', rawOnFail: false, resolve: () => ({ state: 'none' }) } as unknown as EmotionContext;

type Opts = Partial<Parameters<typeof planVoiceLines>[0]>;
const plan = (o: Opts = {}) =>
  planVoiceLines({
    lines: LINES,
    hits: [],
    emotionBefore: '微笑',
    ctx: plainCtx,
    cast: { main, extras: [other] },
    streaming: false,
    fixedEmotion: false,
    ...o,
  });

describe('a line whose emotion the player changed (planVoiceLines manual)', () => {
  it('reads that line with the picked emotion; the other lines stay as they were', () => {
    expect(plan({ manual: (i) => (i === 1 ? '害羞' : undefined) })).toEqual([
      { profile_id: 'v1', emotion: '微笑', text: '早上好。' },
      { profile_id: 'v1', emotion: '害羞', text: '今天去哪?' },
      { profile_id: 'v2', emotion: null, text: '你好。' },
    ]);
  });

  it('without marks the plan is exactly what it was', () => {
    expect(plan({ manual: () => undefined })).toEqual(plan());
  });

  it('does not wait for the model on that line, and skips the form conversion', () => {
    const o = { hits: HITS, ctx: pendingCtx, mapEmotion: () => '换算后' };
    expect(plan(o)[0]).toBeNull();
    expect(plan({ ...o, manual: (i) => (i === 0 ? '害羞' : undefined) })[0]).toEqual({
      profile_id: 'v1',
      emotion: '害羞',
      text: '早上好。',
    });
  });

  it('still goes through the pairing table and the version swap', () => {
    // 假的「换版本」:判了「另一版」的句子换成「表情·另一版」那一行(真的在声线卡带里)
    const version: VoiceVersion = {
      name: (e, tone) => (e && tone === '另一版' ? `${e}·另一版` : e),
      row: (id, tone) => (tone === '另一版' && id === 'e4' ? 'e5' : id),
    };
    const asked: (string | null)[] = [];
    const got = plan({
      manual: (i) => (i === 0 ? '害羞' : undefined),
      pickRow: (e) => {
        asked.push(e);
        return e === '害羞' ? 'e4' : undefined;
      },
      tone: (i) => (i === 0 ? '另一版' : null),
      version,
    });
    expect(got[0]).toEqual({ profile_id: 'v1', emotion: '害羞·另一版', emotion_id: 'e5', text: '早上好。' });
    expect(asked).toEqual(['害羞', '微笑']);
  });

  it('still waits for the pairing table, and fixed emotion ignores it', () => {
    const manual = (i: number) => (i === 0 ? '害羞' : undefined);
    expect(plan({ manual, waitRows: true })[0]).toBeNull();
    expect(plan({ manual, fixedEmotion: true })[0]).toEqual({ profile_id: 'v1', emotion: null, text: '早上好。' });
  });
});
