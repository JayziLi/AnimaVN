import { describe, expect, it } from 'vitest';
import type { VoiceProfile } from '../lib/api';
import { mainVoiceChoices, switchMainVoice } from './voice';

describe('switchMainVoice', () => {
  it('keeps the old main voice as a backup instead of unbinding it', () => {
    expect(switchMainVoice({ main: 'ja', extras: ['other'] }, 'zh')).toEqual({ main: 'zh', extras: ['other', 'ja'] });
  });

  it('promotes a backup voice without listing it twice', () => {
    expect(switchMainVoice({ main: 'ja', extras: ['zh', 'other'] }, 'zh')).toEqual({ main: 'zh', extras: ['other', 'ja'] });
  });

  it('turning the voice off or picking the same one keeps nothing extra', () => {
    expect(switchMainVoice({ main: 'ja', extras: ['other'] }, null)).toEqual({ main: null, extras: ['other'] });
    expect(switchMainVoice({ main: 'ja', extras: [] }, 'ja')).toEqual({ main: 'ja', extras: [] });
    expect(switchMainVoice({ main: null, extras: ['other'] }, 'zh')).toEqual({ main: 'zh', extras: ['other'] });
  });
});

describe('mainVoiceChoices', () => {
  const voice = (id: string) => ({ id, name: id }) as VoiceProfile;
  const all = ['a', 'ja', 'b', 'zh', 'c'].map(voice);
  const ids = (xs: readonly VoiceProfile[]) => xs.map((p) => p.id);

  it("lists the card's own voices first, main before backups, then the rest in list order", () => {
    const { onCard, others } = mainVoiceChoices({ main: 'ja', extras: ['zh'] }, all);
    expect(ids(onCard)).toEqual(['ja', 'zh']);
    expect(ids(others)).toEqual(['a', 'b', 'c']);
  });

  it('skips bound voices that no longer exist and works without any binding', () => {
    expect(ids(mainVoiceChoices({ main: 'gone', extras: ['b'] }, all).onCard)).toEqual(['b']);
    const none = mainVoiceChoices(null, all);
    expect(ids(none.onCard)).toEqual([]);
    expect(ids(none.others)).toEqual(['a', 'ja', 'b', 'zh', 'c']);
  });
});
