import { expect, it } from 'vitest';
import { skipChipLabel } from './skipChip';

it('tells you how to stop skipping', () => {
  expect(skipChipLabel(true)).toBe('跳过中 · 松开 Ctrl 停');
  expect(skipChipLabel(false)).toBe('跳过中 · 点一下停');
});
