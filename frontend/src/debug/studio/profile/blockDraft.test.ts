import { describe, expect, it } from 'vitest';
import { PROMPT_FIELDS, type MarkerSource } from '../../lib/cardFields';
import type { PresetPrompt } from '../../lib/presetParser';
import {
  blockPatchOf,
  canDeleteBlock,
  cardPatchOf,
  changedFields,
  draftOf,
  isDraftDirty,
  parseCount,
  shownCount,
  type BlockDraft,
} from './blockDraft';

const block = (over: Partial<PresetPrompt> = {}): PresetPrompt => ({
  identifier: 'b1',
  name: '文风',
  role: 'system',
  content: '写得细一点',
  marker: false,
  systemPrompt: false,
  injectionPosition: 0,
  injectionDepth: 4,
  injectionOrder: 100,
  injectionTrigger: [],
  forbidOverrides: false,
  ...over,
});

const markerBlock = (over: Partial<PresetPrompt> = {}): PresetPrompt =>
  block({ identifier: 'charDescription', name: 'Char Description', content: '', marker: true, ...over });

const descDef = PROMPT_FIELDS.find((f) => f.key === 'description')!;
const cardSource = (value: string): MarkerSource => ({
  kind: 'card',
  def: descDef,
  value,
  wrapTemplate: null,
});

const edit = (d: BlockDraft, over: Partial<BlockDraft>): BlockDraft => ({ ...d, ...over });

describe('draftOf', () => {
  it('从块抄出草稿,数字转成框里的文字', () => {
    expect(draftOf(block({ injectionPosition: 1, injectionDepth: 2, injectionOrder: 50 }), null)).toEqual({
      name: '文风',
      role: 'system',
      content: '写得细一点',
      forbidOverrides: false,
      absolute: true,
      depth: '2',
      order: '50',
      cardValue: '',
    });
  });

  it('卡填的 marker 带上卡字段的值,别的来源是空串', () => {
    expect(draftOf(markerBlock(), cardSource('骑士团长')).cardValue).toBe('骑士团长');
    expect(draftOf(markerBlock(), { kind: 'elsewhere', label: 'x', hint: 'y' }).cardValue).toBe('');
  });
});

describe('parseCount', () => {
  it('合法的非负数取整', () => {
    expect(parseCount('3', 9)).toBe(3);
    expect(parseCount(' 7 ', 9)).toBe(7);
    expect(parseCount('2.8', 9)).toBe(2);
    expect(parseCount('0', 9)).toBe(0);
  });

  it('空串、非数字、负数按原值算', () => {
    expect(parseCount('', 9)).toBe(9);
    expect(parseCount('  ', 9)).toBe(9);
    expect(parseCount('abc', 9)).toBe(9);
    expect(parseCount('-1', 9)).toBe(9);
  });
});

describe('isDraftDirty', () => {
  const p = block();
  const d = draftOf(p, null);

  it('原样不算改过', () => {
    expect(isDraftDirty(p, null, d)).toBe(false);
  });

  it('文本块每个字段都算', () => {
    expect(isDraftDirty(p, null, edit(d, { name: '新名' }))).toBe(true);
    expect(isDraftDirty(p, null, edit(d, { role: 'user' }))).toBe(true);
    expect(isDraftDirty(p, null, edit(d, { content: '改了' }))).toBe(true);
    expect(isDraftDirty(p, null, edit(d, { forbidOverrides: true }))).toBe(true);
    expect(isDraftDirty(p, null, edit(d, { absolute: true }))).toBe(true);
    expect(isDraftDirty(p, null, edit(d, { depth: '0' }))).toBe(true);
    expect(isDraftDirty(p, null, edit(d, { order: '99' }))).toBe(true);
  });

  it('数字框打到一半(空串)不算改过', () => {
    expect(isDraftDirty(p, null, edit(d, { depth: '', order: '' }))).toBe(false);
  });

  it('marker 只看名字和卡字段,role / 正文不算', () => {
    const m = markerBlock();
    const src = cardSource('骑士团长');
    const md = draftOf(m, src);
    expect(isDraftDirty(m, src, md)).toBe(false);
    expect(isDraftDirty(m, src, edit(md, { role: 'user', content: 'x' }))).toBe(false);
    expect(isDraftDirty(m, src, edit(md, { name: '描述' }))).toBe(true);
    expect(isDraftDirty(m, src, edit(md, { cardValue: '骑士' }))).toBe(true);
  });
});

describe('blockPatchOf', () => {
  it('文本块整块写回,数字按框里的字换算', () => {
    const p = block();
    const d = edit(draftOf(p, null), { content: '新正文', absolute: true, depth: '1', order: '' });
    expect(blockPatchOf(p, d)).toEqual({
      name: '文风',
      role: 'system',
      content: '新正文',
      forbidOverrides: false,
      injectionPosition: 1,
      injectionDepth: 1,
      injectionOrder: 100,
    });
  });

  it('文本块没改也整块写回(Ctrl+Enter 一直能确定)', () => {
    const p = block();
    expect(blockPatchOf(p, draftOf(p, null))).not.toBeNull();
  });

  it('marker 只写名字,名字没改就是 null', () => {
    const m = markerBlock();
    const d = draftOf(m, null);
    expect(blockPatchOf(m, d)).toBeNull();
    expect(blockPatchOf(m, edit(d, { name: '描述', content: 'x' }))).toEqual({ name: '描述' });
  });
});

describe('changedFields', () => {
  const p = block();
  const d = draftOf(p, null);

  it('原样是 null', () => {
    expect(changedFields(p, d)).toBeNull();
  });

  it('只挑变了的字段', () => {
    expect(changedFields(p, edit(d, { content: '新正文' }))).toEqual({ content: '新正文' });
    expect(changedFields(p, edit(d, { name: '新名', role: 'assistant' }))).toEqual({
      name: '新名',
      role: 'assistant',
    });
    expect(changedFields(p, edit(d, { forbidOverrides: true }))).toEqual({ forbidOverrides: true });
    expect(changedFields(p, edit(d, { absolute: true }))).toEqual({ injectionPosition: 1 });
    expect(changedFields(p, edit(d, { depth: '0', order: '7' }))).toEqual({
      injectionDepth: 0,
      injectionOrder: 7,
    });
  });

  it('数字框打到一半不写', () => {
    expect(changedFields(p, edit(d, { depth: '', order: 'x' }))).toBeNull();
  });

  it('切回「按编排」写 0', () => {
    const abs = block({ injectionPosition: 1 });
    expect(changedFields(abs, edit(draftOf(abs, null), { absolute: false }))).toEqual({
      injectionPosition: 0,
    });
  });

  it('marker 只写名字', () => {
    const m = markerBlock();
    const md = draftOf(m, null);
    expect(changedFields(m, edit(md, { role: 'user', content: 'x', depth: '1' }))).toBeNull();
    expect(changedFields(m, edit(md, { name: '描述' }))).toEqual({ name: '描述' });
  });
});

describe('shownCount', () => {
  it('框里的字和块对得上就照旧显示,包括打到一半的空串', () => {
    expect(shownCount('4', 4)).toBe('4');
    expect(shownCount('', 4)).toBe('');
    expect(shownCount('04', 4)).toBe('04');
  });

  it('对不上(块被外面改了)换成块里的数', () => {
    expect(shownCount('4', 9)).toBe('9');
    expect(shownCount('12', 1)).toBe('1');
  });
});

describe('cardPatchOf', () => {
  it('卡填的 marker 改了值才出补丁,键是卡字段', () => {
    const m = markerBlock();
    const src = cardSource('骑士团长');
    const d = draftOf(m, src);
    expect(cardPatchOf(m, src, d)).toBeNull();
    expect(cardPatchOf(m, src, edit(d, { cardValue: '骑士' }))).toEqual({ description: '骑士' });
  });

  it('不是卡填的 marker、或者不是 marker,永远是 null', () => {
    const m = markerBlock();
    const d = edit(draftOf(m, null), { cardValue: 'x' });
    expect(cardPatchOf(m, null, d)).toBeNull();
    expect(cardPatchOf(m, { kind: 'elsewhere', label: 'a', hint: 'b' }, d)).toBeNull();
    expect(cardPatchOf(block(), cardSource('骑士团长'), d)).toBeNull();
  });
});

describe('canDeleteBlock', () => {
  it('只有用户自建的文本块能删', () => {
    expect(canDeleteBlock(block())).toBe(true);
    expect(canDeleteBlock(block({ systemPrompt: true }))).toBe(false);
    expect(canDeleteBlock(markerBlock())).toBe(false);
  });
});
