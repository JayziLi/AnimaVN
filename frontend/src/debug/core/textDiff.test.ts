import { describe, expect, it } from 'vitest';
import { jevLangPrompt } from '../plugins/jev';
import { DEFAULT_LANG_BLOCK_PROMPT, DEFAULT_LANG_BLOCK_PROMPT_JEV } from '../plugins/lang';
import { vnTagKinds } from '../vn/tags';
import { textDiff, type DiffPart } from './textDiff';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const kept = (parts: DiffPart[]) => parts.filter((p) => p.kept).map((p) => p.text).join('');
const all = (parts: DiffPart[]) => parts.map((p) => p.text).join('');
const removed = (parts: DiffPart[]) => parts.filter((p) => !p.kept).map((p) => p.text);

describe('textDiff', () => {
  it('gives one kept part when nothing was taken out', () => {
    expect(textDiff('[双语]\n先日后中。', '[双语]\n先日后中。')).toEqual([{ text: '[双语]\n先日后中。', kept: true }]);
    expect(textDiff('', '')).toEqual([]);
  });

  it('marks a sentence taken out of the middle of a line', () => {
    expect(textDiff('A。B。C。', 'A。C。')).toEqual([
      { text: 'A。', kept: true },
      { text: 'B。', kept: false },
      { text: 'C。', kept: true },
    ]);
  });

  it('marks lines taken out at the start and the end, the line break going with them', () => {
    expect(textDiff('开头\n中间\n结尾', '中间')).toEqual([
      { text: '开头\n', kept: false },
      { text: '中间', kept: true },
      { text: '\n结尾', kept: false },
    ]);
  });

  it('lines up the short language block with the full one, line by line', () => {
    const stored = DEFAULT_LANG_BLOCK_PROMPT.replace('<sprite:微笑>\n', '');
    const parts = textDiff(stored, jevLangPrompt(stored, kinds));
    expect(removed(parts)).toEqual(['；日语那一行不要写任何标签', '- 立绘、场景、音乐标签写在这一对（日语 + 中文）的前面。\n']);
    expect([kept(parts), all(parts)]).toEqual([DEFAULT_LANG_BLOCK_PROMPT_JEV, stored]);

    const def = textDiff(DEFAULT_LANG_BLOCK_PROMPT, DEFAULT_LANG_BLOCK_PROMPT_JEV);
    expect(removed(def)).toEqual([
      '；日语那一行不要写任何标签',
      '- 立绘、场景、音乐标签写在这一对（日语 + 中文）的前面。\n',
      '<sprite:微笑>\n',
    ]);
    expect([kept(def), all(def)]).toEqual([DEFAULT_LANG_BLOCK_PROMPT_JEV, DEFAULT_LANG_BLOCK_PROMPT]);
  });

  it('always adds up to what is sent, even if the sent text has something the full one does not', () => {
    for (const [full, sent] of [
      ['A\nB', 'A\nX\nB'],
      ['A。', 'A!'],
      ['一\n二\n三', '三\n一'],
      ['', '新的'],
      ['旧的', ''],
    ]) {
      expect(kept(textDiff(full, sent))).toBe(sent);
    }
  });
});
