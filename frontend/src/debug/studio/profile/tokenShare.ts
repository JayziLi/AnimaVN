import type { BudgetReport, PartTokens, PromptPart } from '../../lib/assembler';
import { formatTokens } from '../../lib/tokens';

/**
 * 资料页右栏的「Token 分布」和「上下文预算」要算的东西。
 * 数据是下一次请求的组装结果里那份 BudgetReport(左栏预算条、原来抽屉的竖条读的同一份)。
 */

/** 横条和图例的顺序、叫法(照 V4CardInfo.png) */
export const TOKEN_PARTS: readonly { key: PromptPart; name: string }[] = [
  { key: 'card', name: '角色卡' },
  { key: 'preset', name: '预设' },
  { key: 'worldInfo', name: '世界书' },
  { key: 'examples', name: '示例对话' },
  { key: 'history', name: '历史' },
  { key: 'persona', name: '玩家人设' },
];

export interface TokenSegment {
  key: PromptPart;
  name: string;
  tokens: number;
  /** 占合计的百分比(0–100);合计是 0 时都是 0 */
  pct: number;
}

/** 各部分占多少:图例每部分一行(0 也列),横条只画不是 0 的 */
export function tokenShare(parts: PartTokens): { total: number; segments: TokenSegment[] } {
  const total = TOKEN_PARTS.reduce((n, p) => n + parts[p.key], 0);
  return {
    total,
    segments: TOKEN_PARTS.map((p) => ({
      key: p.key,
      name: p.name,
      tokens: parts[p.key],
      pct: total > 0 ? (parts[p.key] / total) * 100 : 0,
    })),
  };
}

export interface BudgetUsage {
  /** 进度条填多少(0–100);不截断时是 null,不画条 */
  fill: number | null;
  /** 数字框右边那句:「用了 5% · 无截断」「用了 100% · 截掉 3 条」 */
  text: string;
  /** 要标红的那句;没有是 null */
  warn: string | null;
}

/** 预算用了多少、截没截(和左栏预算条同一个口径:固定开销 + 进了提示词的历史) */
export function budgetUsage(report: BudgetReport, budget: number | null): BudgetUsage {
  const used = report.fixedTokens + report.historyTokens;
  const warn = report.overflow
    ? '固定开销已超预算 —— 历史一条都放不下'
    : report.forcedLastMessage
      ? '最后一条消息单独就超预算'
      : null;
  if (budget === null || budget <= 0) {
    return { fill: null, text: `合计 ${formatTokens(used)} · 不截断`, warn };
  }
  const ratio = used / budget;
  const pct = ratio > 0 && ratio < 0.01 ? '<1%' : `${Math.round(ratio * 100)}%`;
  const cut = report.droppedCount > 0 ? `截掉 ${report.droppedCount} 条` : '无截断';
  return { fill: Math.min(100, ratio * 100), text: `用了 ${pct} · ${cut}`, warn };
}
