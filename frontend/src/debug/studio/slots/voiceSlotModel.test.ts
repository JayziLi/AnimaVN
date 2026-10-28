import { describe, expect, it } from 'vitest';
import type { TtsConnection, VoiceProfile } from '../../lib/api';
import { bindAdd, bindRemove, soloVoice, voiceOptions } from './voiceSlotModel';

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

describe('voiceOptions', () => {
  it('lists every voice in library order, nobody split into hers / others', () => {
    const profiles = [voice('p', '派蒙'), voice('kz', '刻晴(中文)'), voice('x', '星绘')];
    expect(voiceOptions(profiles, connections).map((o) => [o.id, o.name])).toEqual([
      ['p', '派蒙'],
      ['kz', '刻晴(中文)'],
      ['x', '星绘'],
    ]);
    expect(voiceOptions([], connections)).toEqual([]);
  });

  it('writes engine · connection · emotion count under each name', () => {
    const list = voiceOptions([voice('a', '刻晴', 'pc', 12), voice('b', '星绘', 'idx', 0)], connections);
    expect(list.map((o) => o.sub)).toEqual(['GPT-SoVITS · 台式机 · 12 种情绪', 'IndexTTS-2.5 · 台式机 IndexTTS · 0 种情绪']);
  });

  it('does not repeat the connection name when it is just the engine name', () => {
    expect(voiceOptions([voice('a', '刻晴', 'gsv')], connections)[0].sub).toBe('GPT-SoVITS · 3 种情绪');
    expect(voiceOptions([voice('a', '刻晴', 'box')], [conn('box', '5090 · GPT-SoVITS')])[0].sub).toBe(
      '5090 · GPT-SoVITS · 3 种情绪',
    );
  });

  it('skips the connection it cannot name', () => {
    expect(voiceOptions([voice('a', '刻晴', 'gone')], connections)[0].sub).toBe('3 种情绪');
  });
});

describe('bindAdd / bindRemove (still used by the web library bind dialog and by deleting a voice)', () => {
  it('makes the first voice the main one and later ones backups, never twice', () => {
    const one = bindAdd({ main: null, extras: [] }, 'a');
    expect(one).toEqual({ main: 'a', extras: [] });
    expect(bindAdd(one, 'b')).toEqual({ main: 'a', extras: ['b'] });
    const b = { main: 'a', extras: ['b'] };
    expect(bindAdd(b, 'a')).toBe(b);
    expect(bindAdd(b, 'b')).toBe(b);
  });

  it('removing the main voice leaves the backups alone (nobody gets promoted behind your back)', () => {
    expect(bindRemove({ main: 'a', extras: ['b', 'c'] }, 'a')).toEqual({ main: null, extras: ['b', 'c'] });
    expect(bindRemove({ main: 'a', extras: ['b', 'c'] }, 'b')).toEqual({ main: 'a', extras: ['c'] });
  });
});

describe('soloVoice', () => {
  it('replaces the whole binding: one voice, no backups; null means no voice', () => {
    expect(soloVoice('a')).toEqual({ main: 'a', extras: [] });
    expect(soloVoice(null)).toEqual({ main: null, extras: [] });
  });
});
