import { describe, expect, it } from 'vitest';
import { EMPTY_CARD, type TavernCard } from '../lib/cardParser';
import { bookCount, cardBlurb, greetingCount, greetingLine, specLabel } from './cardInfo';

const card = (over: Partial<TavernCard>): TavernCard => ({ ...EMPTY_CARD, name: '刻晴', ...over });

describe('specLabel', () => {
  it('names the SillyTavern card version', () => {
    expect(specLabel('chara_card_v2')).toBe('酒馆卡 V2');
    expect(specLabel('chara_card_v3')).toBe('酒馆卡 V3');
    expect(specLabel('chara_card_v1')).toBe('酒馆卡 V1');
    expect(specLabel('')).toBe('角色卡');
    expect(specLabel('something_else')).toBe('角色卡');
  });
});

describe('cardBlurb', () => {
  it('prefers the creator notes', () => {
    expect(cardBlurb(card({ creator_notes: '璃月七星之「玉衡星」。', description: '别的' }))).toBe('璃月七星之「玉衡星」。');
  });

  it('strips HTML and markdown images out of the notes (Chub notes are often a web page)', () => {
    const notes = '<p align="center"><img src="x.png"></p>\n![banner](https://a/b.png)\n<b>温柔</b>的大姐姐';
    expect(cardBlurb(card({ creator_notes: notes }))).toBe('温柔的大姐姐');
  });

  it('falls back to the first paragraph of the description, without tag lines and with {{char}} filled', () => {
    const description = '<char info>\n{{char}} 是璃月七星之一,\n主管土地规划。\n\n第二段不要';
    expect(cardBlurb(card({ description }))).toBe('刻晴 是璃月七星之一, 主管土地规划。');
    expect(cardBlurb(card({ description: '{{user}}是旅行者' }))).toBe('你是旅行者');
  });

  it('cuts long text and is empty when there is nothing', () => {
    expect(cardBlurb(card({ description: '字'.repeat(500) })).length).toBeLessThanOrEqual(161);
    expect(cardBlurb(card({}))).toBe('');
  });
});

describe('counts', () => {
  it('counts the greetings and the lorebook entries', () => {
    expect(greetingCount(card({ first_mes: '你好', alternate_greetings: ['a', 'b'] }))).toBe(3);
    expect(greetingCount(card({ first_mes: '  ', alternate_greetings: ['a'] }))).toBe(1);
    expect(bookCount(card({}))).toBe(0);
    expect(bookCount(card({ character_book: { entries: [{}, {}] as never, raw: {} } }))).toBe(2);
  });
});

describe('greetingLine', () => {
  it('is the first sentence of the greeting, with {{char}} / {{user}} filled', () => {
    expect(greetingLine(card({ first_mes: '能像这样停下来看看烟花,实在是令人幸福。还有别的。' }), '旅行者')).toBe(
      '能像这样停下来看看烟花,实在是令人幸福。',
    );
    expect(greetingLine(card({ first_mes: '{{user}},我是{{Char}}!今天…' }), '旅行者')).toBe('旅行者,我是刻晴!');
    expect(greetingLine(card({ first_mes: '<USER>来了? <BOT>回头。' }), '空')).toBe('空来了?');
    expect(greetingLine(card({ first_mes: 'Hello there. How are you?' }), 'U')).toBe('Hello there.');
  });

  it('skips empty and tag-only lines, drops italics stars and quotes', () => {
    const first_mes = '<p align="center"><img src="a.png"></p>\n\n*她回过头* 「你来了啊。」\n第二行';
    expect(greetingLine(card({ first_mes }), '你')).toBe('她回过头 你来了啊。');
  });

  it('cuts to the limit with an ellipsis, and is empty when there is no greeting', () => {
    const line = greetingLine(card({ first_mes: '字'.repeat(80) }), '你');
    expect(line).toBe(`${'字'.repeat(39)}…`);
    expect(greetingLine(card({ first_mes: '字'.repeat(80) }), '你', 10)).toHaveLength(10);
    expect(greetingLine(card({ first_mes: '  ' }), '你')).toBe('');
  });
});
