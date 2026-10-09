import { describe, expect, it } from 'vitest';
import { MACRO_DEFS, MACRO_REGISTRY, formatDate, humanizeDuration } from './macroDefs';
import { evaluateMacros, trimScopedContent, type MacroEnv } from './macroEngine';
import fixture from './macros.fixture.json';
import { BUILTIN_MACROS, buildMacroContext, findUnresolvedMacros, substituteMacros } from './macros';

function env(over: Partial<MacroEnv> = {}): MacroEnv {
  const e = fixture.env;
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
      messages: fixture.chat.map((m) => ({ isUser: m.is_user, text: m.mes })),
      firstIncludedId: null,
      firstDisplayedId: 0,
    },
    limits: { maxPrompt: 8192, maxContext: 16384, maxResponse: 1024 },
    input: '',
    lastGenerationType: '',
    isMobile: false,
    original: () => e.original,
    outlets: {},
    vars: { local: {}, global: {} },
    custom: {},
    random: () => 0,
    now: () => new Date(2026, 8, 30, 15, 4, 5),
    ...over,
  };
}

const run = (text: string, e = env()) => evaluateMacros(text, e, MACRO_REGISTRY);

/**
 * 每一条的期望值都是酒馆自己的引擎算出来的(见 fixture 里的 note)。
 * 同一组里的文本依次求值、共用变量,和预设里块与块的关系一样。
 */
describe('和酒馆一致(边界情况)', () => {
  for (const group of fixture.cases) {
    describe(group.id, () => {
      const e = env();
      group.texts.forEach((text, i) => {
        it(JSON.stringify(text).slice(0, 90), () => {
          expect(run(text, e)).toBe(group.expected[i]);
        });
      });
      it('跑完之后变量相同', () => {
        const flat = (o: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
        expect(flat(e.vars.local)).toEqual(flat(group.local));
        expect(flat(e.vars.global)).toEqual(flat(group.global));
      });
    });
  }
});

describe('我们自己的部分', () => {
  it('玩家自定的宏可以是中文名,值里还能再套宏', () => {
    const e = env({ custom: { 口头禅: '{{char}}说:哼', nick: '小{{user}}' } });
    expect(run('{{口头禅}} {{ 口头禅 }} {{nick}} {{NICK}}', e)).toBe('C说:哼 C说:哼 小U 小U');
  });

  it('内置宏优先,自定义占不到它的名字', () => {
    expect(run('{{char}}', env({ custom: { char: '冒牌' } }))).toBe('C');
  });

  it('卡的字段里有宏,取出来时一并求值', () => {
    const e = env();
    e.character.description = '{{char}}怕猫';
    expect(run('[{{description}}]', e)).toBe('[C怕猫]');
  });

  it('{{bot}} 是 {{char}} 的别名(酒馆新引擎里没有,我们留着)', () => {
    expect(run('{{bot}}')).toBe('C');
  });

  it('出口宏读世界书的自定义出口', () => {
    expect(run('[{{outlet::成就}}]', env({ outlets: { 成就: '屠龙者' } }))).toBe('[屠龙者]');
  });

  it('骰子:几个几面加减几', () => {
    const high = env({ random: () => 0.999 });
    expect(run('{{roll:1d100}} {{roll:2d6+3}} {{roll 20}} {{roll:d4-1}}', high)).toBe('100 15 20 3');
  });

  it('{{pick}} 同一处每次挑到同一个,换个位置可以不同', () => {
    const e = env();
    let calls = 0;
    e.random = (key) => {
      calls++;
      return key.length % 2 ? 0.1 : 0.9;
    };
    const a = run('{{pick::甲::乙}}', e);
    expect(run('{{pick::甲::乙}}', e)).toBe(a);
    expect(calls).toBe(2);
  });
});

describe('时间', () => {
  const at = new Date(2026, 8, 30, 15, 4, 5); // 周三
  it('各种写法', () => {
    const e = env({ now: () => at });
    expect(run('{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}', e)).toBe(
      '15:04|2026年9月30日|星期三|15:04|2026-09-30',
    );
    expect(run('{{datetimeformat::YYYY-MM-DD HH:mm:ss}}', e)).toBe('2026-09-30 15:04:05');
    expect(run('{{datetimeformat::[今天是] M月D日 dddd A h点}}', e)).toBe('今天是 9月30日 星期三 下午 3点');
  });

  it('指定时区', () => {
    const utcNoon = new Date(Date.UTC(2026, 8, 30, 12, 0, 0));
    const e = env({ now: () => utcNoon });
    expect(run('{{time::UTC+8}} {{time_UTC-5}} {{time::UTC+0}}', e)).toBe('20:00 07:00 12:00');
  });

  it('格式串', () => {
    expect(formatDate(at, 'YY/M/D H:m:s')).toBe('26/9/30 15:4:5');
    expect(formatDate(at, 'LL LT')).toBe('2026年9月30日 15:04');
  });

  it('时长说成人话', () => {
    expect(humanizeDuration(10_000)).toBe('几秒');
    expect(humanizeDuration(60_000)).toBe('1 分钟');
    expect(humanizeDuration(30 * 60_000)).toBe('30 分钟');
    expect(humanizeDuration(5 * 3600_000)).toBe('5 小时');
    expect(humanizeDuration(3 * 86400_000)).toBe('3 天');
    expect(humanizeDuration(400 * 86400_000)).toBe('1 年');
  });

  it('离上次发言多久 / 两个时间差多久', () => {
    const e = env({ now: () => at });
    e.chat.messages = [
      { isUser: true, text: '早', sentAt: at.getTime() - 2 * 3600_000 },
      { isUser: false, text: '早安' },
      { isUser: true, text: '我回来了' },
    ];
    expect(run('{{idleDuration}} {{idle_duration}}', e)).toBe('2 小时 2 小时');
    expect(run('{{timeDiff::2026-01-01 15:00::2026-01-01 12:00}}', e)).toBe('3 小时后');
    expect(run('{{timeDiff::2026-01-01 12:00::2026-01-01 15:00}}', e)).toBe('3 小时前');
  });
});

describe('对外入口', () => {
  const ctx = () =>
    buildMacroContext({
      card: { name: '艾琳', description: '骑士', personality: '认真', scenario: '王都' },
      userName: '旅人',
      personaDescription: '过路人',
      history: [
        { role: 'assistant', content: '你好' },
        { role: 'user', content: '走吧' },
      ],
      variables: { local: { 好感度: 3 }, global: {} },
    });

  it('默认不改变量:显示用的求值不留痕迹', () => {
    const c = ctx();
    expect(substituteMacros('{{incvar::好感度}}', c)).toBe('4');
    expect(substituteMacros('{{incvar::好感度}}', c)).toBe('4');
    expect(c.vars?.local.好感度).toBe(3);
  });

  it('mutate 时改的是这份上下文自己的变量', () => {
    const c = ctx();
    substituteMacros('{{incvar::好感度}}{{setvar::心情::好}}', c, { mutate: true });
    expect(c.vars?.local).toEqual({ 好感度: 4, 心情: '好' });
  });

  it('传进去的变量会被复制,不会被改到', () => {
    const mine = { local: { a: 1 }, global: {} };
    const c = buildMacroContext({ card: null, userName: '', personaDescription: '', history: [], variables: mine });
    substituteMacros('{{setvar::a::2}}', c, { mutate: true });
    expect(mine.local.a).toBe(1);
  });

  it('定了种子,同一条消息每次掷出同一个数', () => {
    const c = ctx();
    const once = substituteMacros('{{roll:1d1000}} {{random::a::b::c::d::e::f}}', c, { seed: 'msg-1' });
    expect(substituteMacros('{{roll:1d1000}} {{random::a::b::c::d::e::f}}', c, { seed: 'msg-1' })).toBe(once);
  });

  it('聊天记录类的宏读得到历史', () => {
    expect(substituteMacros('{{lastUserMessage}}|{{lastCharMessage}}|{{lastMessageId}}', ctx())).toBe('走吧|你好|1');
  });

  it('没解析掉的宏能找出来', () => {
    expect(findUnresolvedMacros(substituteMacros('{{char}} {{没有这个}} {{foo::1}}', ctx()))).toEqual([
      '{{没有这个}}',
      '{{foo::1}}',
    ]);
  });
});

describe('总表', () => {
  it('酒馆 1.18 登记过的宏一个不少', () => {
    // 名单取自酒馆 public/scripts/macros/definitions/ 下各文件的 registerMacro 调用
    const tavern = [
      'space', 'newline', 'noop', 'trim', 'if', 'else', 'input', 'maxPrompt', 'maxContext', 'maxResponse',
      'reverse', '//', 'roll', 'random', 'pick', 'banned', 'outlet',
      'user', 'char', 'group', 'groupNotMuted', 'notChar', 'charPrompt', 'charInstruction', 'charDescription',
      'charPersonality', 'charScenario', 'persona', 'mesExamplesRaw', 'mesExamples', 'charDepthPrompt',
      'charCreatorNotes', 'charFirstMessage', 'charVersion', 'model', 'original', 'isMobile',
      'lastGenerationType', 'hasExtension',
      'lastMessage', 'lastMessageId', 'lastUserMessage', 'lastCharMessage', 'firstIncludedMessageId',
      'firstDisplayedMessageId', 'lastSwipeId', 'currentSwipeId', 'allChatRange',
      'time', 'date', 'weekday', 'isotime', 'isodate', 'datetimeformat', 'idleDuration', 'timeDiff',
      'setvar', 'addvar', 'incvar', 'decvar', 'getvar', 'hasvar', 'deletevar',
      'setglobalvar', 'addglobalvar', 'incglobalvar', 'decglobalvar', 'getglobalvar', 'hasglobalvar', 'deleteglobalvar',
      'instructStoryStringPrefix', 'instructStoryStringSuffix', 'instructUserPrefix', 'instructUserSuffix',
      'instructAssistantPrefix', 'instructAssistantSuffix', 'instructSystemPrefix', 'instructSystemSuffix',
      'instructFirstAssistantPrefix', 'instructLastAssistantPrefix', 'instructStop', 'instructUserFiller',
      'instructSystemInstructionPrefix', 'instructFirstUserPrefix', 'instructLastUserPrefix',
      'defaultSystemPrompt', 'systemPrompt', 'exampleSeparator', 'chatStart',
      // 别名
      'charIfNotGroup', 'description', 'personality', 'scenario', 'creatorNotes', 'greeting', 'version',
      'char_version', 'maxPromptTokens', 'maxContextTokens', 'maxResponseTokens', 'comment', 'idle_duration',
      'varexists', 'flushvar', 'globalvarexists', 'flushglobalvar', 'instructInput', 'instructOutput',
      'instructSeparator', 'instructFirstOutputPrefix', 'instructLastOutputPrefix', 'instructFirstInput',
      'instructLastInput', 'instructSystem', 'instructSystemPrompt', 'chatSeparator',
    ];
    const missing = tavern.filter((name) => !MACRO_REGISTRY.has(name.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('每个宏都有说明,说明表和引擎是同一份', () => {
    expect(BUILTIN_MACROS).toHaveLength(MACRO_DEFS.length);
    for (const m of BUILTIN_MACROS) {
      expect(m.note, m.key).toBeTruthy();
      expect(m.syntax, m.key).toContain('{{');
    }
  });

  it('不带参数的宏在说明表里能算出当前值', () => {
    const c = buildMacroContext({
      card: { name: '艾琳', description: '', personality: '', scenario: '' },
      userName: '旅人',
      personaDescription: '',
      history: [],
    });
    const value = (key: string) => BUILTIN_MACROS.find((m) => m.key === key)?.value(c);
    expect(value('char')).toBe('艾琳');
    expect(value('user')).toBe('旅人');
    expect(value('setvar')).toBe('');
  });

  it('成对块的内容按第一行的缩进拉齐', () => {
    expect(trimScopedContent('\n    a\n      b\n  c\n')).toBe('a\n  b\nc');
  });
});

/** 2026-10-06:AI 回复、卡、预设里的怪写法不能把页面卡死或者撑崩(每次渲染都要展开) */
describe('怪输入不卡、不崩', () => {
  const fast = (text: string, e = env()) => {
    const t = performance.now();
    const out = run(text, e);
    expect(performance.now() - t).toBeLessThan(500);
    return out;
  };

  it('一串没闭合的 {{ 不是指数级', () => {
    const text = '{{a '.repeat(40);
    expect(fast(text)).toBe(text);
    expect(fast(text + '}}')).toContain('{{a');
  });

  it('几千层嵌套不爆栈', () => {
    const text = '{{a '.repeat(5000) + '}}'.repeat(5000);
    expect(() => fast(text)).not.toThrow();
  });

  it('自己引用自己的自定义宏到此为止', () => {
    expect(fast('{{foo}}', env({ custom: { foo: 'x{{foo}}' } }))).toBe('x{{foo}}');
    expect(fast('{{a}}', env({ custom: { a: '{{b}}', b: '{{a}}' } }))).toBe('{{a}}');
    expect(fast('{{中文}}', env({ custom: { 中文: '{{中文}}!' } }))).toBe('{{中文}}!');
  });

  it('原型上的名字不当成宏或变量', () => {
    expect(fast('{{constructor}}')).toBe('{{constructor}}');
    expect(fast('{{.toString}}')).toBe('');
    expect(fast('{{hasvar::toString}}')).toBe('false');
    expect(fast('{{outlet::constructor}}')).toBe('');
  });

  it('一长串换行不是平方级', () => {
    const text = 'a' + '\n'.repeat(50000) + 'b';
    expect(fast(text)).toBe(text);
    expect(fast('a\n\n{{trim}}\n\nb')).toBe('ab');
  });

  it('骰子个数、空格数有上限', () => {
    expect(fast('{{roll::99999999999d6}}')).toBe('');
    expect(fast('{{space::500000000}}')).toBe('{{space::500000000}}');
    expect(fast('{{space::3}}')).toBe('   ');
  });
});
