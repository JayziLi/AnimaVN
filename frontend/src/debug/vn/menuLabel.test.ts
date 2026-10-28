import { describe, expect, it } from 'vitest';
import { chatLabel, menuCrumb, parseChatName, saveTitle } from './menuLabel';

describe('menuLabel', () => {
  it('reads the default chat name the backend gives (card - timestamp)', () => {
    expect(parseChatName('测试角色 - 2026-10-27@16h44m21s425ms')).toEqual({ base: '测试角色', date: '10-27', branch: null });
    expect(parseChatName('星绘 - 2026-10-18@09h05m07s004ms - Branch #3')).toEqual({ base: '星绘', date: '10-18', branch: 3 });
    expect(parseChatName('夜路的约会')).toBeNull();
  });
  it('crumb is character · scene · short date, not the raw save id', () => {
    expect(menuCrumb('测试角色', '测试角色 - 2026-10-27@16h44m21s425ms', '客厅')).toBe('测试角色 · 客厅 · 10-27');
    expect(menuCrumb('测试角色', '测试角色 - 2026-10-27@16h44m21s425ms')).toBe('测试角色 · 10-27');
    expect(menuCrumb('星绘', '星绘 - 2026-10-18@09h05m07s004ms', '夜路', true)).toBe('星绘 · 上次 夜路 · 10-18');
    expect(menuCrumb('星绘', '星绘 - 2026-10-18@09h05m07s004ms - Branch #2', '夜路')).toBe('星绘 · 夜路 · 分支 2 · 10-18');
  });
  it('a renamed chat keeps its own name', () => {
    expect(menuCrumb('星绘', '夜路的约会', '夜路')).toBe('星绘 · 夜路 · 夜路的约会');
    expect(menuCrumb('', '')).toBe('还没选角色');
    expect(chatLabel('夜路的约会', '星绘')).toBe('夜路的约会');
    expect(chatLabel('星绘 - 2026-10-18@09h05m07s004ms', '星绘')).toBe('星绘');
    expect(chatLabel('星绘 - 2026-10-18@09h05m07s004ms - Branch #4', '星绘')).toBe('星绘 · 分支 4');
  });
  it('save titles elsewhere read 卡名 · 日子', () => {
    expect(saveTitle('测试角色 - 2026-10-27@03h51m36s394ms')).toBe('测试角色 · 10-27');
    expect(saveTitle('星绘 - 2026-10-18@09h05m07s004ms - Branch #2')).toBe('星绘 · 分支 2 · 10-18');
    expect(saveTitle('夜路')).toBe('夜路');
  });
});
