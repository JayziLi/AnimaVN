import { describe, expect, it } from 'vitest';
import type { AssemblyResult } from './assembler';
import { dropSwipe, toStored, type ChatEntry } from './chatEntry';

const snap = { messages: [] } as unknown as AssemblyResult;

const entry = (): ChatEntry =>
  ({
    id: 'm1',
    role: 'assistant',
    swipes: ['a', 'b'],
    swipeIndex: 1,
    swipeInfo: [
      { sendDate: '1', snapshot: snap, snapshotHash: 'h1' },
      { sendDate: '2', snapshot: snap, snapshotHash: 'h2' },
    ],
  }) as unknown as ChatEntry;

describe('toStored', () => {
  it('sends every snapshot when nothing is known to be saved', () => {
    const out = toStored(entry(), 3);
    expect(out.swipe_info.map((i) => Boolean(i.snapshot))).toEqual([true, true]);
    expect(out.idx).toBe(3);
  });

  it('drops snapshots the backend already has but keeps their hashes', () => {
    const out = toStored(entry(), 0, new Set(['h1']));
    const sent = JSON.parse(JSON.stringify(out.swipe_info));
    expect(sent[0]).toEqual({ sendDate: '1', snapshotHash: 'h1' });
    expect(sent[1].snapshot).toBeDefined();
  });

  it('does not touch the in-memory entry', () => {
    const e = entry();
    toStored(e, 0, new Set(['h1', 'h2']));
    expect(e.swipeInfo[0].snapshot).toBe(snap);
  });
});

describe('dropSwipe', () => {
  const three = (at: number): ChatEntry =>
    ({ ...entry(), swipes: ['a', 'b', 'c'], swipeIndex: at, swipeInfo: [{}, {}, {}] }) as unknown as ChatEntry;

  it('removing the one on screen shows its neighbour', () => {
    expect(dropSwipe(three(2), 2).swipeIndex).toBe(1);
    expect(dropSwipe(three(0), 0).swipeIndex).toBe(0);
  });

  it('removing another one keeps the one on screen', () => {
    const e = dropSwipe(three(0), 2);
    expect(e.swipes[e.swipeIndex]).toBe('a');
    const f = dropSwipe(three(2), 0);
    expect(f.swipes[f.swipeIndex]).toBe('c');
  });
});
