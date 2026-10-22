import { describe, expect, it } from 'vitest';
import type { PresetOrderEntry, PresetPrompt, TavernPreset } from '../lib/presetParser';
import { jevLangPrompt, type JevKinds } from '../plugins/jev';
import { DEFAULT_LANG_BLOCK_PROMPT, LANG_BLOCK_ID } from '../plugins/lang';
import { BLOCK_OF, JEV_KINDS, PLUGIN_BLOCK_IDS } from '../plugins/registry';
import { vnTagKinds } from '../vn/tags';
import { autoInsertAt, moveToLastUserTurn, pluginAssemblyPass, type AutoFill } from './assembly';
import { legacyAssemblyPass } from './assemblyLegacy';

const VN_KINDS = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const PLAYER = 'anima_player';
const TAG_KINDS = ['sprite', 'bg', 'bgm', 'cg'] as const;

const oracle = (preset: TavernPreset | null, order: PresetOrderEntry[], jevKinds: JevKinds) =>
  legacyAssemblyPass(preset, order, jevKinds, VN_KINDS);

const block = (identifier: string, content = `${identifier} 的正文 <sprite:微笑>`): PresetPrompt => ({
  identifier,
  name: identifier,
  role: 'system',
  content,
  marker: false,
  systemPrompt: false,
  injectionPosition: 0,
  injectionDepth: 4,
  injectionOrder: 100,
  injectionTrigger: [],
  forbidOverrides: false,
});

/** 插件块每块三种情况:没有 / 有但关着 / 开着;外语块的正文是默认模板还是改过的 */
function presets(): { preset: TavernPreset; order: PresetOrderEntry[] }[] {
  const out: { preset: TavernPreset; order: PresetOrderEntry[] }[] = [];
  const ids = [...PLUGIN_BLOCK_IDS];
  // 3^n 太多:每块的情况由一个种子轮着取,覆盖每块每种情况和常见的搭配
  for (let seed = 0; seed < 3 ** 4 * 2; seed++) {
    let x = seed;
    const prompts: PresetPrompt[] = [block('main'), block('chatHistory')];
    const order: PresetOrderEntry[] = [
      { identifier: 'main', enabled: true },
      { identifier: 'chatHistory', enabled: true },
    ];
    ids.forEach((id, i) => {
      const state = (x + i) % 3;
      x = Math.floor(x / (i % 2 ? 2 : 3));
      if (state === 0) return;
      const content = id === LANG_BLOCK_ID && seed % 2 === 0 ? DEFAULT_LANG_BLOCK_PROMPT : undefined;
      prompts.push(block(id, content));
      order.push({ identifier: id, enabled: state === 2 });
    });
    out.push({
      preset: { name: `p${seed}`, prompts, orderGroups: [{ characterId: 100001, order }], formats: {} as never, params: {}, squashSystemMessages: false },
      order,
    });
  }
  return out;
}

const allModes = (): JevKinds[] =>
  Array.from({ length: 2 ** JEV_KINDS.length }, (_, m) =>
    Object.fromEntries(JEV_KINDS.map((k, i) => [k, Boolean(m & (1 << i))])) as JevKinds,
  );

const NONE = Object.fromEntries(JEV_KINDS.map((k) => [k, false])) as JevKinds;
const ALL_MATERIAL = { sprite: true, bg: true, bgm: true, cg: true };
const NO_SCENE = { sprite: true, bg: false, bgm: false, cg: false };
const BLOCKS = Object.fromEntries(
  [...PLUGIN_BLOCK_IDS].map((id) => [id, { identifier: id, name: `${id} 名`, content: `${id} 模板` }]),
);
/** 默认:开着自动补块、素材都有、没有主声音(外语块不发也不补) */
const fill = (o: Partial<AutoFill> = {}): AutoFill => ({
  enabled: true,
  configuredJev: NONE,
  material: ALL_MATERIAL,
  mainVoiceLang: null,
  blocks: BLOCKS,
  lastUserTurn: false,
  ...o,
});
/** 和以前「不传 autoFill」一样的情况:不补块、素材都有、主声音是日语(外语块照预设) */
const AS_BEFORE = fill({ enabled: false, mainVoiceLang: 'ja' });

/**
 * 搬家以前的写法,叠上第 2 步有意改的两条规则 —— 别的一样都不许变:
 * 1. 玩家块(P3 起是「别替玩家说话」)不受 Jev 影响:旧写法在 jevKinds.player 时把它关掉,现在照预设发。
 * 2. 外语块只在「这次一块标签块都没发」时换精简版,而且只看开着的外语块:旧写法要「有在用 Jev 的、开着的标签块全是
 *    Jev 的」,还把玩家块算成标签块、关着的外语块也换正文(反正不发)。
 */
function expected(preset: TavernPreset, order: PresetOrderEntry[], jevKinds: JevKinds) {
  const old = oracle(preset, order, jevKinds);
  const tagsSent = TAG_KINDS.some((k) => !jevKinds[k] && order.some((e) => e.enabled && e.identifier === BLOCK_OF[k]));
  const short = !tagsSent && order.some((e) => e.enabled && e.identifier === LANG_BLOCK_ID);
  return {
    preset: short
      ? { ...preset, prompts: preset.prompts.map((p) => (p.identifier === LANG_BLOCK_ID ? { ...p, content: jevLangPrompt(p.content, VN_KINDS) } : p)) }
      : preset,
    order: old.order.map((e, i) => (e.identifier === PLAYER ? order[i] : e)),
    stripKinds: old.stripKinds,
  };
}

describe('pluginAssemblyPass', () => {
  it('gives what DebugApp did before, apart from the two rules changed on purpose (every preset shape × every Jev mode)', () => {
    let cases = 0;
    let changed = 0;
    for (const { preset, order } of presets()) {
      for (const jevKinds of allModes()) {
        const got = pluginAssemblyPass({ preset, order, jevKinds, vnKinds: VN_KINDS, autoFill: AS_BEFORE });
        const want = expected(preset, order, jevKinds);
        expect({ preset: got.preset, order: got.order, stripKinds: got.stripKinds }).toEqual(want);
        expect([got.auto, got.lastUserTurn]).toEqual([[], []]);
        const old = oracle(preset, order, jevKinds);
        if (JSON.stringify(old) !== JSON.stringify(want)) changed++;
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(1000);
    // 两条改动真的碰到了(不是因为样本里没有才一样)
    expect(changed).toBeGreaterThan(100);
    // 穷举一千多种,机器忙时会超过默认的 5 秒
  }, 60_000);

  it('keeps the same arrays when there is nothing to change, so memos do not redo work', () => {
    const [{ preset, order }] = presets();
    const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill: AS_BEFORE });
    expect(got.order).toBe(order);
    expect(got.preset).toBe(preset);
    expect(got.stripKinds).toBeNull();
  });

  it('turns off Jev blocks and swaps the default language block for the tag-free one', () => {
    const preset: TavernPreset = {
      name: 'x',
      prompts: [block('chatHistory'), block('anima_sprite'), block(LANG_BLOCK_ID, DEFAULT_LANG_BLOCK_PROMPT)],
      orderGroups: [],
      formats: {} as never,
      params: {},
      squashSystemMessages: false,
    };
    const order = preset.prompts.map((p) => ({ identifier: p.identifier, enabled: true }));
    const got = pluginAssemblyPass({ preset, order, jevKinds: { ...NONE, sprite: true }, vnKinds: VN_KINDS, autoFill: AS_BEFORE });
    expect(got.order.find((o) => o.identifier === 'anima_sprite')?.enabled).toBe(false);
    expect(got.preset?.prompts.find((p) => p.identifier === LANG_BLOCK_ID)?.content).not.toBe(DEFAULT_LANG_BLOCK_PROMPT);
    expect(got.stripKinds?.map((k) => k.kind)).toEqual(['sprite']);
    expect(got.plan.map((b) => [b.identifier, b.state, b.reason])).toEqual([
      ['anima_sprite', 'skip', 'jev'],
      [LANG_BLOCK_ID, 'short', 'lang-trim'],
    ]);
  });
});

// ── 第 2 步新加的不发(core/sendPlan.ts)──

const presetOf = (prompts: PresetPrompt[], order: PresetOrderEntry[]): TavernPreset => ({
  name: 'x',
  prompts,
  orderGroups: [{ characterId: 100001, order }],
  formats: {} as never,
  params: {},
  squashSystemMessages: false,
});
const on = (identifier: string) => ({ identifier, enabled: true });
const off = (identifier: string) => ({ identifier, enabled: false });
const ids = (blocks: readonly { identifier: string }[]) => blocks.map((a) => a.identifier);

describe('pluginAssemblyPass skips what this card cannot use', () => {
  const prompts = [block('main'), block('chatHistory'), block('anima_sprite'), block('anima_cg'), block(LANG_BLOCK_ID)];
  const order = prompts.map((p) => on(p.identifier));
  const preset = presetOf(prompts, order);

  it('turns off a tag block when the card has nothing for it, but keeps its tags (only Jev and switches strip)', () => {
    const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill: fill({ enabled: false, material: NO_SCENE, mainVoiceLang: 'ja' }) });
    expect(got.order.find((o) => o.identifier === 'anima_cg')?.enabled).toBe(false);
    expect(got.order.find((o) => o.identifier === 'anima_sprite')?.enabled).toBe(true);
    expect(got.stripKinds).toBeNull();
  });

  it('turns off the language block without a Japanese main voice', () => {
    for (const lang of [null, 'zh']) {
      const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill: fill({ enabled: false, mainVoiceLang: lang }) });
      expect(got.order.find((o) => o.identifier === LANG_BLOCK_ID)?.enabled).toBe(false);
    }
  });
});

// ── 自动补块(设计稿 2.7)──

/** 一份只有这几块的预设,这次自动补了哪几块 */
const autoOf = (order: PresetOrderEntry[], jevKinds: JevKinds, o: AutoFill) =>
  ids(pluginAssemblyPass({ preset: presetOf(order.map((e) => block(e.identifier)), order), order, jevKinds, vnKinds: VN_KINDS, autoFill: o }).auto);

describe('auto-fill', () => {
  const order = [on('main'), on('chatHistory')];

  it('fills an AI-mode kind that has material and no block at all in the order', () => {
    // 第 2 步起「别替玩家说话」块也补(以前玩家台词块只有预设里放了才有)
    expect(autoOf(order, NONE, fill())).toEqual(['anima_sprite', 'anima_bg', 'anima_bgm', 'anima_cg', PLAYER]);
  });

  it('does not fill a block that is there but turned off, a Jev-mode kind, or a kind without material', () => {
    expect(autoOf([...order, off('anima_sprite')], NONE, fill())).not.toContain('anima_sprite');
    expect(autoOf(order, { ...NONE, bg: true }, fill())).not.toContain('anima_bg');
    expect(autoOf(order, NONE, fill({ material: { ...ALL_MATERIAL, cg: false } }))).not.toContain('anima_cg');
    expect(autoOf(order, NONE, fill({ enabled: false }))).toEqual([]);
  });

  it('says it is a temporary fill when Jev was chosen but has no key', () => {
    const got = pluginAssemblyPass({
      preset: presetOf([block('main')], order),
      order,
      jevKinds: NONE,
      vnKinds: VN_KINDS,
      autoFill: fill({ configuredJev: { ...NONE, sprite: true } }),
    });
    expect(got.auto.find((a) => a.identifier === 'anima_sprite')?.reason).toBe('no-key');
    expect(got.auto.find((a) => a.identifier === 'anima_bg')?.reason).toBe('ai');
  });

  it('fills the language block for a Japanese main voice only (the per-card switch is gone), and always the player block', () => {
    // 第 2 步:外语块跟着主声音的语言走,不再看按卡的「预设缺外语块时补上」
    expect(autoOf(order, NONE, fill())).not.toContain(LANG_BLOCK_ID);
    expect(autoOf(order, NONE, fill({ mainVoiceLang: 'zh' }))).not.toContain(LANG_BLOCK_ID);
    expect(autoOf(order, NONE, fill({ mainVoiceLang: 'ja' }))).toContain(LANG_BLOCK_ID);
    expect(autoOf(order, NONE, fill({ mainVoiceLang: 'ja' }))).toContain(PLAYER);
  });

  it('fills the short language block when no tag block goes out', () => {
    const allJev = { ...NONE, sprite: true, bg: true, bgm: true, cg: true };
    const got = pluginAssemblyPass({
      preset: presetOf([block('main'), block('chatHistory')], order),
      order,
      jevKinds: allJev,
      vnKinds: VN_KINDS,
      autoFill: fill({ mainVoiceLang: 'ja', blocks: { ...BLOCKS, [LANG_BLOCK_ID]: { identifier: LANG_BLOCK_ID, name: '外语', content: DEFAULT_LANG_BLOCK_PROMPT } } }),
    });
    expect(ids(got.auto)).toEqual([LANG_BLOCK_ID, PLAYER]);
    expect(got.preset?.prompts.find((p) => p.identifier === LANG_BLOCK_ID)?.content).toBe(jevLangPrompt(DEFAULT_LANG_BLOCK_PROMPT, VN_KINDS));
  });
});

describe('autoInsertAt', () => {
  const sys = (id: string, extra: Partial<PresetPrompt> = {}) => ({ ...block(id), ...extra });

  it('goes right after the last plugin block when there is one', () => {
    const prompts = [sys('main'), sys('chatHistory'), sys('anima_lang'), sys('jailbreak')];
    expect(autoInsertAt(prompts, [on('main'), on('chatHistory'), on('anima_lang'), on('jailbreak')])).toBe(3);
  });

  it('else after chat history, past closing tags (comments stripped) and the turned-off blocks between them', () => {
    const prompts = [
      sys('main'),
      sys('chatHistory'),
      sys('off1'),
      sys('close', { name: '{{// 收尾 }} </history>', content: '{{// 注释 }}\n</history>' }),
      sys('jailbreak'),
    ];
    const order = [on('main'), on('chatHistory'), off('off1'), on('close'), on('jailbreak')];
    expect(autoInsertAt(prompts, order)).toBe(4);
  });

  it('else at the end; always before a trailing assistant prefill', () => {
    const prompts = [sys('main'), sys('prefill', { role: 'assistant' }), sys('chatHistory')];
    expect(autoInsertAt(prompts, [on('main')])).toBe(1);
    expect(autoInsertAt(prompts, [on('chatHistory'), on('prefill')])).toBe(1);
    expect(autoInsertAt(prompts, [on('chatHistory'), on('prefill'), off('main')])).toBe(1);
    // Anthropic 格式:放最后,但还在预填前面
    expect(autoInsertAt(prompts, [on('main'), on('chatHistory'), on('prefill')], true)).toBe(2);
  });
});

describe('pluginAssemblyPass with auto-fill', () => {
  const prompts = [block('main'), block('chatHistory'), block('jailbreak')];
  const order = [on('main'), on('chatHistory'), on('jailbreak')];
  const preset = presetOf(prompts, order);

  it('adds the missing blocks for this assembly only (the preset passed in is untouched)', () => {
    const autoFill = fill({ material: NO_SCENE });
    const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill });
    // 第 2 步起「别替玩家说话」块也补
    expect(got.auto).toEqual([
      { identifier: 'anima_sprite', name: 'anima_sprite 名', reason: 'ai' },
      { identifier: PLAYER, name: `${PLAYER} 名`, reason: 'ai' },
    ]);
    expect(ids(got.order)).toEqual(['main', 'chatHistory', 'anima_sprite', PLAYER, 'jailbreak']);
    const added = got.preset?.prompts.find((p) => p.identifier === 'anima_sprite');
    expect(added).toMatchObject({ role: 'system', content: 'anima_sprite 模板' });
    expect(preset.prompts).toHaveLength(3);
    expect(got.lastUserTurn).toEqual([]);
  });

  it('with nothing to fill gives what it gave before, apart from the two rules changed on purpose', () => {
    let compared = 0;
    for (const { preset: p, order: o } of presets()) {
      for (const jevKinds of allModes()) {
        const autoFill = fill({ configuredJev: jevKinds, mainVoiceLang: 'ja' });
        const got = pluginAssemblyPass({ preset: p, order: o, jevKinds, vnKinds: VN_KINDS, autoFill });
        if (got.auto.length > 0) continue;
        expect({ preset: got.preset, order: got.order, stripKinds: got.stripKinds }).toEqual(expected(p, o, jevKinds));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
    // 全是 Jev 也补「别替玩家说话」:Jev 只帮着认哪句是玩家说的,替不了这句提示
    const allJev = Object.fromEntries(JEV_KINDS.map((k) => [k, true])) as JevKinds;
    expect(ids(pluginAssemblyPass({ preset, order, jevKinds: allJev, vnKinds: VN_KINDS, autoFill: fill() }).auto)).toEqual([PLAYER]);
  }, 60_000);

  it('for an Anthropic connection makes them user blocks at the end, to go into the last user turn', () => {
    const prefill = { ...block('prefill'), role: 'assistant' as const };
    const p = presetOf([...prompts, prefill], [...order, on('prefill')]);
    const autoFill = fill({ lastUserTurn: true, material: NO_SCENE });
    const got = pluginAssemblyPass({ preset: p, order: p.orderGroups[0].order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill });
    expect(ids(got.order)).toEqual(['main', 'chatHistory', 'jailbreak', 'anima_sprite', PLAYER, 'prefill']);
    expect(got.preset?.prompts.find((x) => x.identifier === 'anima_sprite')?.role).toBe('user');
    expect(got.lastUserTurn).toEqual(['anima_sprite', PLAYER]);
  });
});

describe('moveToLastUserTurn', () => {
  const msg = (role: 'system' | 'user' | 'assistant', content: string, source: string) =>
    ({ role, content, tokens: 1, sourceIdentifier: source, sourceName: source, sourceKind: 'preset', part: 'preset' }) as never;

  it('appends the auto blocks to the last user message and drops them as messages', () => {
    const result = {
      messages: [
        msg('system', 'S', 'main'),
        msg('user', '你好', 'chatHistory'),
        msg('assistant', '嗯', 'chatHistory'),
        msg('user', '再见', 'chatHistory'),
        msg('user', '块', 'anima_sprite'),
      ],
      skipped: [],
      totalTokens: 5,
      danglingIdentifiers: [],
      budget: {} as never,
    };
    const got = moveToLastUserTurn(result, ['anima_sprite']);
    expect(got.messages.map((m) => [m.role, m.content])).toEqual([
      ['system', 'S'],
      ['user', '你好'],
      ['assistant', '嗯'],
      ['user', '再见\n\n块'],
    ]);
    expect(moveToLastUserTurn(result, [])).toBe(result);
  });
});

describe('pluginAssemblyPass with plugins switched off in the game', () => {
  const prompts = [block('main'), block('chatHistory'), block('anima_bg')];
  const order = [on('main'), on('chatHistory'), on('anima_bg')];
  const preset = presetOf(prompts, order);

  it('treats an off kind like a Jev one: no auto-fill, block off, its tags stripped', () => {
    const offKinds = { ...NONE, sprite: true, bg: true };
    const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, offKinds, vnKinds: VN_KINDS, autoFill: fill() });
    // 开着的音乐、CG 照补,关掉的立绘不补;「别替玩家说话」不归插件开关管(第 2 步起也补)
    expect(ids(got.auto)).toEqual(['anima_bgm', 'anima_cg', PLAYER]);
    expect(got.order.find((o) => o.identifier === 'anima_bg')?.enabled).toBe(false);
    expect(got.stripKinds?.map((k) => k.kind)).toEqual(['sprite', 'bg']);
  });

  it('with nothing off gives the same as without the switches', () => {
    const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, offKinds: NONE, vnKinds: VN_KINDS, autoFill: AS_BEFORE });
    expect(got).toEqual(pluginAssemblyPass({ preset, order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill: AS_BEFORE }));
  });
});
