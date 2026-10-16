import { describe, expect, it } from 'vitest';
import type { TtsConnection, VoiceProfile } from '../../lib/api';
import { bindAdd, bindRemove, pickSelected, voiceChoices, voiceTabs } from './voiceSlotModel';

const conn = (id: string, name: string, api_type: TtsConnection['api_type'] = 'gpt_sovits'): TtsConnection => ({
  id,
  name,
  api_type,
  base_url: 'http://127.0.0.1:9880',
  sample_steps: 64,
  emo_alpha: 1,
  profile_count: 1,
});

const voice = (id: string, name: string, connection_id = 'pc', emotions = 3, card_count = 0): VoiceProfile => ({
  id,
  name,
  aliases: [],
  connection_id,
  gpt_weights: '',
  sovits_weights: '',
  ref_path: '',
  text_lang: 'zh',
  speed: 1,
  params: {},
  emotions: Array.from({ length: emotions }, (_, i) => ({
    id: `${id}-e${i}`,
    profile_id: id,
    label: `情绪${i}`,
    aliases: [],
    ref_path: '',
    prompt_text: '',
    aux_refs: [],
    emo_vector: null,
    sort: i,
  })),
  card_count,
});

const connections = [conn('pc', '台式机'), conn('gsv', 'GPT-SoVITS'), conn('idx', '台式机 IndexTTS', 'indextts')];

describe('voiceTabs', () => {
  it('puts the main voice first and the backups after it, in binding order', () => {
    const profiles = [voice('a', '刻晴(中文)'), voice('b', '刻晴(日语)'), voice('c', '派蒙')];
    const tabs = voiceTabs({ main: 'b', extras: ['c', 'a'] }, profiles, connections);
    expect(tabs.map((t) => [t.id, t.name, t.main])).toEqual([
      ['b', '刻晴(日语)', true],
      ['c', '派蒙', false],
      ['a', '刻晴(中文)', false],
    ]);
  });

  it('writes engine · connection · role under each name', () => {
    const profiles = [voice('a', '刻晴(中文)'), voice('b', '刻晴', 'idx')];
    const tabs = voiceTabs({ main: 'a', extras: ['b'] }, profiles, connections);
    expect(tabs.map((t) => t.sub)).toEqual(['GPT-SoVITS · 台式机 · 主声音', 'IndexTTS-2.5 · 台式机 IndexTTS · 备用']);
  });

  it('does not repeat the connection name when it is just the engine name', () => {
    const tabs = voiceTabs({ main: 'a', extras: [] }, [voice('a', '刻晴', 'gsv')], connections);
    expect(tabs[0].sub).toBe('GPT-SoVITS · 主声音');
  });

  it('writes only the connection name when it already says the engine', () => {
    const named = [conn('box', '5090 · GPT-SoVITS')];
    const tabs = voiceTabs({ main: 'a', extras: [] }, [voice('a', '刻晴', 'box')], named);
    expect(tabs[0].sub).toBe('5090 · GPT-SoVITS · 主声音');
  });

  it('keeps a tab for a voice the list has not loaded yet, and skips the connection it cannot name', () => {
    const tabs = voiceTabs({ main: 'x', extras: ['a'] }, [voice('a', '刻晴', 'gone')], connections);
    expect(tabs.map((t) => [t.name, t.sub])).toEqual([
      ['…', '主声音'],
      ['刻晴', '备用'],
    ]);
  });

  it('lists only backups when there is no main voice', () => {
    expect(voiceTabs({ main: null, extras: ['a'] }, [voice('a', '派蒙')], connections).map((t) => t.main)).toEqual([
      false,
    ]);
    expect(voiceTabs({ main: null, extras: [] }, [], connections)).toEqual([]);
  });
});

describe('bindAdd / bindRemove', () => {
  it('makes the first voice the main one and later ones backups', () => {
    const one = bindAdd({ main: null, extras: [] }, 'a');
    expect(one).toEqual({ main: 'a', extras: [] });
    expect(bindAdd(one, 'b')).toEqual({ main: 'a', extras: ['b'] });
  });

  it('does not add a voice twice', () => {
    const b = { main: 'a', extras: ['b'] };
    expect(bindAdd(b, 'a')).toEqual(b);
    expect(bindAdd(b, 'b')).toEqual(b);
  });

  it('removing the main voice leaves the backups alone (nobody gets promoted behind your back)', () => {
    expect(bindRemove({ main: 'a', extras: ['b', 'c'] }, 'a')).toEqual({ main: null, extras: ['b', 'c'] });
    expect(bindRemove({ main: 'a', extras: ['b', 'c'] }, 'b')).toEqual({ main: 'a', extras: ['c'] });
    expect(bindRemove({ main: 'a', extras: [] }, 'zz')).toEqual({ main: 'a', extras: [] });
  });
});

describe('pickSelected', () => {
  const tabs = voiceTabs({ main: 'a', extras: ['b'] }, [voice('a', 'A'), voice('b', 'B')], connections);
  it('keeps the wanted tab while it is still bound, otherwise falls back to the first', () => {
    expect(pickSelected(tabs, 'b')).toBe('b');
    expect(pickSelected(tabs, 'gone')).toBe('a');
    expect(pickSelected(tabs, null)).toBe('a');
    expect(pickSelected([], 'a')).toBeNull();
  });
});

describe('voiceChoices', () => {
  const profiles = [
    voice('p', '派蒙', 'pc', 4, 3),
    voice('kz', '刻晴(中文)', 'pc', 12, 1),
    voice('kj', '刻晴(日语)', 'gsv', 10, 0),
    voice('x', '星绘', 'idx', 0, 2),
  ];

  it('puts voices named like the card first, bound ones last', () => {
    const list = voiceChoices(profiles, connections, { main: 'kz', extras: [] }, '刻晴');
    expect(list.map((c) => [c.id, c.near, c.bound])).toEqual([
      ['kj', true, null],
      ['p', false, null],
      ['x', false, null],
      ['kz', true, 'main'],
    ]);
  });

  it('matches names both ways and ignores brackets and spaces', () => {
    const list = voiceChoices([voice('w', '爱弥斯(日语)'), voice('d', 'DeepSeek 娘')], connections, { main: null, extras: [] }, '爱弥斯 B');
    expect(list.find((c) => c.id === 'w')?.near).toBe(true);
    expect(voiceChoices([voice('d', 'DeepSeek 娘')], connections, { main: null, extras: [] }, 'DeepSeek娘·日语')[0].near).toBe(
      true,
    );
    expect(voiceChoices([voice('d', '派蒙')], connections, { main: null, extras: [] }, '')[0].near).toBe(false);
  });

  it('describes engine, connection, emotion count and how many cards use it', () => {
    const list = voiceChoices(profiles, connections, { main: null, extras: ['p'] }, '');
    const sub = Object.fromEntries(list.map((c) => [c.id, c.sub]));
    expect(sub.kz).toBe('GPT-SoVITS · 台式机 · 12 种情绪 · 被 1 张卡用');
    expect(sub.kj).toBe('GPT-SoVITS · 10 种情绪 · 没有卡在用');
    expect(sub.x).toBe('IndexTTS-2.5 · 台式机 IndexTTS · 0 种情绪 · 被 2 张卡用');
    expect(list.find((c) => c.id === 'p')?.bound).toBe('extra');
  });
});
