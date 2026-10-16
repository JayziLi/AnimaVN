import { describe, expect, it } from 'vitest';
import { switchMainVoice } from './voice';

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
