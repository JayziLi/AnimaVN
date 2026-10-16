import { describe, expect, it } from 'vitest';
import type { PresetOrderEntry, PresetPrompt, TavernPreset } from '../lib/presetParser';
import type { JevKinds } from '../plugins/jev';
import { DEFAULT_LANG_BLOCK_PROMPT, LANG_BLOCK_ID } from '../plugins/lang';
import { JEV_KINDS, PLUGIN_BLOCK_IDS } from '../plugins/registry';
import { vnTagKinds } from '../vn/tags';
import { autoBlocksFor, autoInsertAt, moveToLastUserTurn, pluginAssemblyPass, type AutoFill } from './assembly';
import { legacyAssemblyPass } from './assemblyLegacy';

const VN_KINDS = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');

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

describe('pluginAssemblyPass', () => {
  it('gives exactly what DebugApp did before (every preset shape × every Jev mode)', () => {
    let cases = 0;
    for (const { preset, order } of presets()) {
      for (const jevKinds of allModes()) {
        const got = pluginAssemblyPass({ preset, order, jevKinds, vnKinds: VN_KINDS });
        const want = oracle(preset, order, jevKinds);
        expect({ preset: got.preset, order: got.order, stripKinds: got.stripKinds }).toEqual(want);
        expect([got.auto, got.lastUserTurn]).toEqual([[], []]);
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(1000);
  });

  it('keeps the same arrays when there is nothing to change, so memos do not redo work', () => {
    const [{ preset, order }] = presets();
    const none = Object.fromEntries(JEV_KINDS.map((k) => [k, false])) as JevKinds;
    const got = pluginAssemblyPass({ preset, order, jevKinds: none, vnKinds: VN_KINDS });
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
    const jevKinds = { ...(Object.fromEntries(JEV_KINDS.map((k) => [k, false])) as JevKinds), sprite: true };
    const got = pluginAssemblyPass({ preset, order, jevKinds, vnKinds: VN_KINDS });
    expect(got.order.find((o) => o.identifier === 'anima_sprite')?.enabled).toBe(false);
    expect(got.preset?.prompts.find((p) => p.identifier === LANG_BLOCK_ID)?.content).not.toBe(DEFAULT_LANG_BLOCK_PROMPT);
    expect(got.stripKinds?.map((k) => k.kind)).toEqual(['sprite']);
  });
});

// ── 自动补块(设计稿 2.7)──

const NONE = Object.fromEntries(JEV_KINDS.map((k) => [k, false])) as JevKinds;
const ALL_MATERIAL = { sprite: true, bg: true, bgm: true, cg: true };
const NO_SCENE = { sprite: true, bg: false, bgm: false, cg: false };
const BLOCKS = Object.fromEntries(
  [...PLUGIN_BLOCK_IDS].map((id) => [id, { identifier: id, name: `${id} 名`, content: `${id} 模板` }]),
);
const fill = (o: Partial<AutoFill> = {}): AutoFill => ({
  enabled: true,
  configuredJev: NONE,
  material: ALL_MATERIAL,
  lang: false,
  blocks: BLOCKS,
  lastUserTurn: false,
  ...o,
});
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

describe('autoBlocksFor', () => {
  const order = [on('main'), on('chatHistory')];

  it('fills an AI-mode kind that has material and no block at all in the order', () => {
    expect(ids(autoBlocksFor(order, NONE, fill()))).toEqual(['anima_sprite', 'anima_bg', 'anima_bgm', 'anima_cg']);
  });

  it('does not fill a block that is there but turned off, a Jev-mode kind, or a kind without material', () => {
    expect(ids(autoBlocksFor([...order, off('anima_sprite')], NONE, fill()))).not.toContain('anima_sprite');
    expect(ids(autoBlocksFor(order, { ...NONE, bg: true }, fill()))).not.toContain('anima_bg');
    const noCg = fill({ material: { ...ALL_MATERIAL, cg: false } });
    expect(ids(autoBlocksFor(order, NONE, noCg))).not.toContain('anima_cg');
    expect(autoBlocksFor(order, NONE, fill({ enabled: false }))).toEqual([]);
  });

  it('says it is a temporary fill when Jev was chosen but has no key', () => {
    const got = autoBlocksFor(order, NONE, fill({ configuredJev: { ...NONE, sprite: true } }));
    expect(got.find((a) => a.identifier === 'anima_sprite')?.reason).toBe('no-key');
    expect(got.find((a) => a.identifier === 'anima_bg')?.reason).toBe('ai');
  });

  it('fills the language block only when the card asks for it, and never the player block', () => {
    expect(ids(autoBlocksFor(order, NONE, fill()))).not.toContain(LANG_BLOCK_ID);
    expect(ids(autoBlocksFor(order, NONE, fill({ lang: true })))).toContain(LANG_BLOCK_ID);
    expect(ids(autoBlocksFor(order, NONE, fill({ lang: true })))).not.toContain('anima_player');
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
    expect(got.auto).toEqual([{ identifier: 'anima_sprite', name: 'anima_sprite 名', reason: 'ai' }]);
    expect(ids(got.order)).toEqual(['main', 'chatHistory', 'anima_sprite', 'jailbreak']);
    const added = got.preset?.prompts.find((p) => p.identifier === 'anima_sprite');
    expect(added).toMatchObject({ role: 'system', content: 'anima_sprite 模板' });
    expect(preset.prompts).toHaveLength(3);
    expect(got.lastUserTurn).toEqual([]);
  });

  it('with nothing to fill gives exactly what it gave before (all Jev, or blocks already there)', () => {
    let compared = 0;
    for (const { preset: p, order: o } of presets()) {
      for (const jevKinds of allModes()) {
        const autoFill = fill({ configuredJev: jevKinds });
        const got = pluginAssemblyPass({ preset: p, order: o, jevKinds, vnKinds: VN_KINDS, autoFill });
        if (got.auto.length > 0) continue;
        expect({ preset: got.preset, order: got.order, stripKinds: got.stripKinds }).toEqual(oracle(p, o, jevKinds));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
    const allJev = Object.fromEntries(JEV_KINDS.map((k) => [k, true])) as JevKinds;
    expect(pluginAssemblyPass({ preset, order, jevKinds: allJev, vnKinds: VN_KINDS, autoFill: fill() }).auto).toEqual([]);
  });

  it('for an Anthropic connection makes them user blocks at the end, to go into the last user turn', () => {
    const prefill = { ...block('prefill'), role: 'assistant' as const };
    const p = presetOf([...prompts, prefill], [...order, on('prefill')]);
    const autoFill = fill({ lastUserTurn: true, material: NO_SCENE });
    const got = pluginAssemblyPass({ preset: p, order: p.orderGroups[0].order, jevKinds: NONE, vnKinds: VN_KINDS, autoFill });
    expect(ids(got.order)).toEqual(['main', 'chatHistory', 'jailbreak', 'anima_sprite', 'prefill']);
    expect(got.preset?.prompts.find((x) => x.identifier === 'anima_sprite')?.role).toBe('user');
    expect(got.lastUserTurn).toEqual(['anima_sprite']);
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
    // 开着的音乐、CG 照补,关掉的立绘不补
    expect(ids(got.auto)).toEqual(['anima_bgm', 'anima_cg']);
    expect(got.order.find((o) => o.identifier === 'anima_bg')?.enabled).toBe(false);
    expect(got.stripKinds?.map((k) => k.kind)).toEqual(['sprite', 'bg']);
  });

  it('with nothing off gives the same as without the switches', () => {
    const got = pluginAssemblyPass({ preset, order, jevKinds: NONE, offKinds: NONE, vnKinds: VN_KINDS });
    expect(got).toEqual(pluginAssemblyPass({ preset, order, jevKinds: NONE, vnKinds: VN_KINDS }));
  });
});
