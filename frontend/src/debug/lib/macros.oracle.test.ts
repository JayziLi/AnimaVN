/**
 * 和酒馆对答案。
 *
 * 样本文件夹里的 macro-oracle/cases.json 是 203 个社区预设的全部启用块、加上样本卡的文字;
 * expected.json 是把酒馆 1.18 的宏引擎原样放进 node 里跑出来的结果(随机数钉成 0)。
 * 这里把同样的文本喂给我们的引擎,要求逐字相同、跑完之后变量也相同。
 *
 * 文件夹不在(别的机器)就跳过。怎么重新生成 expected.json 见设计文档。
 */
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MACRO_REGISTRY } from './macroDefs';
import { evaluateMacros, type MacroEnv } from './macroEngine';

/**
 * 对照用的那台「酒馆引擎」只装了核心宏,没装自带扩展(总结、作者注释、画图、思考标记)注册的那几个,
 * 所以这里也拿掉再比。那几个在整条链路的对照(tavern.e2e.test.ts)里有真酒馆把关。
 */
const EXTENSION_MACROS = [
  'summary',
  'authorsNote',
  'charAuthorsNote',
  'defaultAuthorsNote',
  'reasoningPrefix',
  'reasoningSuffix',
  'reasoningSeparator',
  'charPrefix',
  'charNegativePrefix',
].map((name) => name.toLowerCase());
const CORE_REGISTRY = new Map([...MACRO_REGISTRY].filter(([key]) => !EXTENSION_MACROS.includes(key)));

const DIR =
  process.env.MACRO_ORACLE ?? join(homedir(), 'Desktop', '角色素材', '_酒馆卡样本', 'macro-oracle');

interface Case {
  id: string;
  texts: string[];
  env: Record<string, string> & { alternateGreetings: string[] };
  chat: { is_user: boolean; mes: string }[];
}
interface Expected {
  id: string;
  outs: string[];
  local: Record<string, string | number>;
  global: Record<string, string | number>;
}

/** 时间类的宏两边区域设置不同、时刻也不同,比不了 */
const TIME = /\{\{\s*(time|date|weekday|isotime|isodate|datetimeformat|idle_?duration|timediff)\b/i;

function envFor(c: Case): MacroEnv {
  const e = c.env;
  return {
    names: { user: e.user, char: e.char, group: e.char, groupNotMuted: e.char, notChar: e.user },
    character: {
      charPrompt: e.charPrompt,
      charInstruction: e.charInstruction,
      description: e.description,
      personality: e.personality,
      scenario: e.scenario,
      persona: e.persona,
      mesExamplesRaw: e.mesExamplesRaw,
      version: e.version,
      charDepthPrompt: e.charDepthPrompt,
      creatorNotes: e.creatorNotes,
      firstMessage: e.firstMessage,
      alternateGreetings: e.alternateGreetings,
    },
    model: e.model,
    chat: {
      id: 'chat-1',
      messages: c.chat.map((m) => ({ isUser: m.is_user, text: m.mes, swipes: undefined })),
      firstIncludedId: null,
      firstDisplayedId: 0,
    },
    limits: { maxPrompt: 8192, maxContext: 16384, maxResponse: 1024 },
    input: '',
    lastGenerationType: '',
    isMobile: false,
    original: () => '',
    outlets: {},
    vars: { local: {}, global: {} },
    custom: {},
    random: () => 0,
    now: () => new Date(),
  };
}

const ready = existsSync(join(DIR, 'cases.json')) && existsSync(join(DIR, 'expected.json'));

describe.skipIf(!ready)('和酒馆的宏引擎对答案', () => {
  const cases: Case[] = ready ? JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf-8')) : [];
  const expected: Expected[] = ready
    ? JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf-8'))
    : [];

  it(`${cases.length} 个预设 / 卡,逐段相同`, () => {
    let total = 0;
    const mismatches: string[] = [];
    const varMismatches: string[] = [];

    cases.forEach((c, ci) => {
      const want = expected[ci];
      const env = envFor(c);
      c.texts.forEach((text, ti) => {
        const got = evaluateMacros(text, env, CORE_REGISTRY);
        if (TIME.test(text)) return;
        total++;
        if (got === want.outs[ti]) return;
        if (mismatches.length < 12) {
          let at = 0;
          while (at < got.length && got[at] === want.outs[ti][at]) at++;
          const show = (s: string) => JSON.stringify(s.slice(Math.max(0, at - 50), at + 90));
          mismatches.push(
            `${c.id} #${ti} @${at}\n   酒馆: ${show(want.outs[ti])}\n   我们: ${show(got)}`,
          );
        } else {
          mismatches.push('');
        }
      });

      const norm = (o: Record<string, unknown>) =>
        JSON.stringify(Object.keys(o).sort().map((k) => [k, String(o[k])]));
      if (norm(env.vars.local) !== norm(want.local) && varMismatches.length < 5) {
        const ours = env.vars.local;
        const keys = [...new Set([...Object.keys(ours), ...Object.keys(want.local)])].filter(
          (k) => String(ours[k]) !== String(want.local[k]),
        );
        varMismatches.push(
          `${c.id}: ${keys
            .slice(0, 4)
            .map((k) => `${k} 酒馆=${JSON.stringify(want.local[k])} 我们=${JSON.stringify(ours[k])}`)
            .join('; ')}`,
        );
      }
    });

    const report = [
      `比了 ${total} 段,不同 ${mismatches.length} 段`,
      ...mismatches.filter(Boolean),
      ...varMismatches.map((v) => `变量不同 ${v}`),
    ].join('\n');
    expect(mismatches.length + varMismatches.length, report).toBe(0);
  });
});
