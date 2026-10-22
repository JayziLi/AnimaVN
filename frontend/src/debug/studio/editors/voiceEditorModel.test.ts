import { describe, expect, it } from 'vitest';
import type { VoiceEmotion, VoiceProfile } from '../../lib/api';
import { BUILTIN_EMOTIONS } from '../../plugins/emotions';
import { VOICE_SAMPLES } from '../../plugins/voice';
import {
  MORE_GSV_PARAMS,
  SEED_MAX,
  aliasesPatch,
  basename,
  benchBlocker,
  benchTuning,
  connectionOption,
  fmtSpeed,
  langName,
  langOptions,
  matchBadge,
  missingSettings,
  moreParamsSummary,
  paramDefault,
  parseSeed,
  moveToFront,
  newEmotionFrom,
  peaksOf,
  progressText,
  refPatch,
  rowText,
  samplesFor,
  selectAfterDelete,
  settingPatch,
  settingsSummary,
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

describe('voice settings', () => {
  const gsv = { ...profile([emo('a', '平静', { ref_path: 'D:/r/a.wav' })]), aliases: ['刻晴'] };
  const weighted = { ...gsv, gpt_weights: 'D:/m/keqing-e10.ckpt', sovits_weights: 'D:/m/keqing_e10_s230.pth' };

  it('turns one field into a patch, trimming names and unquoting paths', () => {
    expect(settingPatch(gsv, 'name', '  刻晴(日语) ')).toEqual({ name: '刻晴(日语)' });
    expect(settingPatch(gsv, 'gpt_weights', ' "D:/m/a.ckpt" ')).toEqual({ gpt_weights: 'D:/m/a.ckpt' });
    expect(settingPatch(gsv, 'connection_id', 'c2')).toEqual({ connection_id: 'c2' });
    expect(settingPatch(gsv, 'text_lang', 'ja')).toEqual({ text_lang: 'ja' });
    // 路径可以清空(换成别的引擎时不用了)
    expect(settingPatch(weighted, 'sovits_weights', '')).toEqual({ sovits_weights: '' });
  });

  it('saves nothing when a field did not change or a name would be empty', () => {
    expect(settingPatch(gsv, 'name', '刻晴(中文)')).toBeNull();
    expect(settingPatch(gsv, 'name', '   ')).toBeNull();
    expect(settingPatch(gsv, 'connection_id', '')).toBeNull();
    expect(settingPatch(gsv, 'text_lang', ' ')).toBeNull();
    expect(settingPatch(gsv, 'text_lang', 'zh')).toBeNull();
    expect(settingPatch(weighted, 'gpt_weights', '"D:/m/keqing-e10.ckpt"')).toBeNull();
  });

  it('cleans aliases the way the backend keeps them', () => {
    expect(aliasesPatch(gsv, ['刻晴', ' 玉衡星 ', '', '玉衡星', '刻晴(中文)'])).toEqual({ aliases: ['刻晴', '玉衡星'] });
    expect(aliasesPatch(gsv, ['刻晴'])).toBeNull();
    expect(aliasesPatch(gsv, [])).toEqual({ aliases: [] });
  });

  it('knows what a voice still needs before it can speak', () => {
    expect(missingSettings(gsv, false)).toEqual(['GPT 权重', 'SoVITS 权重']);
    expect(missingSettings({ ...gsv, gpt_weights: 'a.ckpt' }, false)).toEqual(['SoVITS 权重']);
    expect(missingSettings(weighted, false)).toEqual([]);
    expect(missingSettings(gsv, true)).toEqual(['音色参考']);
    expect(missingSettings({ ...gsv, ref_path: 'D:/r/spk.wav' }, true)).toEqual([]);
  });

  it('labels a TTS service without repeating the engine name', () => {
    expect(connectionOption({ id: 'c', name: '5090', api_type: 'gpt_sovits' })).toEqual({
      value: 'c',
      label: '5090',
      sub: 'GPT-SoVITS',
    });
    expect(connectionOption({ id: 'c', name: '5090 · GPT-SoVITS', api_type: 'gpt_sovits' })).toEqual({
      value: 'c',
      label: '5090 · GPT-SoVITS',
    });
    expect(connectionOption({ id: 'c', name: ' ', api_type: 'indextts' })).toEqual({ value: 'c', label: 'IndexTTS-2.5' });
  });

  it('sums the settings up in one line when collapsed', () => {
    const conn = { id: 'c', name: '5090', api_type: 'gpt_sovits' as const };
    expect(settingsSummary(weighted, conn, false)).toEqual({
      text: '5090 · GPT-SoVITS · 中文 · keqing-e10.ckpt · keqing_e10_s230.pth',
      warn: false,
    });
    expect(settingsSummary(gsv, conn, false)).toEqual({
      text: '5090 · GPT-SoVITS · 中文 · 还没填 GPT 权重、SoVITS 权重',
      warn: true,
    });
    expect(
      settingsSummary({ ...gsv, text_lang: 'ja', ref_path: 'D:/r/【平静】你好.wav' }, { ...conn, api_type: 'indextts' }, true),
    ).toEqual({ text: '5090 · IndexTTS-2.5 · 日语 · 【平静】你好.wav', warn: false });
    expect(settingsSummary(weighted, null, false)).toEqual({ text: '没选语音服务 · 中文', warn: true });
  });

  it('tells the bench why it cannot speak, pointing at the right place', () => {
    expect(benchBlocker(gsv, false)).toBe('「刻晴(中文)」还没填 GPT 权重、SoVITS 权重,念不了 · 在上面「声音设置」里填');
    expect(benchBlocker({ ...weighted, emotions: [] }, false)).toBe(
      '「刻晴(中文)」还没有参考音频,念不了 · 在下面「新增情绪」贴一段参考音频的路径',
    );
    expect(benchBlocker(weighted, false)).toBeNull();
    expect(benchBlocker({ ...gsv, emotions: [] }, true)).toBe('「刻晴(中文)」还没填音色参考,念不了 · 在上面「声音设置」里填');
    expect(benchBlocker({ ...gsv, ref_path: 'D:/r/spk.wav', emotions: [] }, true)).toBeNull();
  });
});

describe('voice language', () => {
  it('offers the languages the engine knows, by their names', () => {
    expect(langOptions('ja', false).map((l) => l.label)).toEqual(['中文', '日语', '英语', '粤语', '韩语', '自动(多语混合)']);
    expect(langOptions('zh', true).map((l) => l.value)).toEqual(['zh', 'ja', 'en']);
  });

  it('keeps a stored language the list does not know instead of changing it', () => {
    expect(langOptions('all_ja', false).at(-1)).toEqual({ value: 'all_ja', label: 'all_ja' });
    expect(langOptions('yue', true).at(-1)).toEqual({ value: 'yue', label: 'yue' });
  });

  it('names a language', () => {
    expect(langName('ja', false)).toBe('日语');
    expect(langName('auto', false)).toBe('自动(多语混合)');
    expect(langName('all_ja', false)).toBe('all_ja');
  });
});

describe('more parameters', () => {
  it('lists the GSV parameters the old bench had besides temperature, with its ranges and defaults', () => {
    expect(MORE_GSV_PARAMS.map((p) => [p.key, p.min, p.max, p.def])).toEqual([
      ['sample_steps', 8, 128, null],
      ['top_p', 0.05, 1, 1],
      ['top_k', 1, 100, 15],
      ['repetition_penalty', 1, 2, 1.35],
      ['fragment_interval', 0.05, 1, 0.3],
    ]);
    expect(paramDefault(MORE_GSV_PARAMS[0], 64)).toBe(64);
    expect(paramDefault(MORE_GSV_PARAMS[2], 64)).toBe(15);
  });

  it('sums up what was changed, in one line', () => {
    expect(moreParamsSummary({})).toBe('');
    expect(moreParamsSummary({ temperature: 0.7, text_split_method: 'cut0' })).toBe('');
    expect(moreParamsSummary({ sample_steps: 32, top_k: 10, fragment_interval: 0.5, parallel_infer: false })).toBe(
      '采样步数 32 · top_k 10 · 句间停顿 0.5 秒 · 关并行推理',
    );
    expect(moreParamsSummary({ parallel_infer: true })).toBe('');
  });

  it('reads a fixed seed: empty is random, anything but a whole number in range is bad', () => {
    expect(parseSeed('  ')).toEqual({ seed: null, bad: false });
    expect(parseSeed(' 1234 ')).toEqual({ seed: 1234, bad: false });
    expect(parseSeed('0')).toEqual({ seed: 0, bad: false });
    expect(parseSeed(String(SEED_MAX))).toEqual({ seed: SEED_MAX, bad: false });
    for (const t of [String(SEED_MAX + 1), '-1', '1.5', '1e3', 'abc']) expect(parseSeed(t)).toEqual({ seed: null, bad: true });
  });

  it('sends a tuning only with a fixed seed, carrying what the voice has saved', () => {
    const p = { speed: 1.1, text_lang: 'ja', params: { top_k: 10 } };
    expect(benchTuning(p, null, false)).toBeUndefined();
    expect(benchTuning(p, 7, true)).toBeUndefined();
    expect(benchTuning(p, 7, false)).toEqual({ speed: 1.1, text_lang: 'ja', params: { top_k: 10 }, seed: 7 });
  });
});
