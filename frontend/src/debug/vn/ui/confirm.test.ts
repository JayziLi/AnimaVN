import { describe, expect, it, vi } from 'vitest';
import { createConfirmer, type ConfirmRequest } from './confirm';

const opts = { title: '删掉这张卡?', message: '确定删除角色卡「星绘」?' };

function setup(gameOpen: boolean, system = true) {
  const shown: (ConfirmRequest | null)[] = [];
  const sys = vi.fn(() => system);
  const c = createConfirmer({ gameOpen: () => gameOpen, system: sys, show: (r) => shown.push(r) });
  return { c, shown, sys };
}

describe('createConfirmer', () => {
  it('游戏没开:照旧问 window.confirm,不画纸卡', async () => {
    const { c, shown, sys } = setup(false, true);
    await expect(c.ask(opts)).resolves.toBe(true);
    expect(sys).toHaveBeenCalledWith(opts.message);
    expect(shown).toEqual([]);
    const no = setup(false, false);
    await expect(no.c.ask(opts)).resolves.toBe(false);
  });

  it('游戏开着:画纸卡,点「删除」才是 true', async () => {
    const { c, shown, sys } = setup(true);
    const p = c.ask(opts);
    expect(sys).not.toHaveBeenCalled();
    expect(shown).toHaveLength(1);
    expect(shown[0]?.options).toBe(opts);
    expect(c.open).toBe(true);
    c.settle('delete');
    await expect(p).resolves.toBe(true);
    expect(shown[1]).toBeNull();
    expect(c.open).toBe(false);
  });

  it.each(['keep', 'esc', 'outside'] as const)('游戏开着:%s 都是不做', async (reason) => {
    const { c } = setup(true);
    const p = c.ask(opts);
    c.settle(reason);
    await expect(p).resolves.toBe(false);
  });

  it('已经有一个在问时,再问一个直接当不做(不叠第二层),原来那个不受影响', async () => {
    const { c, shown } = setup(true);
    const first = c.ask(opts);
    await expect(c.ask(opts)).resolves.toBe(false);
    expect(shown).toHaveLength(1);
    c.settle('delete');
    await expect(first).resolves.toBe(true);
  });

  it('没有在问时 settle 什么都不做', () => {
    const { c, shown } = setup(true);
    c.settle('delete');
    expect(shown).toEqual([]);
  });
});
