import { describe, expect, it } from 'vitest';
import type { AssemblyResult } from '../lib/assembler';
import type { ChatEntry } from '../lib/chatEntry';
import { vnTagKinds } from '../vn/tags';
import { NO_JEV, jevStripPrompt, jevTagKinds, type JevKinds } from './jev';
import { cutJev, insertionPoint, jevText, jevView, lineTones, looseLines, makeNote, type JevNote } from './jevNotes';
import type { JevStats } from './jevRun';
import { parseBilingual } from './lang';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const opts = { charName: '星绘', userName: 'Lj', tags: kinds, streaming: false };

const RAW = '两人走进食堂。\n「今天有咖喱！」\n「欢迎光临。」店员说。';

/** Jev 判这条回复:按句号给标签(空串 = 判过、不用加) */
function judge(raw: string, tags: string[], jevKinds: JevStats['kinds'] = ['sprite', 'bg']): JevStats {
  const { ends } = parseBilingual(raw, opts);
  const notes: JevNote[] = tags.map((t, k) => makeNote(raw, insertionPoint(raw, ends, k), t));
  return { kinds: jevKinds, lines: tags.length, requests: 1, tokens: 0, maxMs: 0, failed: 0, notes };
}

const assistant = (text: string, jev?: JevStats): ChatEntry => ({
  id: 'a',
  role: 'assistant',
  swipes: [text],
  swipeIndex: 0,
  swipeInfo: [{ sendDate: '', ...(jev ? { jev } : {}) }],
  overswipe: 'regenerate',
});

describe('jevView', () => {
  const jev = judge(RAW, ['<bg:食堂>', '<sprite:开心>', '', '']);

  it('merges the notes into the original and keeps the original as is', () => {
    const view = jevView(RAW, jev, kinds);
    expect(view.text).toBe('<bg:食堂>两人走进食堂。\n<sprite:开心>「今天有咖喱！」\n「欢迎光临。」店员说。');
    expect(view.original).toBe(RAW);
    expect(view.marks.map((m) => view.text.slice(m.from, m.to))).toEqual(['<bg:食堂>', '<sprite:开心>']);
    expect(view.dropped).toBe(0);
    // 没用 Jev 的分支原样
    expect(jevView(RAW, undefined, kinds).text).toBe(RAW);
  });

  it("drops only the notes of sentences that were edited, and finds the ones that moved", () => {
    const edited = '两人推门走进了食堂。\n「今天有咖喱！」\n「欢迎光临！」店员说。';
    const view = jevView(edited, jev, kinds);
    // 第 0 句改了:场景标签去掉;第 1 句只是往后挪了,标签跟着走;第 2 句改了,第 3 句开头没变
    expect(view.text).toBe('两人推门走进了食堂。\n<sprite:开心>「今天有咖喱！」\n「欢迎光临！」店员说。');
    expect(view.dropped).toBe(2);
  });

  it('treats the first version (tags stitched into the text) as already merged', () => {
    const stitched = '<bg:食堂>两人走进食堂。\n<sprite:开心>「今天有咖喱！」';
    const legacy = { kinds: ['sprite', 'bg'], lines: 2, requests: 1, tokens: 0, maxMs: 0, failed: 0 } as JevStats;
    const view = jevView(stitched, legacy, kinds);
    expect(view.text).toBe(stitched);
    expect(view.original).toBe('两人走进食堂。\n「今天有咖喱！」');
    expect(view.judged).toBeNull();
  });

  it("lets Jev's tags win over the ones the model wrote anyway", () => {
    const raw = '<sprite:乱写>「今天有咖喱！」';
    const record = judge('「今天有咖喱！」', ['<sprite:开心>'], ['sprite']);
    expect(jevView(raw, record, kinds).text).toBe('<sprite:开心>「今天有咖喱！」');
  });
});

describe('who speaks after an edit', () => {
  it("applies the strict rule only to the lines Jev judged", () => {
    const jev = judge(RAW, ['', '<sprite:开心>', '', '']);
    const edited = RAW.replace('「欢迎光临。」', '「欢迎！」');
    const view = jevView(edited, jev, kinds);
    const { ends } = parseBilingual(view.text, opts);
    const loose = looseLines(view, ends);
    // 第 2 句改过、标注没了:照默认的认法(引号里的算角色的)
    expect([...loose]).toEqual([2]);
    const lines = parseBilingual(view.text, { ...opts, strict: true, loose }).lines;
    expect(lines.map((l) => [l.text, l.speaker])).toEqual([
      ['两人走进食堂。', null],
      ['「今天有咖喱！」', '星绘'],
      ['「欢迎！」', '星绘'],
      ['店员说。', null],
    ]);
    // 没改的时候 Jev 判成别人说的,不算角色的
    const before = jevView(RAW, jev, kinds);
    const strict = parseBilingual(before.text, { ...opts, strict: true, loose: looseLines(before, parseBilingual(before.text, opts).ends) });
    expect(strict.lines[2].speaker).toBeNull();
  });
});

describe('cutJev', () => {
  it('keeps the notes of the lines left after an interjection', () => {
    const jev = judge(RAW, ['<bg:食堂>', '<sprite:开心>', '<sprite:微笑>', '']);
    const keep = '两人走进食堂。\n「今天有咖喱！」';
    const cut = cutJev(jev, keep, kinds);
    expect(cut.notes).toHaveLength(2);
    const view = jevView(keep, cut, kinds);
    expect(view.text).toBe('<bg:食堂>两人走进食堂。\n<sprite:开心>「今天有咖喱！」');
    expect(view.dropped).toBe(0);
  });
});

describe('history sent to the model', () => {
  const entry = assistant(RAW, judge(RAW, ['<bg:食堂>', '<sprite:开心>', '', ''], ['sprite', 'bg']));
  /** 组装时的样子:历史是合并后的正文,现在是 Jev 模式的那几类再摘掉 */
  const sent = (now: JevKinds) =>
    jevStripPrompt(
      { messages: [{ role: 'assistant', content: jevText(entry, kinds) }] } as unknown as AssemblyResult,
      jevTagKinds(now, kinds),
    ).messages[0].content;

  it("carries Jev's old tags as examples once a kind is back in AI mode", () => {
    // 全切回 AI 写:Jev 以前标的全当示例发
    expect(sent(NO_JEV)).toBe('<bg:食堂>两人走进食堂。\n<sprite:开心>「今天有咖喱！」\n「欢迎光临。」店员说。');
    // 背景还是 Jev、立绘切回了 AI:立绘留着,背景摘掉
    expect(sent({ ...NO_JEV, bg: true })).toBe('两人走进食堂。\n<sprite:开心>「今天有咖喱！」\n「欢迎光临。」店员说。');
    // 都是 Jev:发的就是原文
    expect(sent({ ...NO_JEV, sprite: true, bg: true })).toBe(RAW);
  });

  it("does not send the model's own tags of the kinds now in Jev mode", () => {
    const own = assistant('<sprite:微笑>「早」');
    const content = jevStripPrompt(
      { messages: [{ role: 'assistant', content: jevText(own, kinds) }] } as unknown as AssemblyResult,
      jevTagKinds({ ...NO_JEV, sprite: true }, kinds),
    ).messages[0].content;
    expect(content).toBe('「早」');
  });
});

describe('tones (a two-level question a cartridge registers)', () => {
  const lines = '两人走进食堂。\n「今天有咖喱！」\n「好烫……」';
  const withTones = (tones: (string | null)[]): JevStats => {
    const { ends } = parseBilingual(lines, opts);
    const notes = ['', '<sprite:开心>', ''].map((t, k) => makeNote(lines, insertionPoint(lines, ends, k), t, tones[k]));
    return { kinds: ['sprite'], lines: 3, requests: 1, tokens: 0, maxMs: 0, failed: 0, notes };
  };

  it('keeps the tone off the text and lands it on its line', () => {
    const view = jevView(lines, withTones([null, '高', '低']), kinds);
    expect(view.text).toBe('两人走进食堂。\n<sprite:开心>「今天有咖喱！」\n「好烫……」');
    expect(lineTones(view, parseBilingual(view.text, opts).ends)).toEqual([null, '高', '低']);
  });

  it('has no tones when none was judged', () => {
    const view = jevView(lines, withTones([null, null, null]), kinds);
    expect(view.tones).toBeNull();
    expect(lineTones(view, parseBilingual(view.text, opts).ends)).toBeNull();
    // 没写 tone 的旧标注里也没有这个字段
    expect(makeNote(lines, 0, '')).not.toHaveProperty('tone');
  });
});
