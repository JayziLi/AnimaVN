/**
 * 「高级 · 问法」页签(第 2 步 D7)的纯逻辑:每道题后端真会代入哪几个宏、点宏小块插到光标处。
 * 宏的名单照后端出题时实际代入的(AnimaBackend/app/annotate/judge.py 的 _prompt 调用),别照画布猜:
 * 每道题都有 {{char}} {{user}};场景 / 音乐题没有 {{line}};「不换」的说明没有 {{n}};CG 的「不换」没有 {{current_desc}}。
 */

export type MacroName = 'n' | 'line' | 'char' | 'user' | 'current' | 'current_desc';

export const MACRO_HINT: Record<MacroName, string> = {
  n: '第几句',
  line: '这句原文',
  char: '角色名',
  user: '玩家名',
  current: '现在的那个',
  current_desc: '它的说明',
};

/** 问法的键(后端 DEFAULT_PROMPTS 的键)→ 这道题会代入的宏 */
export const PROMPT_MACROS: Readonly<Record<string, readonly MacroName[]>> = {
  emotion: ['n', 'line', 'char', 'user'],
  bg: ['n', 'current', 'current_desc', 'char', 'user'],
  bgm: ['n', 'current', 'current_desc', 'char', 'user'],
  bg_keep: ['current', 'current_desc', 'char', 'user'],
  bgm_keep: ['current', 'current_desc', 'char', 'user'],
  cg: ['n', 'line', 'char', 'user'],
  cg_keep: ['current', 'char', 'user'],
  cg_off: ['char', 'user'],
};

/** 问「第几句」的题:没写 {{n}} 时 Jev 不知道问的是哪一句 */
export const NEEDS_N: ReadonlySet<string> = new Set(['emotion', 'bg', 'bgm', 'cg']);

/** 在光标处(选中的话替换选中的)插一个宏;返回新的正文和插完以后的光标位置 */
export function insertMacro(text: string, start: number, end: number, macro: MacroName): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  const token = `{{${macro}}}`;
  return { text: text.slice(0, a) + token + text.slice(b), caret: a + token.length };
}

/** 改过的问法交出去的值:空的、和默认一样的算没改(null) */
export const promptValue = (draft: string, def: string | null): string | null =>
  !draft.trim() || draft === def ? null : draft;
