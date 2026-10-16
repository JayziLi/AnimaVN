import { describe, expect, it } from 'vitest';
import { dropLabel, dropTarget, readDropTarget, slotKind, NO_TARGET } from './dropTarget';

// 假的元素:只认 getAttribute,属性就是 dropTarget 给的那几个
const el = (attrs: Record<string, string>) => ({ getAttribute: (k: string) => attrs[k] ?? null });

describe('dropTarget / readDropTarget', () => {
  it('round-trips a card target', () => {
    expect(readDropTarget(el(dropTarget('c1', '刻晴')))).toEqual({ cardId: 'c1', cardName: '刻晴', kind: null });
  });

  it('round-trips a slot target (card + kind)', () => {
    expect(readDropTarget(el(dropTarget('c1', '刻晴', 'bgm')))).toEqual({ cardId: 'c1', cardName: '刻晴', kind: 'bgm' });
  });

  it('treats a missing or unknown kind as no kind, and a blank name as no name', () => {
    expect(readDropTarget(el({ 'data-drop-card': 'c1', 'data-drop-kind': 'voice', 'data-drop-name': ' ' }))).toEqual({
      cardId: 'c1',
      cardName: null,
      kind: null,
    });
  });

  it('reads nothing from an element that is not a target', () => {
    expect(readDropTarget(el({}))).toEqual(NO_TARGET);
    expect(readDropTarget(null)).toEqual(NO_TARGET);
  });
});

describe('dropLabel', () => {
  it('says what letting go will do', () => {
    expect(dropLabel(NO_TARGET)).toBe('松手就导入');
    expect(dropLabel({ cardId: 'c1', cardName: '刻晴', kind: null })).toBe('松手:给刻晴加素材');
    expect(dropLabel({ cardId: 'c1', cardName: '刻晴', kind: 'sprite' })).toBe('松手:都当立绘,加给刻晴');
    expect(dropLabel({ cardId: 'c1', cardName: null, kind: 'bg' })).toBe('松手:都当背景,加给这张卡');
    expect(dropLabel({ cardId: 'c1', cardName: '刻晴', kind: 'bgm' })).toBe('松手:都当 BGM,加给刻晴');
  });
});

describe('slotKind', () => {
  it('maps the four droppable slots to their kind and the rest to none', () => {
    expect(['sprite', 'bg', 'bgm', 'cg', 'voice', 'ai'].map((s) => slotKind(s as never))).toEqual([
      'sprite',
      'bg',
      'bgm',
      'cg',
      null,
      null,
    ]);
  });
});
