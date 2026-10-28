import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VN_SETTINGS,
  TITLE_STYLES,
  currentPaperTheme,
  loadVNSettings,
  normalizeTitleStyle,
  saveVNSettings,
  subscribePaperTheme,
} from './vnSettings';

/** 只有 getItem / setItem 的假 localStorage,放一份存着的设置 */
function stubStorage(saved: Record<string, unknown> | null) {
  const store = new Map<string, string>();
  if (saved) store.set('anima.vn.settings', JSON.stringify(saved));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('封面样式', () => {
  it('设置里只给选纸面和明亮', () => {
    expect(TITLE_STYLES.map((t) => t.value)).toEqual(['paper', 'bright']);
  });

  it('以前存的海报 / 电影换成纸面,认得的原样留着', () => {
    expect(normalizeTitleStyle('poster', 'bright')).toBe('paper');
    expect(normalizeTitleStyle('cinema', 'bright')).toBe('paper');
    expect(normalizeTitleStyle('bright', 'paper')).toBe('bright');
    expect(normalizeTitleStyle('paper', 'bright')).toBe('paper');
    expect(normalizeTitleStyle('???', 'bright')).toBe('bright');
    expect(normalizeTitleStyle(undefined, 'paper')).toBe('paper');
  });

  it('读设置时旧值自动换成纸面', () => {
    stubStorage({ boxSkin: 'glass-dark', titleStyle: 'cinema' });
    expect(loadVNSettings().titleStyle).toBe('paper');
    stubStorage({ boxSkin: 'glass-dark', titleStyle: 'poster' });
    expect(loadVNSettings().titleStyle).toBe('paper');
    stubStorage({ boxSkin: 'glass-dark', titleStyle: 'bright' });
    expect(loadVNSettings().titleStyle).toBe('bright');
  });

  it('什么都没存时用默认', () => {
    stubStorage(null);
    expect(loadVNSettings()).toEqual(DEFAULT_VN_SETTINGS);
  });

  it('对话框布局兼容旧设置,保留有效值并限制无效值', () => {
    stubStorage({});
    expect(loadVNSettings()).toMatchObject({ dialogueOffset: 0, dialogueHeight: 0 });
    stubStorage({ dialogueOffset: 48, dialogueHeight: 80 });
    expect(loadVNSettings()).toMatchObject({ dialogueOffset: 48, dialogueHeight: 80 });
    stubStorage({ dialogueOffset: -999, dialogueHeight: 999 });
    expect(loadVNSettings()).toMatchObject({ dialogueOffset: -40, dialogueHeight: 160 });
    stubStorage({ dialogueOffset: '48', dialogueHeight: null });
    expect(loadVNSettings()).toMatchObject({ dialogueOffset: 0, dialogueHeight: 0 });
  });
});

describe('主题和对话框画法', () => {
  it('默认:主题白、对话框细线', () => {
    expect(DEFAULT_VN_SETTINGS.theme).toBe('white');
    expect(DEFAULT_VN_SETTINGS.dlgStyle).toBe('line');
  });

  it('存着的值认得就留着,认不得回默认', () => {
    stubStorage({ theme: 'glass', dlgStyle: 'classic' });
    expect(loadVNSettings()).toMatchObject({ theme: 'glass', dlgStyle: 'classic' });
    stubStorage({ theme: 'black' });
    expect(loadVNSettings()).toMatchObject({ theme: 'black', dlgStyle: 'line' });
    stubStorage({ theme: 'purple', dlgStyle: 7 });
    expect(loadVNSettings()).toMatchObject({ theme: 'white', dlgStyle: 'line' });
  });

  it('存设置时通知订阅的人,currentPaperTheme 读到新值', () => {
    stubStorage(null);
    let n = 0;
    const off = subscribePaperTheme(() => n++);
    expect(currentPaperTheme()).toBe('white');
    saveVNSettings({ ...DEFAULT_VN_SETTINGS, theme: 'black' });
    expect(n).toBe(1);
    expect(currentPaperTheme()).toBe('black');
    off();
    saveVNSettings({ ...DEFAULT_VN_SETTINGS, theme: 'glass' });
    expect(n).toBe(1);
    expect(currentPaperTheme()).toBe('glass');
  });

  it('localStorage 写不进去(隐私模式)时这次会话里照样生效', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    saveVNSettings({ ...DEFAULT_VN_SETTINGS, theme: 'glass' });
    expect(currentPaperTheme()).toBe('glass');
  });
});
