import { describe, expect, it } from 'vitest';
import { parseReply } from './script';
import { vnTagKinds } from './tags';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const opts = { charName: '星绘', userName: 'Lj', tags: kinds, streaming: false };
const speakers = (raw: string) => parseReply(raw, opts).lines.map((l) => [l.speaker, l.text]);

describe('name prefixes', () => {
  it('reads a bold name before a quote as the speaker', () => {
    expect(speakers('**星绘**：「欢迎回来。」\n**店员**：「两位里面请。」\n**店员：**「这边。」')).toEqual([
      ['星绘', '「欢迎回来。」'],
      ['店员', '「两位里面请。」'],
      ['店员', '「这边。」'],
    ]);
  });

  it('still treats 她说： as narration leading into the line', () => {
    expect(speakers('她说：「好。」')).toEqual([
      [null, '她说：'],
      ['星绘', '「好。」'],
    ]);
  });
});

describe('script-style lines without quotes', () => {
  it("reads 名字：台词 as dialogue for the character's and the player's names", () => {
    expect(speakers('星绘：欢迎回来，今天累不累？\nLj：还好，就是有点饿。\n**星绘**：那我去热一下晚饭。')).toEqual([
      ['星绘', '欢迎回来，今天累不累？'],
      ['Lj', '还好，就是有点饿。'],
      ['星绘', '那我去热一下晚饭。'],
    ]);
  });

  it('leaves other 名词：内容 lines as narration', () => {
    expect(speakers('时间：晚上八点。\n地点：客厅')).toEqual([
      [null, '时间：晚上八点。'],
      [null, '地点：客厅'],
    ]);
  });

  it('puts a tag written before a script line on that line', () => {
    const p = parseReply('<sprite:微笑>星绘：欢迎回来。', opts);
    expect(p.lines.map((l) => l.speaker)).toEqual(['星绘']);
    expect(p.hits.map((h) => [h.label, h.lineIndex])).toEqual([['微笑', 0]]);
  });
});

// 2026-10-06:真实回复里还没碰到过,但会出空台词 / 只有标点的一句
describe('no empty or punctuation-only lines', () => {
  it('a bold name alone on its line gives no empty line', () => {
    const lines = speakers('**星绘：**\n「早上好。」');
    expect(lines.every(([, text]) => String(text).trim() !== '')).toBe(true);
  });

  it('a hard cut right before the last 。 does not leave 。 on its own', () => {
    const long = '她' + '走'.repeat(89) + '。';
    const lines = speakers(long);
    expect(lines.every(([, text]) => !/^[。」]+$/.test(String(text)))).toBe(true);
    expect(lines.map(([, t]) => t).join('')).toBe(long);
  });

  it('a stray closing quote from nested quotes is not a line of its own', () => {
    const lines = speakers('「他说「明天见」就走了。」');
    expect(lines.every(([, text]) => String(text).trim() !== '」')).toBe(true);
  });
});
