import { describe, expect, it } from 'vitest';
import type { PackSprite } from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import { manualAt, manualEmotions, manualLabel, manualOf, setManual } from './manualMarks';

const entry = (over: Partial<ChatEntry> = {}): ChatEntry => ({
  id: 'a',
  role: 'assistant',
  swipes: ['一', '二'],
  swipeIndex: 1,
  swipeInfo: [{ sendDate: 'x' }, { sendDate: 'y', model: 'm1' }],
  overswipe: 'regenerate',
  ...over,
});

const sprite = (id: string, label: string) => ({ id, label }) as unknown as PackSprite;
const SPRITES = [sprite('s1', '微笑'), sprite('s2', '害羞')];

describe('setManual', () => {
  it('writes the mark into the swipe being shown only, keeping the rest of swipe_info and vn', () => {
    const e = entry({
      swipeInfo: [
        { sendDate: 'x', vn: { forms: [{ line: 0, form: 'h' }] } },
        { sendDate: 'y', model: 'm1', vn: { forms: [{ line: 1, form: 'h' }] } },
      ],
    });
    const next = setManual(e, 2, { item: 's2', label: '害羞' });
    expect(next.swipeInfo).toEqual([
      { sendDate: 'x', vn: { forms: [{ line: 0, form: 'h' }] } },
      {
        sendDate: 'y',
        model: 'm1',
        vn: { forms: [{ line: 1, form: 'h' }], manual: [{ line: 2, item: 's2', label: '害羞' }] },
      },
    ]);
    expect(next.swipeInfo[0]).toBe(e.swipeInfo[0]);
    expect(e.swipeInfo[1].vn).toEqual({ forms: [{ line: 1, form: 'h' }] }); // 原来的对象不动
  });

  it('replaces the mark on the same line and keeps the others in line order', () => {
    let e = setManual(entry(), 5, { item: 's1', label: '微笑' });
    e = setManual(e, 1, { item: 's1', label: '微笑' });
    e = setManual(e, 5, { item: 's2', label: '害羞' });
    expect(manualOf(e)).toEqual([
      { line: 1, item: 's1', label: '微笑' },
      { line: 5, item: 's2', label: '害羞' },
    ]);
  });

  it('null removes the mark on that line; the last one gone leaves no manual key (and no empty vn)', () => {
    const forms = { forms: [{ line: 0, form: 'h' }] };
    const marked = setManual(entry({ swipeInfo: [{ sendDate: 'x' }, { sendDate: 'y', vn: forms }] }), 3, {
      item: 's1',
      label: '微笑',
    });
    expect(setManual(marked, 3, null).swipeInfo[1]).toEqual({ sendDate: 'y', vn: forms });
    const plain = setManual(entry(), 3, { item: 's1', label: '微笑' });
    expect(setManual(plain, 3, null).swipeInfo[1]).toEqual({ sendDate: 'y', model: 'm1' });
  });

  it('null on a line without a mark changes nothing (same object, nothing to save)', () => {
    const e = setManual(entry(), 3, { item: 's1', label: '微笑' });
    expect(setManual(e, 4, null)).toBe(e);
    const plain = entry();
    expect(setManual(plain, 0, null)).toBe(plain);
  });
});

describe('manualOf / manualAt', () => {
  it('reads the swipe being shown; none is undefined', () => {
    const e = setManual(entry(), 2, { item: 's1', label: '微笑' });
    expect(manualOf(e)).toEqual([{ line: 2, item: 's1', label: '微笑' }]);
    expect(manualOf({ ...e, swipeIndex: 0 })).toBeUndefined();
    expect(manualOf(entry())).toBeUndefined();
  });

  it('gives back the stored array itself, so the timeline can tell by reference whether it changed', () => {
    const e = setManual(entry(), 2, { item: 's1', label: '微笑' });
    expect(manualOf(e)).toBe(e.swipeInfo[1].vn?.manual);
  });

  it('finds the mark of one line and skips malformed ones', () => {
    const marks = [
      { line: 1, item: 7, label: '微笑' },
      { line: 2, item: 's1', label: '微笑' },
      null,
    ] as never;
    expect(manualAt(marks, 1)).toBeUndefined();
    expect(manualAt(marks, 2)).toEqual({ line: 2, item: 's1', label: '微笑' });
    expect(manualAt(marks, 3)).toBeUndefined();
    expect(manualAt(undefined, 0)).toBeUndefined();
  });
});

describe('manualLabel', () => {
  it('finds the sprite by id first and uses its name now (renamed since)', () => {
    expect(manualLabel({ line: 0, item: 's2', label: '旧名字' }, SPRITES)).toBe('害羞');
  });

  it('falls back to the name, and is null when neither is there (sprite removed or turned off)', () => {
    expect(manualLabel({ line: 0, item: 'gone', label: '微笑' }, SPRITES)).toBe('微笑');
    expect(manualLabel({ line: 0, item: 'gone', label: '不存在' }, SPRITES)).toBeNull();
  });

  it('a card without sprites takes the built-in expressions', () => {
    expect(manualLabel({ line: 0, item: '开心', label: '开心' }, [])).toBe('开心');
    expect(manualLabel({ line: 0, item: '乱写的', label: '乱写的' }, [])).toBeNull();
    // 有立绘的卡不认内置表情
    expect(manualLabel({ line: 0, item: '开心', label: '开心' }, SPRITES)).toBeNull();
  });
});

describe('manualEmotions (what the voice reads)', () => {
  it('is undefined without marks, so the voice plan stays exactly as before', () => {
    expect(manualEmotions(undefined, SPRITES)).toBeUndefined();
    expect(manualEmotions([], SPRITES)).toBeUndefined();
  });

  it('gives the resolved name of each marked line, undefined elsewhere and for ones that no longer resolve', () => {
    const at = manualEmotions(
      [
        { line: 1, item: 's2', label: '旧名字' },
        { line: 3, item: 'gone', label: '不存在' },
      ],
      SPRITES,
    );
    expect([0, 1, 2, 3].map((i) => at?.(i))).toEqual([undefined, '害羞', undefined, undefined]);
  });
});
