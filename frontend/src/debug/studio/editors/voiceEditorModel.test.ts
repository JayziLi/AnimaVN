import { describe, expect, it } from 'vitest';
import type { VoiceEmotion, VoiceProfile } from '../../lib/api';
import { BUILTIN_EMOTIONS } from '../../plugins/emotions';
import { VOICE_SAMPLES } from '../../plugins/voice';
import {
  basename,
  fmtSpeed,
  matchBadge,
  moveToFront,
  newEmotionFrom,
  peaksOf,
  progressText,
  refPatch,
  rowText,
  samplesFor,
  selectAfterDelete,
  tableNote,
  withParam,
} from './voiceEditorModel';

const emo = (id: string, label: string, over: Partial<VoiceEmotion> = {}): VoiceEmotion => ({
  id,
  profile_id: 'v',
  label,
  aliases: [],
  ref_path: '',
  prompt_text: '',
  aux_refs: [],
  emo_vector: null,
  sort: 0,
  ...over,
});

const profile = (emotions: VoiceEmotion[]): VoiceProfile => ({
  id: 'v',
  name: '刻晴(中文)',
  aliases: [],
  connection_id: 'c',
  gpt_weights: '',
  sovits_weights: '',
  ref_path: '',
  text_lang: 'zh',
  speed: 1,
  params: {},
  emotions,
  card_count: 1,
});

describe('matchBadge', () => {
  const p = profile([emo('a', '微笑', { aliases: ['平静'] }), emo('b', '开心'), emo('c', '难过')]);

  it('says every sprite matched when names or aliases cover them all (case-insensitive)', () => {
    expect(matchBadge(['微笑', '平静', '开心'], p)).toEqual({ ok: true, text: '3 张差分均已匹配', missing: [] });
  });

  it('counts the sprites that did not match', () => {
    expect(matchBadge(['微笑', '害羞', '生气'], p)).toEqual({ ok: false, text: '2 张差分没对上', missing: ['害羞', '生气'] });
  });

  it('falls back to the built-in emotions for a card without sprites', () => {
    const all = BUILTIN_EMOTIONS.map((e) => e.label);
    const full = profile(all.map((l, i) => emo(`e${i}`, l)));
    expect(matchBadge([], full)).toEqual({ ok: true, text: `${all.length} 种基础表情均已匹配`, missing: [] });
    const r = matchBadge([], p);
    expect(r?.ok).toBe(false);
    expect(r?.text).toMatch(/^\d+ 种基础表情没对上$/);
  });

  it('shows nothing when there is nothing to compare against (asset library, backup voice)', () => {
    expect(matchBadge(null, p)).toBeNull();
  });
});

describe('tableNote', () => {
  it('explains the matching only when the table is matched against sprites', () => {
    expect(tableNote(12, true)).toBe('12 种 · 按当前差分匹配情绪,用对应的参考音频合成');
    expect(tableNote(3, false)).toBe('3 种 · 排第一的是默认情绪');
  });
});

describe('newEmotionFrom', () => {
  const rows = [emo('a', '微笑', { aliases: ['情绪'] }), emo('b', '开心')];

  it('reads the emotion name and line from a 【情绪】原文.wav path', () => {
    expect(newEmotionFrom(' "D:/AnimaVoice/refs/刻晴/【害羞】你能不能告诉我.wav" ', rows)).toEqual({
      label: '害羞',
      ref_path: 'D:/AnimaVoice/refs/刻晴/【害羞】你能不能告诉我.wav',
      prompt_text: '你能不能告诉我',
    });
  });

  it('does not reuse a name already taken by a row or an alias', () => {
    expect(newEmotionFrom('D:\\refs\\【开心】好耶.wav', rows).label).toBe('开心2');
    expect(newEmotionFrom('D:/refs/random_take.wav', rows)).toEqual({
      label: '情绪2',
      ref_path: 'D:/refs/random_take.wav',
      prompt_text: '',
    });
  });

  it('takes anything that is not a path as the emotion name, as typed', () => {
    expect(newEmotionFrom('  害羞 ', rows)).toEqual({ label: '害羞' });
    // 撞名交给后端报出来,不偷偷改名
    expect(newEmotionFrom('开心', rows)).toEqual({ label: '开心' });
  });
});

describe('refPatch', () => {
  it('fills the reference text from the file name only while it is empty', () => {
    expect(refPatch(emo('a', '微笑'), 'D:/r/【微笑】烟花真好看.wav')).toEqual({
      ref_path: 'D:/r/【微笑】烟花真好看.wav',
      prompt_text: '烟花真好看',
    });
    expect(refPatch(emo('a', '微笑', { prompt_text: '原来的' }), '"D:/r/【微笑】烟花真好看.wav"')).toEqual({
      ref_path: 'D:/r/【微笑】烟花真好看.wav',
    });
    expect(refPatch(emo('a', '微笑'), 'D:/r/take1.wav')).toEqual({ ref_path: 'D:/r/take1.wav' });
  });
});

describe('rowText', () => {
  it('shows the reference text, else the file name, else says what is missing', () => {
    expect(rowText(emo('a', '微笑', { prompt_text: '烟花', ref_path: 'D:/r/x.wav' }), false)).toEqual({
      text: '烟花',
      faint: false,
    });
    expect(rowText(emo('a', '微笑', { ref_path: 'D:/r/x.wav' }), false)).toEqual({ text: 'x.wav', faint: true });
    expect(rowText(emo('a', '微笑'), false)).toEqual({ text: '还没填参考音频', faint: true });
  });

  it('describes IndexTTS rows by their vector or the timbre reference', () => {
    expect(rowText(emo('a', '开心', { emo_vector: [0.6, 0, 0, 0, 0, 0, 0, 0.2] }), true)).toEqual({
      text: '向量 · 喜 0.6 · 平 0.2',
      faint: true,
    });
    expect(rowText(emo('a', '平静'), true)).toEqual({ text: '沿用音色参考的语气', faint: true });
    expect(rowText(emo('a', '开心', { ref_path: 'D:/r/happy.wav' }), true)).toEqual({ text: 'happy.wav', faint: true });
  });
});

describe('withParam', () => {
  it('drops a parameter set back to its default, keeps the rest', () => {
    expect(withParam({ temperature: 0.7, top_k: 5 }, 'temperature', 1, 1)).toEqual({ top_k: 5 });
    expect(withParam({ top_k: 5 }, 'temperature', 0.7, 1)).toEqual({ top_k: 5, temperature: 0.7 });
    expect(withParam({ text_split_method: 'cut0' }, 'text_split_method', 'cut5', 'cut5')).toEqual({});
    expect(withParam({ emo_alpha: 0.5 }, 'emo_alpha', undefined, null)).toEqual({});
  });
});

describe('formatting', () => {
  it('formats speed like the mock-up (1.0×) without float noise', () => {
    expect(fmtSpeed(1)).toBe('1.0×');
    expect(fmtSpeed(1.1)).toBe('1.1×');
    expect(fmtSpeed(1.05)).toBe('1.05×');
    expect(fmtSpeed(0.9500000001)).toBe('0.95×');
  });

  it('formats playback progress and clamps it', () => {
    expect(progressText(1.06, 2.61)).toBe('1.1 / 2.6 秒');
    expect(progressText(5, 2.6)).toBe('2.6 / 2.6 秒');
    expect(progressText(-1, 2.6)).toBe('0.0 / 2.6 秒');
  });

  it('takes the last path segment either slash way', () => {
    expect(basename('D:\\refs\\刻晴\\【微笑】a.wav')).toBe('【微笑】a.wav');
    expect(basename('refs/a.wav')).toBe('a.wav');
    expect(basename('a.wav')).toBe('a.wav');
  });
});

describe('peaksOf', () => {
  it('takes the loudest sample of each bucket, scaled so the loudest bucket is 1', () => {
    expect(peaksOf([0, 0.1, -0.5, 0.2, 0.25, -0.05], 3)).toEqual([0.2, 1, 0.5]);
  });

  it('copes with silence, short clips and no buckets', () => {
    expect(peaksOf([0, 0, 0, 0], 2)).toEqual([0, 0]);
    expect(peaksOf([0.5], 3)).toEqual([0, 0, 1]);
    expect(peaksOf([], 2)).toEqual([0, 0]);
    expect(peaksOf([1, 2], 0)).toEqual([]);
  });
});

describe('samplesFor', () => {
  it('uses the Japanese sentences for a Japanese voice', () => {
    expect(samplesFor('ja')).toBe(VOICE_SAMPLES.ja);
    expect(samplesFor('all_ja')).toBe(VOICE_SAMPLES.ja);
    expect(samplesFor('zh')).toBe(VOICE_SAMPLES.zh);
    expect(samplesFor('auto')).toBe(VOICE_SAMPLES.zh);
  });
});

describe('row order helpers', () => {
  const rows = [emo('a', 'A'), emo('b', 'B'), emo('c', 'C')];

  it('selects the next row after a delete, or the previous one at the end', () => {
    expect(selectAfterDelete(rows, 'a')).toBe('b');
    expect(selectAfterDelete(rows, 'c')).toBe('b');
    expect(selectAfterDelete([rows[0]], 'a')).toBeNull();
    expect(selectAfterDelete(rows, 'zz')).toBe('a');
  });

  it('moves one id to the front (= becomes the default emotion)', () => {
    expect(moveToFront(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(moveToFront(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(moveToFront(['a', 'b'], 'zz')).toEqual(['a', 'b']);
  });
});
