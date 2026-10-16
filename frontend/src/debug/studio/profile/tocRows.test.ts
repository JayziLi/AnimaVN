import { describe, expect, it } from 'vitest';
import { assemble, type AssembledMessage, type AssemblyResult } from '../../lib/assembler';
import { EMPTY_CARD, type TavernCard } from '../../lib/cardParser';
import { buildPresetSkeleton, type PresetOrderEntry, type TavernPreset } from '../../lib/presetParser';
import { STATUS_NOTE, fieldStates } from './fieldStatus';
import { PERSONA_BLOCK, otherToc, personaState, presetToc, promptToc, shortLabel } from './tocRows';

const card = (over: Partial<TavernCard> = {}): TavernCard => ({
  ...EMPTY_CARD,
  name: '艾琳',
  description: '骑士团长',
  ...over,
});

const preset = (): TavernPreset => buildPresetSkeleton('测试');
const orderOf = (p: TavernPreset): PresetOrderEntry[] => p.orderGroups[0].order;

function result(messages: Partial<AssembledMessage>[] = []): AssemblyResult {
  return {
    messages: messages.map((m) => ({
      role: 'system',
      content: '',
      tokens: 0,
      sourceIdentifier: '',
      sourceName: '',
      sourceKind: 'marker',
      part: 'card',
      ...m,
    })),
    skipped: [],
    totalTokens: 0,
    danglingIdentifiers: [],
    budget: {
      limit: null,
      fixedTokens: 0,
      presetTokens: 0,
      cardTokens: 0,
      historyTokens: 0,
      parts: { preset: 0, card: 0, persona: 0, examples: 0, worldInfo: 0, history: 0 },
      droppedCount: 0,
      droppedTokens: 0,
      overflow: false,
      forcedLastMessage: false,
      firstKeptHistoryIndex: null,
    },
  };
}

function assembled(c: TavernCard, p: TavernPreset, persona: string, order = orderOf(p)): AssemblyResult {
  return assemble({
    card: c,
    preset: p,
    order,
    history: [],
    userName: '旅人',
    personaDescription: persona,
    allowCardOverrides: true,
    tokenBudget: null,
  });
}

describe('玩家人设的状态', () => {
  it('没选预设:unknown', () => {
    const s = personaState('旅行者', null, [], result());
    expect(s.status).toBe('unknown');
    expect(s.note).toBe(STATUS_NOTE.unknown);
  });

  it('描述是空的:empty', () => {
    const p = preset();
    expect(personaState('  ', p, orderOf(p), assembled(card(), p, '')).status).toBe('empty');
  });

  it('真组装一次:active,token 从结果里读,排序 = 编排里的位置', () => {
    const p = preset();
    const r = assembled(card(), p, '金发的旅行者');
    const s = personaState('金发的旅行者', p, orderOf(p), r);
    const msg = r.messages.find((m) => m.sourceIdentifier === PERSONA_BLOCK)!;
    expect(s.status).toBe('active');
    expect(s.tokens).toBe(msg.tokens);
    expect(s.tokens).toBeGreaterThan(0);
    expect(s.sortKey).toBe(orderOf(p).findIndex((e) => e.identifier === PERSONA_BLOCK));
    expect(s.note).toBe('');
  });

  it('块不在预设里 / 编排里关了 / 开着却没产出', () => {
    const p = preset();
    const gone = { ...p, prompts: p.prompts.filter((b) => b.identifier !== PERSONA_BLOCK) };
    expect(personaState('甲', gone, orderOf(p), result()).status).toBe('missing');
    const off = orderOf(p).map((e) => (e.identifier === PERSONA_BLOCK ? { ...e, enabled: false } : e));
    const s = personaState('甲', p, off, result());
    expect(s.status).toBe('disabled');
    expect(s.note).toBe(STATUS_NOTE.disabled);
    expect(personaState('甲', p, orderOf(p), result()).status).toBe('silent');
  });

  it('编排里没列人设块:按兜底排在情景之后、示例对话之前', () => {
    const p = preset();
    const order = orderOf(p).filter((e) => e.identifier !== PERSONA_BLOCK);
    expect(personaState('甲', p, order, result()).sortKey).toBe(103.5);
  });
});

describe('「进入提示词」那一组', () => {
  it('字段和人设按编排位置排,世界书殿后;右边是 token / 空 / 条数', () => {
    const p = preset();
    const c = card({ scenario: '王都' });
    const r = assembled(c, p, '旅行者');
    const rows = promptToc(
      fieldStates(c, p, orderOf(p), r),
      { ...personaState('旅行者', p, orderOf(p), r), name: 'Lj' },
      { placed: 3, total: 12 },
    );
    expect(rows.map((x) => x.key)).toEqual([
      'system_prompt',
      'description',
      'personality',
      'scenario',
      'persona',
      'mes_example',
      'post_history_instructions',
      'book',
    ]);
    const row = (k: string) => rows.find((x) => x.key === k)!;
    expect(row('system_prompt')).toEqual({ key: 'system_prompt', label: '主提示词覆盖', badge: '空', warn: false });
    expect(row('persona').label).toBe('玩家人设 · Lj');
    expect(row('persona').badge).toMatch(/^\d+$/);
    expect(row('book').badge).toBe('3/12');
  });

  it('编排换了顺序,人设跟着挪', () => {
    const p = preset();
    const order: PresetOrderEntry[] = [
      { identifier: PERSONA_BLOCK, enabled: true },
      { identifier: 'main', enabled: true },
      { identifier: 'charDescription', enabled: true },
    ];
    const rows = promptToc(fieldStates(card(), p, order, result()), { ...personaState('', p, order, result()), name: '' }, {
      placed: 0,
      total: 0,
    });
    expect(rows.slice(0, 3).map((x) => x.key)).toEqual(['persona', 'system_prompt', 'description']);
    expect(rows[0].label).toBe('玩家人设');
    expect(rows[0].badge).toBe('空');
    expect(rows.at(-1)).toEqual({ key: 'book', label: '世界书', badge: '空', warn: false });
  });

  it('填了也发不出去的标黄「!」', () => {
    const p = preset();
    const order = orderOf(p).map((e) =>
      e.identifier === 'scenario' || e.identifier === PERSONA_BLOCK ? { ...e, enabled: false } : e,
    );
    const c = card({ scenario: '王都' });
    const rows = promptToc(fieldStates(c, p, order, result()), { ...personaState('甲', p, order, result()), name: '甲' }, {
      placed: 0,
      total: 0,
    });
    expect(rows.find((x) => x.key === 'scenario')).toMatchObject({ badge: '!', warn: true });
    expect(rows.find((x) => x.key === 'persona')).toMatchObject({ badge: '!', warn: true });
  });
});

describe('另外两组', () => {
  it('不进提示词:开场白条数、注释、标签', () => {
    expect(otherToc(3).map((x) => [x.key, x.label, x.badge])).toEqual([
      ['greetings', '开场白', '3 条'],
      ['notes', '创作者注释', ''],
      ['meta', '标签 / 元数据', ''],
    ]);
  });

  it('预设:名字 + 开着几块 / 一共几块;没预设也有一行', () => {
    const order: PresetOrderEntry[] = [
      { identifier: 'a', enabled: true },
      { identifier: 'b', enabled: false },
      { identifier: 'c', enabled: true },
    ];
    expect(presetToc('刻晴 DeepSeek', order)).toEqual({ key: 'preset', label: '刻晴 DeepSeek', badge: '2/3', warn: false });
    expect(presetToc(null, [])).toEqual({ key: 'preset', label: '还没有预设', badge: '', warn: false });
  });

  it('目录里的字段名只留中文那半', () => {
    expect(shortLabel('角色描述 · Description')).toBe('角色描述');
    expect(shortLabel('世界书')).toBe('世界书');
  });
});
