import { describe, expect, it } from 'vitest';
import { optionGroups } from './pageModel';

type Opt = { id: string; group?: string };
const groups = (options: Opt[]) => optionGroups(options);

describe('optionGroups', () => {
  it('does not group when there is one group or none', () => {
    expect(groups([{ id: 'a' }, { id: 'b' }])).toEqual([{ label: null, items: [{ id: 'a' }, { id: 'b' }] }]);
    expect(groups([{ id: 'a', group: 'x' }, { id: 'b', group: 'x' }])).toHaveLength(1);
    expect(groups([{ id: 'a', group: 'x' }])[0].label).toBeNull();
  });
  it('splits into runs by group label', () => {
    const g = groups([
      { id: 'a', group: 'x' },
      { id: 'b', group: 'y' },
      { id: 'c', group: 'y' },
    ]);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['x', ['a']],
      ['y', ['b', 'c']],
    ]);
  });
});
