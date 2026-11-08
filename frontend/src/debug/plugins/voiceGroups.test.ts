import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_CONFIG, effectiveMainId, groupTitle, groupVoices, normalizeVoiceConfig, voidChoiceText } from './voice';

const v = (id: string, connection_id: string) => ({ id, connection_id });

describe('groupVoices', () => {
  it('splits voices by connection in list order', () => {
    const g = groupVoices([v('a', 'c2'), v('b', 'c1'), v('c', 'c2')], [
      { id: 'c1', name: '本机' },
      { id: 'c2', name: '5090' },
    ]);
    expect(g.map((x) => [x.name, x.voices.map((y) => y.id)])).toEqual([
      ['本机', ['b']],
      ['5090', ['a', 'c']],
    ]);
  });
  it('drops connections with no voices', () => {
    const g = groupVoices([v('a', 'c1')], [
      { id: 'c1', name: '本机' },
      { id: 'c2', name: '空的' },
    ]);
    expect(g).toHaveLength(1);
  });
  it('puts voices of a deleted connection in a last group', () => {
    const g = groupVoices([v('a', 'gone'), v('b', 'c1')], [{ id: 'c1', name: '本机' }]);
    expect(g.map((x) => x.name)).toEqual(['本机', '找不到语音服务']);
    expect(g[1].voices[0].id).toBe('a');
  });
});

describe('default voice', () => {
  it('config defaults to none and keeps a string id', () => {
    expect(DEFAULT_VOICE_CONFIG.defaultVoiceId).toBeNull();
    expect(normalizeVoiceConfig({}).defaultVoiceId).toBeNull();
    expect(normalizeVoiceConfig({ defaultVoiceId: 'x' }).defaultVoiceId).toBe('x');
    expect(normalizeVoiceConfig({ defaultVoiceId: 5 }).defaultVoiceId).toBeNull();
    expect(normalizeVoiceConfig({ defaultVoiceId: '' }).defaultVoiceId).toBeNull();
  });
  it('the card own binding wins over the default', () => {
    expect(effectiveMainId('mine', 'def')).toBe('mine');
    expect(effectiveMainId(null, 'def')).toBe('def');
    expect(effectiveMainId(null, null)).toBeNull();
  });
  it('void choice text', () => {
    expect(voidChoiceText(null)).toBe('不念');
    expect(voidChoiceText('凯露')).toBe('默认(凯露)');
  });
});

describe('groupTitle', () => {
  it('adds the engine unless the name already has it', () => {
    expect(groupTitle('5090', 'gpt_sovits')).toBe('5090 · GPT-SoVITS');
    expect(groupTitle('5090 · GPT-SoVITS', 'gpt_sovits')).toBe('5090 · GPT-SoVITS');
    expect(groupTitle('找不到语音服务')).toBe('找不到语音服务');
  });
});
