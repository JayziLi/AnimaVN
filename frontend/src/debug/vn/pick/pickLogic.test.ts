import { describe, expect, it } from 'vitest';
import { boardScale, isPortrait } from './useBoxSize';
import { EMPTY_BIND, hasPlayed, lastLineText, matchCard, pickRows, sortCards } from './pickLogic';

describe('matchCard:搜索只认名字、作者,不认标签', () => {
  it('空搜索都显示', () => {
    expect(matchCard('星绘', 'AnimaVN', '')).toBe(true);
    expect(matchCard('星绘', undefined, '   ')).toBe(true);
  });
  it('名字、作者都能搜,不分大小写', () => {
    expect(matchCard('DeepSeek娘', undefined, 'deepseek')).toBe(true);
    expect(matchCard('星绘', 'AnimaVN(本地)', 'animavn')).toBe(true);
    expect(matchCard('星绘', 'AnimaVN', '刻晴')).toBe(false);
  });
});

describe('sortCards', () => {
  const rows = [
    { id: 'a', name: '乙', updatedAt: '2026-10-01T00:00:00' },
    { id: 'b', name: '甲', updatedAt: '2026-10-03T00:00:00' },
    { id: 'c', name: '丙', updatedAt: '2026-10-02T00:00:00' },
  ];
  it('最近:正在玩的排第一,其余按最近改动', () => {
    expect(sortCards(rows, 'recent', 'a').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortCards(rows, 'recent', null).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('名字:按拼音,不改原数组', () => {
    const out = sortCards(rows, 'name', 'a').map((r) => r.name);
    expect(out).toEqual([...out].sort((x, y) => x.localeCompare(y, 'zh')));
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('还没拉到卡内容(updatedAt 空)的排在后面', () => {
    const r = [{ id: 'x', name: 'x', updatedAt: '' }, ...rows];
    expect(sortCards(r, 'recent', null).map((c) => c.id)).toEqual(['b', 'c', 'a', 'x']);
  });
});

describe('pickRows:右边一条一条的素材', () => {
  it('没拉到绑定时只有立绘、场景两条,值是占位', () => {
    const rows = pickRows(undefined, 4);
    expect(rows.map((r) => r.kind)).toEqual(['sprite', 'scene']);
    expect(rows[0].v).toBe('4 张');
    expect(rows[1].v).toBe('没有场景包');
  });
  it('立绘包名 + 张数;场景包名 + 背景 / BGM / CG 张数(没有 CG 就不写)', () => {
    const rows = pickRows(
      { ...EMPTY_BIND, spritePack: '示例 · Sylvie', scene: { name: '示例场景', bg: 4, bgm: 1, cg: 0 } },
      14,
    );
    expect(rows[0].v).toBe('「示例 · Sylvie」· 14 张');
    expect(rows[1]).toMatchObject({ v: '「示例场景」', sub: '背景 4 · BGM 1' });
    const withCg = pickRows({ ...EMPTY_BIND, scene: { name: 'x', bg: 2, bgm: 0, cg: 3 } }, 1);
    expect(withCg[1].sub).toBe('背景 2 · BGM 0 · CG 3');
  });
  it('只有卡图(没立绘)写「没有立绘包」,声音、预设、人设有绑才出', () => {
    expect(pickRows(undefined, 0)[0]).toMatchObject({ v: '没有立绘包', sub: '用卡里带的那张图' });
    const rows = pickRows({ ...EMPTY_BIND, voice: '刻晴(日语)', preset: '爱丽丝 DeepSeek', persona: '前辈' }, 3);
    expect(rows.map((r) => r.kind)).toEqual(['sprite', 'scene', 'voice', 'preset', 'persona']);
    expect(rows.find((r) => r.kind === 'voice')?.v).toBe('刻晴(日语)');
  });
  it('不写作品名、不放台词:没有这样的行', () => {
    const rows = pickRows({ ...EMPTY_BIND, voice: 'v' }, 1);
    expect(rows.map((r) => r.k)).toEqual(['立绘', '场景', '声音']);
  });
});

describe('lastLineText:名字下面那一行,只写时间和条数', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  it('当前这位用游戏里的 lastPlayed,条数来自拉到的对话', () => {
    const line = lastLineText({
      isCurrent: true,
      hasLastChat: true,
      lastPlayed: ago(5 * 60000),
      bind: { ...EMPTY_BIND, lastChat: { at: ago(3600000), count: 12 } },
    });
    expect(line).toBe('上次 · 5 分钟前 · 12 条');
  });
  it('当前这位带上现在停在的场景(设计稿「上次 · 客厅 · 3 周前 · 11 条」);别人的不写场景', () => {
    const bind = { ...EMPTY_BIND, lastChat: { at: ago(3600000), count: 11 } };
    expect(lastLineText({ isCurrent: true, hasLastChat: true, lastPlayed: ago(5 * 60000), bind, scene: '客厅' })).toBe(
      '上次 · 客厅 · 5 分钟前 · 11 条',
    );
    expect(lastLineText({ isCurrent: false, hasLastChat: true, lastPlayed: null, bind, scene: '客厅' })).toBe('上次 · 1 小时前 · 11 条');
  });
  it('别人的用拉到的那段对话;拉不到条数就只写时间', () => {
    expect(lastLineText({ isCurrent: false, hasLastChat: true, lastPlayed: null, bind: { ...EMPTY_BIND, lastChat: { at: ago(2 * 3600000), count: 0 } } })).toBe(
      '上次 · 2 小时前',
    );
  });
  it('什么都没拉到:有对话写「有上次的对话」,没有写「还没开始」', () => {
    expect(lastLineText({ isCurrent: false, hasLastChat: true, lastPlayed: null, bind: undefined })).toBe('有上次的对话');
    expect(lastLineText({ isCurrent: false, hasLastChat: false, lastPlayed: null, bind: undefined })).toBe('还没开始');
  });
  it('hasPlayed:正在玩的、有上次对话的都写「继续」', () => {
    expect(hasPlayed(true, false)).toBe(true);
    expect(hasPlayed(false, true)).toBe(true);
    expect(hasPlayed(false, false)).toBe(false);
  });
});

describe('设计稿画板的缩放', () => {
  it('电脑 1440×810 就是 1;窗口小了按短边等比缩', () => {
    expect(boardScale({ w: 1440, h: 810 })).toBe(1);
    expect(boardScale({ w: 720, h: 405 })).toBe(0.5);
    // 窗口比 16:9 更扁:按高算,不会超出
    expect(boardScale({ w: 1920, h: 810 })).toBe(1);
  });
  it('手机竖屏 390×844 是 1,横竖屏按宽比高小判', () => {
    expect(isPortrait({ w: 390, h: 844 })).toBe(true);
    expect(isPortrait({ w: 1440, h: 810 })).toBe(false);
    expect(boardScale({ w: 390, h: 844 })).toBe(1);
    expect(boardScale({ w: 360, h: 800 })).toBeCloseTo(0.923, 3);
  });
});
