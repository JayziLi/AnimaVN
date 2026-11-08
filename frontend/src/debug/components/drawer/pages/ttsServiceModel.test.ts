import { describe, expect, it } from 'vitest';
import type { TtsConnection } from '../../../lib/api';
import {
  TYPE_LABEL,
  TYPE_ORDER,
  createBody,
  diffVoiceRows,
  formError,
  formFrom,
  hasPlugin,
  clearSecrets,
  isDirty,
  modelCountText,
  newForm,
  rowsDirty,
  rowsError,
  rowsFrom,
  routeText,
  sortModels,
  updateBody,
  voicesOn,
  withType,
  type VoiceRow,
} from './ttsServiceModel';

const conn: TtsConnection = {
  id: 'c1',
  name: '5090',
  api_type: 'gpt_sovits',
  base_url: 'http://10.0.0.2:9880',
  sample_steps: 32,
  emo_alpha: 1,
  profile_count: 0,
};

describe('routeText', () => {
  it('says how files travel for GSV', () => {
    expect(routeText({ route: 'same' }, true)).toBe('同一台电脑,声音文件不用传');
    expect(routeText({ route: 'none' }, true)).toBe('另一台电脑,没装小插件:导入的声音要手动放文件');
    expect(routeText({ route: 'plugin', pair_ok: true }, true)).toBe('另一台电脑,小插件已配对:导入的声音会自动送过去');
    expect(routeText({ route: 'plugin', pair_ok: false }, true)).toBe('另一台电脑,配对码没填或不对');
  });
  it('is silent for IndexTTS or when unknown', () => {
    expect(routeText({ route: 'same' }, false)).toBeNull();
    expect(routeText({ route: null }, true)).toBeNull();
    expect(routeText({}, true)).toBeNull();
  });
});

describe('voicesOn', () => {
  it('keeps the voices of one connection', () => {
    const ps = [{ connection_id: 'a' }, { connection_id: 'b' }, { connection_id: 'a' }];
    expect(voicesOn(ps, 'a')).toHaveLength(2);
    expect(voicesOn(ps, null)).toHaveLength(0);
  });
});

describe('form', () => {
  it('switches the default address with the type only while untouched', () => {
    const f = withType(newForm(), 'indextts');
    expect(f.base_url).toBe('http://127.0.0.1:9890');
    expect(withType({ ...newForm(), base_url: 'http://10.0.0.2:9880' }, 'indextts').base_url).toBe('http://10.0.0.2:9880');
    expect(withType({ ...newForm(), base_url: '' }, 'indextts').base_url).toBe('http://127.0.0.1:9890');
  });
  it('knows when it changed', () => {
    expect(isDirty(formFrom(conn), conn)).toBe(false);
    expect(isDirty({ ...formFrom(conn), name: 'x' }, conn)).toBe(true);
    expect(isDirty({ ...formFrom(conn), pair_code: '12345678' }, conn)).toBe(true);
    expect(isDirty(newForm(), null)).toBe(false);
    // 保存后配对码、key 清空,不再算没保存
    expect(isDirty(clearSecrets({ ...formFrom(conn), pair_code: '12345678', api_key: 'k' }), conn)).toBe(false);
  });
  it('checks fields', () => {
    expect(formError({ ...newForm(), name: '' })).toBe('名称不能空');
    expect(formError({ ...newForm(), name: 'a', sample_steps: '999' })).toBe('采样步数是 4 到 128 之间的整数');
    expect(formError({ ...newForm('indextts'), name: 'a', emo_alpha: '2' })).toBe('情绪强度在 0 到 1 之间');
    expect(formError({ ...newForm(), name: 'a' })).toBeNull();
  });
  it('sends only what changed, never an empty pair code', () => {
    expect(updateBody(formFrom(conn), conn)).toEqual({});
    expect(updateBody({ ...formFrom(conn), name: 'n', sample_steps: '64', pair_code: ' 12345678 ' }, conn)).toEqual({
      name: 'n',
      sample_steps: 64,
      pair_code: '12345678',
    });
    expect(updateBody({ ...formFrom(conn), api_type: 'indextts', emo_alpha: '0.5' }, conn)).toEqual({
      api_type: 'indextts',
      emo_alpha: 0.5,
    });
  });
  it('builds a create body per type', () => {
    expect(createBody({ ...newForm(), name: ' a ' })).toEqual({
      name: 'a',
      api_type: 'gpt_sovits',
      base_url: 'http://127.0.0.1:9880',
      sample_steps: 64,
    });
    expect(createBody({ ...newForm('indextts'), name: 'b' })).toMatchObject({ api_type: 'indextts', emo_alpha: 1 });
  });
});

describe('fish and relay', () => {
  it('has the type order and which types take a plugin', () => {
    expect(TYPE_ORDER.map((t) => TYPE_LABEL[t])).toEqual(['GPT-SoVITS', 'Fish Audio', 'IndexTTS-2.5', 'OpenAI 兼容']);
    expect([hasPlugin('gpt_sovits'), hasPlugin('indextts'), hasPlugin('fish'), hasPlugin('openai')]).toEqual([true, true, false, false]);
  });
  it('fish may leave the address empty; relay may borrow it', () => {
    expect(formError({ ...newForm('fish'), name: 'f' })).toBeNull();
    expect(formError({ ...newForm('openai'), name: 'r' })).toBe('地址不能空');
    expect(formError({ ...newForm('openai'), name: 'r', copy_from_llm: 'x' })).toBeNull();
  });
  it('switching type swaps untouched address and model defaults', () => {
    const f = withType(newForm('openai'), 'fish');
    expect([f.base_url, f.model]).toEqual(['', 'drama-3']);
    expect(withType({ ...newForm('openai'), model: 'my-tts' }, 'fish').model).toBe('my-tts');
  });
  it('create body carries key, model and the borrowed connection', () => {
    expect(createBody({ ...newForm('fish'), name: 'f', api_key: ' k ' })).toEqual({
      name: 'f',
      api_type: 'fish',
      base_url: '',
      model: 'drama-3',
      api_key: 'k',
    });
    expect(createBody({ ...newForm('openai'), name: 'r', copy_from_llm: 'llm1', model: 'tts-1' })).toEqual({
      name: 'r',
      api_type: 'openai',
      base_url: '',
      model: 'tts-1',
      copy_from_llm: 'llm1',
    });
    // 配对码 GSV / IndexTTS 都带,云端不带
    expect(createBody({ ...newForm('indextts'), name: 'i', pair_code: '12345678' })).toMatchObject({ pair_code: '12345678' });
    expect(createBody({ ...newForm('fish'), name: 'f', pair_code: '12345678' })).not.toHaveProperty('pair_code');
  });
  it('update body sends the key only when typed', () => {
    const saved: TtsConnection = { ...conn, api_type: 'openai', base_url: 'https://r.test/v1', model: 'tts-1', has_api_key: true };
    expect(updateBody(formFrom(saved), saved)).toEqual({});
    expect(updateBody({ ...formFrom(saved), model: 'tts-2', api_key: ' new ' }, saved)).toEqual({ model: 'tts-2', api_key: 'new' });
    const idx: TtsConnection = { ...conn, api_type: 'indextts' };
    expect(updateBody({ ...formFrom(idx), pair_code: '12345678' }, idx)).toEqual({ pair_code: '12345678' });
  });
  it('puts speech models first and shows the count', () => {
    expect(sortModels(['gpt-4o', 'tts-1', 'claude', 'gpt-4o-mini-tts', 'whisper-audio'])).toEqual({
      speech: ['tts-1', 'gpt-4o-mini-tts', 'whisper-audio'],
      other: ['gpt-4o', 'claude'],
    });
    expect(modelCountText(12)).toBe('12 个模型');
    expect(modelCountText(null)).toBeNull();
  });
  it('turns voice rows into creates, updates and deletes', () => {
    const saved = rowsFrom([
      { id: 'a', name: 'alloy', text_lang: 'zh', params: { voice: 'alloy' } },
      { id: 'b', name: 'nova', text_lang: 'ja', params: { voice: 'nova' } },
      { id: 'c', name: 'echo', text_lang: 'zh', params: { voice: 'echo' } },
    ]);
    expect(saved[1]).toMatchObject({ id: 'b', name: 'nova', lang: 'ja' });
    expect(diffVoiceRows(saved, saved)).toEqual({ create: [], update: [], remove: [] });
    const draft: VoiceRow[] = [
      { ...saved[0], lang: 'ja' },
      { ...saved[1], name: 'nova2' },
      { id: null, name: ' shimmer ', lang: 'zh' },
      { id: null, name: '  ', lang: 'zh' },
    ];
    const d = diffVoiceRows(saved, draft);
    expect(d.create.map((r) => r.name.trim())).toEqual(['shimmer']);
    expect(d.update.map((r) => r.id)).toEqual(['a', 'b']);
    expect(d.remove).toEqual(['c']);
    expect(rowsDirty(saved, draft)).toBe(true);
    expect(rowsDirty(saved, [...saved, { id: null, name: '', lang: 'zh' }])).toBe(false);
  });
  it('rejects emptied or duplicate voice names', () => {
    expect(rowsError([{ id: 'a', name: ' ', lang: 'zh' }])).toBe('音色名不能空,不要的音色点右边的 × 删掉');
    expect(rowsError([{ id: null, name: 'Nova', lang: 'zh' }, { id: 'b', name: 'nova', lang: 'ja' }])).toBe('音色「nova」重复了');
    expect(rowsError([{ id: null, name: '', lang: 'zh' }])).toBeNull();
  });
});
