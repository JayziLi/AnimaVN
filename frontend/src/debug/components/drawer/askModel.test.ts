import { describe, expect, it } from 'vitest';
import { NEEDS_N, PROMPT_MACROS, insertMacro, promptValue } from './askModel';

describe('问法页签的宏', () => {
  it('每道题都有角色名和玩家名;场景 / 音乐题没有这句原文;「不换」的说明没有第几句', () => {
    for (const macros of Object.values(PROMPT_MACROS)) {
      expect(macros).toContain('char');
      expect(macros).toContain('user');
    }
    expect(PROMPT_MACROS.bg).not.toContain('line');
    expect(PROMPT_MACROS.bgm).not.toContain('line');
    expect(PROMPT_MACROS.bg_keep).not.toContain('n');
    expect(PROMPT_MACROS.cg_keep).not.toContain('current_desc');
    expect(PROMPT_MACROS.cg_off).toEqual(['char', 'user']);
  });

  it('要问第几句的题才要求写 {{n}}', () => {
    expect([...NEEDS_N].sort()).toEqual(['bg', 'bgm', 'cg', 'emotion']);
  });

  it('插在光标处,选中的被替换,光标落在宏后面', () => {
    expect(insertMacro('第 句', 2, 2, 'n')).toEqual({ text: '第 {{n}}句', caret: 7 });
    expect(insertMacro('ab', 0, 2, 'char')).toEqual({ text: '{{char}}', caret: 8 });
    expect(insertMacro('ab', 9, 9, 'user')).toEqual({ text: 'ab{{user}}', caret: 10 });
  });

  it('空的、和默认一样的算没改', () => {
    expect(promptValue('  ', '默认')).toBeNull();
    expect(promptValue('默认', '默认')).toBeNull();
    expect(promptValue('改了', '默认')).toBe('改了');
    expect(promptValue('改了', null)).toBe('改了');
  });
});
