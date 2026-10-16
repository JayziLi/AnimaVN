import { describe, expect, it } from 'vitest';
import type { BudgetReport, PartTokens } from '../../lib/assembler';
import { TOKEN_PARTS, budgetUsage, tokenShare } from './tokenShare';

const parts = (over: Partial<PartTokens> = {}): PartTokens => ({
  preset: 0,
  card: 0,
  persona: 0,
  examples: 0,
  worldInfo: 0,
  history: 0,
  ...over,
});

const report = (over: Partial<BudgetReport> = {}): BudgetReport => ({
  limit: null,
  fixedTokens: 0,
  presetTokens: 0,
  cardTokens: 0,
  historyTokens: 0,
  parts: parts(),
  droppedCount: 0,
  droppedTokens: 0,
  overflow: false,
  forcedLastMessage: false,
  firstKeptHistoryIndex: null,
  ...over,
});

describe('Token 分布', () => {
  it('照图里的顺序列六部分,百分比按合计算', () => {
    const { total, segments } = tokenShare(
      parts({ card: 2912, preset: 1970, worldInfo: 1470, examples: 1363, history: 420, persona: 0 }),
    );
    expect(total).toBe(8135);
    expect(segments.map((s) => s.name)).toEqual(['角色卡', '预设', '世界书', '示例对话', '历史', '玩家人设']);
    expect(segments.map((s) => s.tokens)).toEqual([2912, 1970, 1470, 1363, 420, 0]);
    expect(segments[0].pct).toBeCloseTo((2912 / 8135) * 100);
    expect(segments.at(-1)!.pct).toBe(0);
    expect(segments.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100);
  });

  it('一个字都没有:合计 0,百分比都是 0(不除以 0)', () => {
    const { total, segments } = tokenShare(parts());
    expect(total).toBe(0);
    expect(segments.every((s) => s.pct === 0)).toBe(true);
    expect(segments).toHaveLength(TOKEN_PARTS.length);
  });
});

describe('上下文预算', () => {
  it('没截断:用了几成', () => {
    const u = budgetUsage(report({ fixedTokens: 7715, historyTokens: 420 }), 151845);
    expect(u.text).toBe('用了 5% · 无截断');
    expect(u.fill).toBeCloseTo((8135 / 151845) * 100);
    expect(u.warn).toBeNull();
  });

  it('截掉了几条;条不撑破 100', () => {
    const u = budgetUsage(report({ fixedTokens: 900, historyTokens: 200, droppedCount: 3 }), 1000);
    expect(u.text).toBe('用了 110% · 截掉 3 条');
    expect(u.fill).toBe(100);
  });

  it('用得很少时写「<1%」,不写 0%', () => {
    expect(budgetUsage(report({ fixedTokens: 10 }), 200000).text).toBe('用了 <1% · 无截断');
    expect(budgetUsage(report(), 200000).text).toBe('用了 0% · 无截断');
  });

  it('不截断:不画条,写合计', () => {
    const u = budgetUsage(report({ fixedTokens: 7715, historyTokens: 420 }), null);
    expect(u.fill).toBeNull();
    expect(u.text).toBe('合计 8.1k · 不截断');
  });

  it('固定开销超预算、最后一条单独超预算:给一句红字', () => {
    expect(budgetUsage(report({ overflow: true, forcedLastMessage: true }), 100).warn).toBe(
      '固定开销已超预算 —— 历史一条都放不下',
    );
    expect(budgetUsage(report({ forcedLastMessage: true }), 100).warn).toBe('最后一条消息单独就超预算');
  });
});
