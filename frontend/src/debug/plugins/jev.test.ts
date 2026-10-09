import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../lib/chatEntry';
import { parseReply } from '../vn/script';
import { vnTagKinds } from '../vn/tags';
import {
  DEFAULT_JEV_CONFIG,
  NO_JEV,
  decisionTags,
  emotionBefore,
  insertionPoint,
  jevKindsOf,
  jevLangPrompt,
  jevMayTag,
  jevOrder,
  jevStripPrompt,
  jevTagKinds,
  voiceWaitsForJev,
  normalizeJevConfig,
  promptOverrides,
  stripReplyTags,
  wantsTagFreeLang,
  type JevKinds,
} from './jev';
import { jevView, makeNote } from './jevNotes';
import { DEFAULT_LANG_BLOCK_PROMPT, DEFAULT_LANG_BLOCK_PROMPT_JEV, parseBilingual } from './lang';
import { normalizePlayerConfig } from './player';
import { normalizeSceneConfig } from './scene';
import { normalizeSpriteConfig } from './sprite';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const T = { sprite: '<sprite:{表情}>', bg: '<bg:{场景}>', bgm: '<bgm:{音乐}>', cg: '<cg:{CG}>' };
// CG 每句都问,会让 jevMayTag 对每句都说要等:这里先不开,CG 的单独测
const ALL: JevKinds = { sprite: true, bg: true, bgm: true, cg: false, player: true };
const opts = { charName: '星绘', userName: 'Lj', tags: kinds, streaming: false };

describe('stripReplyTags', () => {
  it('drops tag-only lines and inline tags, keeps everything else', () => {
    const raw = '<bg:食堂>\n两人走进食堂。\n<sprite:微笑>「今天有咖喱！」\n<我>「小心烫。」 \n结尾。';
    expect(stripReplyTags(raw, kinds)).toBe('两人走进食堂。\n「今天有咖喱！」\n「小心烫。」 \n结尾。');
  });

  it('only strips the kinds it is given', () => {
    const raw = '<bg:食堂>\n<sprite:微笑>「今天有咖喱！」';
    expect(stripReplyTags(raw, jevTagKinds({ ...NO_JEV, sprite: true }, kinds))).toBe('<bg:食堂>\n「今天有咖喱！」');
    expect(stripReplyTags(raw, jevTagKinds(NO_JEV, kinds))).toBe(raw);
  });

  it('leaves a half-written tag at the end for the parser to hide', () => {
    expect(stripReplyTags('她笑了。\n<spri', kinds)).toBe('她笑了。\n<spri');
  });
});

/** 按句号给标签,合并出来的样子:和 JevRun 记标注、jevView 合并走的是同一条路 */
function stitchTags(clean: string, ends: readonly number[], tagsByLine: Map<number, string[]>): string {
  const notes = [...tagsByLine].map(([k, tags]) => makeNote(clean, insertionPoint(clean, ends, k), tags.join('')));
  const record = { kinds: ['sprite' as const], lines: 0, requests: 0, tokens: 0, maxMs: 0, failed: 0, notes };
  return jevView(clean, record, kinds).text;
}

describe('insertionPoint / merging the notes', () => {
  it('puts each tag right before its line, on the line itself', () => {
    const clean = '两人走进食堂。\n\n「今天有咖喱！」她说。「快来。」\n';
    const parsed = parseReply(clean, opts);
    expect(parsed.lines.map((l) => l.text)).toEqual(['两人走进食堂。', '「今天有咖喱！」', '她说。', '「快来。」']);
    expect(insertionPoint(clean, parsed.ends, 0)).toBe(0);
    expect(clean.slice(insertionPoint(clean, parsed.ends, 1))).toMatch(/^「今天/);
    expect(clean.slice(insertionPoint(clean, parsed.ends, 3))).toMatch(/^「快来/);

    const stitched = stitchTags(
      clean,
      parsed.ends,
      new Map([
        [0, ['<bg:食堂>']],
        [1, ['<sprite:开心>']],
        [3, ['<sprite:微笑>']],
      ]),
    );
    expect(stitched).toBe('<bg:食堂>两人走进食堂。\n\n<sprite:开心>「今天有咖喱！」她说。<sprite:微笑>「快来。」\n');
    const again = parseReply(stitched, opts);
    expect(again.lines.map((l) => l.text)).toEqual(parsed.lines.map((l) => l.text));
    expect(again.hits.map((h) => [h.kind, h.label, h.lineIndex])).toEqual([
      ['bg', '食堂', 0],
      ['sprite', '开心', 1],
      ['sprite', '微笑', 3],
    ]);
  });

  it('skips the punctuation left on the previous line', () => {
    const clean = '「你好」。\n「再见」';
    const parsed = parseReply(clean, opts);
    expect(clean.slice(insertionPoint(clean, parsed.ends, 1))).toBe('「再见」');
  });

  it('writes the tag before the Japanese line of a bilingual pair', () => {
    const clean = '「おかえり。今日もお疲れさま。」\n「欢迎回来。今天也辛苦啦。」\n\n彼女はそう言って、ソファの端に寄った。\n她说着，往沙发边上挪了挪。\n「ここに座って。」\n「坐这儿吧。」';
    const parsed = parseBilingual(clean, opts);
    expect(parsed.lines.map((l) => l.text)).toEqual([
      '「欢迎回来。今天也辛苦啦。」',
      '她说着，往沙发边上挪了挪。',
      '「坐这儿吧。」',
    ]);
    const stitched = stitchTags(clean, parsed.ends, new Map([[0, ['<sprite:微笑>']], [2, ['<sprite:害羞>']]]));
    expect(stitched).toContain('<sprite:微笑>「おかえり。');
    expect(stitched).toContain('<sprite:害羞>「ここに座って。」');
    const again = parseBilingual(stitched, opts);
    expect(again.lines.map((l) => [l.text, l.ja])).toEqual(parsed.lines.map((l) => [l.text, l.ja]));
    expect(again.hits.map((h) => [h.label, h.lineIndex])).toEqual([
      ['微笑', 0],
      ['害羞', 2],
    ]);
  });
});

describe('decisionTags', () => {
  it('writes scene and music first, then the sprite or <我>', () => {
    expect(decisionTags({ speaker: 'char', emotion: '微笑', bg: '食堂', bgm: '日常' }, null, T, ALL)).toEqual([
      '<bg:食堂>',
      '<bgm:日常>',
      '<sprite:微笑>',
    ]);
    expect(decisionTags({ speaker: 'user', emotion: null, bg: null, bgm: null }, '微笑', T, ALL)).toEqual(['<我>']);
    expect(decisionTags({ speaker: 'other', emotion: null, bg: null, bgm: null }, '微笑', T, ALL)).toEqual([]);
  });

  it("keeps the current face on the character's line when no emotion came back", () => {
    expect(decisionTags({ speaker: 'char', emotion: null, bg: null, bgm: null }, '害羞', T, ALL)).toEqual(['<sprite:害羞>']);
  });

  it('only writes the kinds that are in Jev mode', () => {
    const d = { speaker: 'user' as const, emotion: null, bg: '食堂', bgm: '紧张' };
    expect(decisionTags(d, null, T, { ...NO_JEV, bg: true })).toEqual(['<bg:食堂>']);
    expect(decisionTags({ ...d, speaker: 'char', emotion: '微笑' }, null, T, { ...NO_JEV, player: true })).toEqual([]);
  });
});

describe('parseReply under Jev', () => {
  const clean = '「a」\n「b」\n「c」';
  const stitched = '<sprite:微笑>「a」\n「b」\n「c」';

  it("treats untagged quotes as not the character's once Jev has judged them", () => {
    const lines = parseReply(clean, { ...opts, strict: true }).lines;
    expect(lines.map((l) => l.speaker)).toEqual([null, null, null]);
    expect(parseReply(clean, opts).lines.map((l) => l.speaker)).toEqual(['星绘', '星绘', '星绘']);
  });

  it('leaves lines Jev has not judged to the default attribution', () => {
    const lines = parseReply(stitched, { ...opts, strict: true, loose: new Set([2]) }).lines;
    expect(lines.map((l) => [l.speaker, Boolean(l.untagged)])).toEqual([
      ['星绘', false],
      [null, true],
      ['星绘', false],
    ]);
  });
});

describe('assembly helpers', () => {
  const order = [
    { identifier: 'main', enabled: true },
    { identifier: 'anima_sprite', enabled: true },
    { identifier: 'anima_bg', enabled: true },
    { identifier: 'anima_bgm', enabled: true },
    { identifier: 'anima_player', enabled: false },
    { identifier: 'anima_lang', enabled: true },
  ];

  it('turns off only the blocks of the Jev kinds', () => {
    expect(jevOrder(order, ALL).map((o) => o.enabled)).toEqual([true, false, false, false, false, true]);
    expect(jevOrder(order, { ...NO_JEV, bg: true }).map((o) => o.enabled)).toEqual([true, true, false, true, false, true]);
  });

  it('uses the tag-free bilingual block only when no AI-mode tag block is on', () => {
    expect(wantsTagFreeLang(NO_JEV, order)).toBe(false);
    expect(wantsTagFreeLang({ ...NO_JEV, sprite: true, bg: true }, order)).toBe(false);
    // 玩家台词块本来就关着,不算
    expect(wantsTagFreeLang({ ...NO_JEV, sprite: true, bg: true, bgm: true }, order)).toBe(true);
  });

  it('strips tags from every message of the assembled prompt', () => {
    const result = {
      messages: [
        { role: 'system', content: '<START>\n<bg:客厅><sprite:惊讶>\n「……本当ですか？」' },
        { role: 'assistant', content: '<sprite:微笑>「早」' },
        { role: 'user', content: '去食堂吧' },
      ],
    } as unknown as Parameters<typeof jevStripPrompt>[0];
    expect(jevStripPrompt(result, kinds).messages.map((m) => m.content)).toEqual([
      '<START>\n「……本当ですか？」',
      '「早」',
      '去食堂吧',
    ]);
  });

  it('swaps the default bilingual block for a tag-free one', () => {
    expect(jevLangPrompt(DEFAULT_LANG_BLOCK_PROMPT, kinds)).toBe(DEFAULT_LANG_BLOCK_PROMPT_JEV);
    expect(DEFAULT_LANG_BLOCK_PROMPT_JEV).not.toMatch(/标签|<sprite/);
    expect(jevLangPrompt('先日后中。\n<sprite:微笑>\n「おかえり」', kinds)).toBe('先日后中。\n「おかえり」');
  });

  it('finds the face in effect before a reply', () => {
    const entry = (role: 'user' | 'assistant', text: string): ChatEntry => ({
      id: text,
      role,
      swipes: [text],
      swipeIndex: 0,
      swipeInfo: [{ sendDate: '' }],
      overswipe: 'regenerate',
    });
    const candidates = [
      { label: '平静', aliases: [] },
      { label: '微笑', aliases: ['smile'] },
    ];
    expect(emotionBefore([], kinds, candidates)).toBe('平静');
    const entries = [entry('assistant', '<sprite:smile>「早」'), entry('user', '<sprite:微笑>'), entry('assistant', '<sprite:乱写>「嗯」')];
    expect(emotionBefore(entries, kinds, candidates)).toBe('微笑');
  });
});

describe('in the visual novel', () => {
  const entry = (jev?: object): ChatEntry => ({
    id: 'e',
    role: 'assistant',
    swipes: ['x'],
    swipeIndex: 0,
    swipeInfo: [{ sendDate: '', ...(jev ? { jev } : {}) } as ChatEntry['swipeInfo'][number]],
    overswipe: 'regenerate',
  });

  it('knows which kinds of a reply Jev tagged', () => {
    expect(jevKindsOf(entry())).toEqual([]);
    expect(jevKindsOf(entry({ kinds: ['bg'], lines: 1, requests: 1, tokens: 0, maxMs: 0, failed: 0 }))).toEqual(['bg']);
    // 第一版存的没有 kinds:当成四类都是
    expect(jevKindsOf(entry({ lines: 1 }))).toEqual(['sprite', 'bg', 'bgm', 'player']);
  });

  it('holds the voice only when Jev decides who speaks or how', () => {
    expect(voiceWaitsForJev(['bg', 'bgm'])).toBe(false);
    expect(voiceWaitsForJev(['player'])).toBe(true);
  });

  it('waits for Jev on the lines it may still tag', () => {
    const say = { speaker: '星绘', text: '「a」' };
    const narrate = { speaker: null, text: '她笑了。' };
    expect(jevMayTag(say, 3, '星绘', ['sprite'])).toBe(true);
    expect(jevMayTag(say, 3, '星绘', ['bg'])).toBe(false);
    expect(jevMayTag(say, 0, '星绘', ['bg'])).toBe(true);
    expect(jevMayTag(narrate, 3, '星绘', ['sprite'])).toBe(false);
    expect(jevMayTag(narrate, 3, '星绘', ['bgm'])).toBe(true);
    expect(jevMayTag({ speaker: '店员', text: '「请」' }, 3, '星绘', ['sprite', 'player'])).toBe(false);
  });
});

describe('configs', () => {
  it('reads modes and Jev settings, falling back to AI mode and defaults', () => {
    expect(normalizeSpriteConfig({}).mode).toBe('ai');
    const sprite = normalizeSpriteConfig({ mode: 'jev', jev: { emotionPrompt: '表情?' } });
    expect([sprite.mode, sprite.jev.emotionPrompt]).toEqual(['jev', '表情?']);
    const bg = normalizeSceneConfig('bg', { mode: 'jev', jev: { threshold: 2, prompt: '  ' } });
    expect([bg.mode, bg.jev.threshold, bg.jev.prompt, bg.tagTemplate]).toEqual(['jev', 0.95, null, '<bg:{场景}>']);
    expect(normalizeSceneConfig('bgm', null).jev.threshold).toBe(0.6);
    expect(normalizePlayerConfig({ mode: 'x' })).toMatchObject({ mode: 'ai', jev: { popup: true } });
    // 第一版的 { enabled } 不认
    expect(normalizeJevConfig({ enabled: true })).toEqual(DEFAULT_JEV_CONFIG);
    expect(normalizeJevConfig({ syncText: false, speakerThreshold: 0.1 })).toMatchObject({
      syncText: false,
      speakerThreshold: 0.5,
    });
  });

  it('sends only the prompts that were edited', () => {
    const shared = { ...DEFAULT_JEV_CONFIG, prompts: { ...DEFAULT_JEV_CONFIG.prompts, speaker_none: '心里话' } };
    const sprite = normalizeSpriteConfig({ jev: { emotionPrompt: '表情?' } });
    const bg = normalizeSceneConfig('bg', { jev: { keepPrompt: '没动' } });
    const bgm = normalizeSceneConfig('bgm', {});
    const cg = normalizeSceneConfig('cg', { jev: { offPrompt: '收起来' } });
    expect(promptOverrides(shared, sprite, bg, bgm, cg)).toEqual({
      speaker_none: '心里话',
      emotion: '表情?',
      bg_keep: '没动',
      cg_off: '收起来',
    });
  });
});

describe('CG', () => {
  it('writes the CG tag after scene and music, and <cg:无> to put it away', () => {
    const k = { ...ALL, cg: true };
    expect(decisionTags({ speaker: 'char', emotion: '微笑', bg: null, bgm: null, cg: '午睡' }, null, T, k)).toEqual([
      '<cg:午睡>',
      '<sprite:微笑>',
    ]);
    expect(decisionTags({ speaker: null, emotion: null, bg: '食堂', bgm: null, cg_off: true }, null, T, k)).toEqual([
      '<bg:食堂>',
      '<cg:无>',
    ]);
    // CG 不是 Jev 模式:不写
    expect(decisionTags({ speaker: null, emotion: null, bg: null, bgm: null, cg: '午睡' }, null, T, ALL)).toEqual([]);
  });

  it('makes every line wait for Jev when CG is judged by it', () => {
    expect(jevMayTag({ speaker: null, text: '……' }, 5, '星绘', ['cg'])).toBe(true);
    expect(jevMayTag({ speaker: '店员', text: '「请」' }, 5, '星绘', ['cg'])).toBe(true);
  });
});
