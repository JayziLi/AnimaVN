import { describe, expect, it } from 'vitest';
import { assemble, type AssembledMessage, type AssemblyResult, type SkippedBlock } from '../../lib/assembler';
import { EMPTY_CARD, type TavernCard } from '../../lib/cardParser';
import { PROMPT_FIELDS } from '../../lib/cardFields';
import { buildPresetSkeleton, type PresetOrderEntry, type TavernPreset } from '../../lib/presetParser';
import {
  STATUS_NOTE,
  blockedNote,
  fieldStates,
  isUnsent,
  seqLabel,
  silentNote,
  tocBadge,
  tocOrder,
  type FieldState,
  type FieldStatus,
} from './fieldStatus';

const card = (over: Partial<TavernCard> = {}): TavernCard => ({
  ...EMPTY_CARD,
  name: '艾琳',
  description: '骑士团长',
  ...over,
});

const preset = (): TavernPreset => buildPresetSkeleton('测试');
const orderOf = (p: TavernPreset): PresetOrderEntry[] => p.orderGroups[0].order;

/** 手搭一份组装结果:只关心 messages 和 skipped,预算随便填 */
function result(messages: Partial<AssembledMessage>[] = [], skipped: SkippedBlock[] = []): AssemblyResult {
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
    skipped,
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

/** 真组装一次:和抽屉里看到的是同一条链路 */
function assembled(c: TavernCard, p: TavernPreset, allowCardOverrides = true): AssemblyResult {
  return assemble({
    card: c,
    preset: p,
    order: orderOf(p),
    history: [{ role: 'user', content: '你好' }],
    userName: '旅人',
    personaDescription: '',
    allowCardOverrides,
    tokenBudget: null,
  });
}

const byKey = (states: FieldState[], key: string): FieldState => {
  const f = states.find((s) => s.def.key === key);
  if (!f) throw new Error(`没有字段 ${key}`);
  return f;
};

const statusOf = (states: FieldState[], key: string): FieldStatus => byKey(states, key).status;

describe('字段状态', () => {
  it('没选预设:每个字段都是 unknown,空的也一样', () => {
    const states = fieldStates(card(), null, [], result());
    expect(states.map((s) => s.status)).toEqual(PROMPT_FIELDS.map(() => 'unknown'));
    expect(byKey(states, 'description').note).toBe(STATUS_NOTE.unknown);
  });

  it('字段是空的(只有空白也算):empty,不给提示', () => {
    const p = preset();
    const states = fieldStates(card({ scenario: '  \n ' }), p, orderOf(p), assembled(card(), p));
    const f = byKey(states, 'scenario');
    expect(f.status).toBe('empty');
    expect(f.note).toBe('');
    expect(f.seq).toBeNull();
  });

  it('预设里压根没这一块:missing', () => {
    const p = preset();
    p.prompts = p.prompts.filter((b) => b.identifier !== 'charPersonality');
    const c = card({ personality: '冷静' });
    const f = byKey(fieldStates(c, p, orderOf(p), result()), 'personality');
    expect(f.status).toBe('missing');
    expect(f.note).toBe(STATUS_NOTE.missing);
  });

  it('编排里关了,或者编排里根本没列:disabled', () => {
    const p = preset();
    const order = orderOf(p)
      .filter((e) => e.identifier !== 'scenario')
      .map((e) => (e.identifier === 'charPersonality' ? { ...e, enabled: false } : e));
    const c = card({ personality: '冷静', scenario: '王都' });
    const states = fieldStates(c, p, order, result());
    expect(statusOf(states, 'personality')).toBe('disabled');
    expect(statusOf(states, 'scenario')).toBe('disabled');
    expect(byKey(states, 'personality').note).toBe(STATUS_NOTE.disabled);
  });

  it('覆盖字段遇上 forbidOverrides:forbidden;标记位字段不受影响', () => {
    const p = preset();
    for (const b of p.prompts) {
      if (b.identifier === 'main' || b.identifier === 'charDescription') b.forbidOverrides = true;
    }
    const c = card({ system_prompt: '你是艾琳' });
    const states = fieldStates(c, p, orderOf(p), assembled(c, p));
    expect(statusOf(states, 'system_prompt')).toBe('forbidden');
    expect(byKey(states, 'system_prompt').note).toBe(STATUS_NOTE.forbidden);
    expect(statusOf(states, 'description')).toBe('active');
  });

  it('result.messages 里有它的消息:active,序号、token、预览都从那里读', () => {
    const p = preset();
    const c = card();
    const r = assembled(c, p);
    const f = byKey(fieldStates(c, p, orderOf(p), r), 'description');
    const i = r.messages.findIndex((m) => m.sourceIdentifier === 'charDescription');
    expect(f.status).toBe('active');
    expect(f.note).toBe('');
    expect(f.seq).toBe(i);
    expect(f.tokens).toBe(r.messages[i].tokens);
    expect(f.produced).toEqual([{ role: r.messages[i].role, content: '骑士团长' }]);
    expect(f.value).toBe('骑士团长');
  });

  it('一个字段产出好几条:序号取第一条,token 加起来', () => {
    const p = preset();
    const c = card({ mes_example: '<START>\n{{char}}: 甲' });
    const r = result([
      { sourceIdentifier: 'main', part: 'preset' },
      { sourceIdentifier: 'dialogueExamples', tokens: 3, content: 'a', role: 'system' },
      { sourceIdentifier: 'chatHistory', part: 'history' },
      { sourceIdentifier: 'dialogueExamples', tokens: 4, content: 'b', role: 'assistant' },
    ]);
    const f = byKey(fieldStates(c, p, orderOf(p), r), 'mes_example');
    expect(f.status).toBe('active');
    expect(f.seq).toBe(1);
    expect(f.tokens).toBe(7);
    expect(f.produced).toEqual([
      { role: 'system', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });

  it('覆盖字段:块用的是预设原文(part 不是 card)不算这个字段的产出', () => {
    const p = preset();
    p.prompts.find((b) => b.identifier === 'main')!.content = '预设的主提示词';
    const c = card({ system_prompt: '你是艾琳' });
    // 不许卡覆盖:main 照样发,但发的是预设原文
    const off = byKey(fieldStates(c, p, orderOf(p), assembled(c, p, false)), 'system_prompt');
    expect(off.status).toBe('silent');
    expect(off.seq).toBeNull();
    expect(off.tokens).toBe(0);
    // 许覆盖:发的是卡的字
    const on = byKey(fieldStates(c, p, orderOf(p), assembled(c, p, true)), 'system_prompt');
    expect(on.status).toBe('active');
    expect(on.produced.map((m) => m.content)).toEqual(['你是艾琳']);
  });

  it('块开着却没产出:silent,普通字段用通用说法', () => {
    const p = preset();
    const c = card({ scenario: '王都' });
    const f = byKey(fieldStates(c, p, orderOf(p), result()), 'scenario');
    expect(f.status).toBe('silent');
    expect(f.note).toBe(STATUS_NOTE.silent);
  });

  it('示例对话拆不出说话人:silent,说明里带卡名', () => {
    const p = preset();
    const c = card({ mes_example: '<START>\n随便写写' });
    const f = byKey(fieldStates(c, p, orderOf(p), assembled(c, p)), 'mes_example');
    expect(f.status).toBe('silent');
    expect(f.note).toBe(silentNote('dialogueExamples', result(), '艾琳'));
    expect(f.note).toContain('艾琳:');
  });
});

describe('silentNote', () => {
  it('示例对话被预算丢掉', () => {
    const r = result([], [{ identifier: 'dialogueExamples', name: '示例', reason: '超出 token 预算' }]);
    expect(silentNote('dialogueExamples', r, '艾琳')).toBe('上下文预算不够,示例对话整段被丢了 —— 这次不会发出去');
  });

  it('别的块没有细分', () => {
    const r = result([], [{ identifier: 'scenario', name: '情景', reason: '超出 token 预算' }]);
    expect(silentNote('scenario', r, '艾琳')).toBe(STATUS_NOTE.silent);
  });
});

describe('目录顺序', () => {
  it('按编排里的位置排', () => {
    const p = preset();
    const states = tocOrder(fieldStates(card(), p, orderOf(p), result()));
    expect(states.map((s) => s.def.key)).toEqual([
      'system_prompt',
      'description',
      'personality',
      'scenario',
      'mes_example',
      'post_history_instructions',
    ]);
    const idx = (id: string) => orderOf(p).findIndex((e) => e.identifier === id);
    expect(byKey(states, 'scenario').sortKey).toBe(idx('scenario'));
  });

  it('编排换了顺序,目录跟着换', () => {
    const p = preset();
    const order: PresetOrderEntry[] = [
      { identifier: 'jailbreak', enabled: true },
      { identifier: 'scenario', enabled: true },
      { identifier: 'charDescription', enabled: true },
      { identifier: 'main', enabled: true },
      { identifier: 'charPersonality', enabled: true },
      { identifier: 'dialogueExamples', enabled: true },
    ];
    const keys = tocOrder(fieldStates(card(), p, order, result())).map((s) => s.def.key);
    expect(keys).toEqual([
      'post_history_instructions',
      'scenario',
      'description',
      'system_prompt',
      'personality',
      'mes_example',
    ]);
  });

  it('编排里找不到的排到后面,彼此按 100 + fallback', () => {
    const p = preset();
    const order: PresetOrderEntry[] = [
      { identifier: 'scenario', enabled: true },
      { identifier: 'charPersonality', enabled: false },
    ];
    const states = tocOrder(fieldStates(card(), p, order, result()));
    expect(states.map((s) => s.def.key)).toEqual([
      'scenario',
      'personality',
      'system_prompt',
      'description',
      'mes_example',
      'post_history_instructions',
    ]);
    expect(byKey(states, 'description').sortKey).toBe(101);
    expect(byKey(states, 'post_history_instructions').sortKey).toBe(105);
  });

  it('没预设也有顺序(编排是空的,全走兜底)', () => {
    const keys = tocOrder(fieldStates(card(), null, [], result())).map((s) => s.def.key);
    expect(keys).toEqual(PROMPT_FIELDS.map((d) => d.key));
  });

  it('不改原数组', () => {
    const p = preset();
    const order: PresetOrderEntry[] = [{ identifier: 'jailbreak', enabled: true }];
    const states = fieldStates(card(), p, order, result());
    const before = states.map((s) => s.def.key);
    tocOrder(states);
    expect(states.map((s) => s.def.key)).toEqual(before);
  });
});

describe('空字段的预先提醒', () => {
  const def = (key: string) => PROMPT_FIELDS.find((d) => d.key === key)!;

  it('没选预设、或这块发得出去:不提醒', () => {
    const p = preset();
    expect(blockedNote(def('scenario'), null, [])).toBe('');
    expect(blockedNote(def('scenario'), p, orderOf(p))).toBe('');
  });

  it('预设里没这块 / 编排里关了或没列 / 覆盖不了:说清是哪种', () => {
    const p = preset();
    p.prompts = p.prompts.filter((b) => b.identifier !== 'charPersonality');
    expect(blockedNote(def('personality'), p, orderOf(p))).toBe(STATUS_NOTE.missing);
    const off = orderOf(p).map((e) => (e.identifier === 'main' ? { ...e, enabled: false } : e));
    expect(blockedNote(def('system_prompt'), p, off)).toBe(STATUS_NOTE.disabled);
    const unlisted = orderOf(p).filter((e) => e.identifier !== 'scenario');
    expect(blockedNote(def('scenario'), p, unlisted)).toBe(STATUS_NOTE.disabled);
    p.prompts.find((b) => b.identifier === 'main')!.forbidOverrides = true;
    expect(blockedNote(def('system_prompt'), p, orderOf(p))).toBe(STATUS_NOTE.forbidden);
  });

  it('标记位字段不管 forbidOverrides', () => {
    const p = preset();
    p.prompts.find((b) => b.identifier === 'charDescription')!.forbidOverrides = true;
    expect(blockedNote(def('description'), p, orderOf(p))).toBe('');
  });
});

describe('显示用的小工具', () => {
  it('序号补两位,没有就是横线', () => {
    expect(seqLabel(3)).toBe('#03');
    expect(seqLabel(0)).toBe('#00');
    expect(seqLabel(12)).toBe('#12');
    expect(seqLabel(null)).toBe('—');
  });

  it('哪些状态算「填了也发不出去」', () => {
    const unsent: FieldStatus[] = ['disabled', 'missing', 'forbidden', 'silent'];
    const all: FieldStatus[] = ['active', 'empty', 'disabled', 'missing', 'forbidden', 'silent', 'unknown'];
    expect(all.filter(isUnsent)).toEqual(unsent);
  });

  it('目录右边那一格:空 / token / !', () => {
    const p = preset();
    const r = assembled(card(), p);
    const states = fieldStates(card(), p, orderOf(p), r);
    expect(tocBadge(byKey(states, 'scenario'))).toBe('空');
    expect(tocBadge(byKey(states, 'description'))).toBe(String(byKey(states, 'description').tokens));
    const missing = fieldStates(card(), null, [], result());
    expect(tocBadge(byKey(missing, 'description'))).toBe('!');
  });
});
