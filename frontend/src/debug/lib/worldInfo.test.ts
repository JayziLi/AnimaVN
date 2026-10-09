import { describe, expect, it } from 'vitest';
import { WI_LOGIC, WI_POSITION, parseEntry, type CharacterBookEntry } from './characterBook';
import {
  DEFAULT_WORLD_INFO_SETTINGS,
  activateWorldInfo,
  parseRegexFromString,
  splitKeys,
  type WorldInfoInput,
  type WorldInfoSettings,
} from './worldInfo';

let nextId = 0;

/** 照卡里的写法造一条:没写的字段走解析器的默认值,和真卡一样 */
function entry(raw: Record<string, unknown>): CharacterBookEntry {
  const id = nextId++;
  return parseEntry({ id, enabled: true, insertion_order: 100, keys: [], content: `正文${id}`, ...raw }, id);
}

function run(
  entries: CharacterBookEntry[],
  messages: string[],
  over: Partial<WorldInfoInput> & { set?: Partial<WorldInfoSettings> } = {},
) {
  const { set, ...rest } = over;
  return activateWorldInfo({
    entries,
    messages,
    scanData: {
      personaDescription: '',
      characterDescription: '',
      characterPersonality: '',
      characterDepthPrompt: '',
      scenario: '',
      creatorNotes: '',
    },
    settings: { ...DEFAULT_WORLD_INFO_SETTINGS, ...set },
    maxContext: 100000,
    random: () => 0.5,
    substitute: (s) => s,
    countTokens: (s) => s.length,
    ...rest,
  });
}

const placed = (r: ReturnType<typeof run>) =>
  r.rows.filter((x) => x.placed).map((x) => x.title).sort();

describe('触发', () => {
  it('常驻条目不看关键词', () => {
    const r = run([entry({ constant: true, comment: 'A' })], ['你好']);
    expect(placed(r)).toEqual(['A']);
  });

  it('不是常驻、又没有关键词的条目不触发', () => {
    const r = run([entry({ comment: 'A' })], ['你好']);
    expect(placed(r)).toEqual([]);
  });

  it('关键词命中才触发', () => {
    const es = [
      entry({ keys: ['蛋包饭'], comment: '蛋包饭' }),
      entry({ keys: ['剪刀手'], comment: '剪刀手' }),
    ];
    expect(placed(run(es, ['今天想吃蛋包饭']))).toEqual(['蛋包饭']);
  });

  it('关掉的条目不触发', () => {
    const r = run([entry({ constant: true, enabled: false, comment: 'A' })], ['x']);
    expect(placed(r)).toEqual([]);
  });

  it('没写 enabled 的条目当作关闭', () => {
    const e = parseEntry({ keys: ['x'], content: 'c', constant: true }, 0);
    expect(placed(run([e], ['x']))).toEqual([]);
  });

  it('只扫最近 N 条', () => {
    const es = [entry({ keys: ['暗号'], comment: 'A' })];
    // 新的在前
    expect(placed(run(es, ['一', '二', '暗号']))).toEqual([]);
    expect(placed(run(es, ['一', '暗号', '三']))).toEqual(['A']);
    expect(placed(run(es, ['一', '二', '暗号'], { set: { scanDepth: 3 } }))).toEqual(['A']);
  });

  it('条目自己的扫描条数优先于全局', () => {
    const es = [entry({ keys: ['暗号'], comment: 'A', extensions: { scan_depth: 5 } })];
    expect(placed(run(es, ['一', '二', '三', '暗号']))).toEqual(['A']);
  });

  it('扫描条数是 0 的条目什么都扫不到', () => {
    const es = [entry({ keys: ['暗号'], comment: 'A', extensions: { scan_depth: 0 } })];
    expect(placed(run(es, ['暗号']))).toEqual([]);
  });
});

describe('匹配', () => {
  it('默认不分大小写', () => {
    const es = [entry({ keys: ['API'], comment: 'A' })];
    expect(placed(run(es, ['the api is down']))).toEqual(['A']);
    expect(placed(run(es, ['the api is down'], { set: { caseSensitive: true } }))).toEqual([]);
  });

  it('全词匹配:英文词嵌在别的词里不算', () => {
    const es = [entry({ keys: ['cat'], comment: 'A' })];
    expect(placed(run(es, ['concatenate']))).toEqual([]);
    expect(placed(run(es, ['a cat.']))).toEqual(['A']);
    expect(placed(run(es, ['concatenate'], { set: { matchWholeWords: false } }))).toEqual(['A']);
  });

  it('全词匹配:中文关键词夹在句子里也算', () => {
    const es = [entry({ keys: ['蛋包饭'], comment: 'A' })];
    expect(placed(run(es, ['我想吃蛋包饭了']))).toEqual(['A']);
  });

  it('全词匹配:英文词贴着中文也算', () => {
    const es = [entry({ keys: ['API'], comment: 'A' })];
    expect(placed(run(es, ['这个API坏了']))).toEqual(['A']);
    expect(placed(run(es, ['APIkey 丢了']))).toEqual([]);
  });

  it('带空格的关键词按子串匹配', () => {
    const es = [entry({ keys: ['ice cream'], comment: 'A' })];
    expect(placed(run(es, ['nice creamy']))).toEqual(['A']);
  });

  it('正则关键词', () => {
    const es = [entry({ keys: ['/第\\d+章/'], comment: 'A' })];
    expect(placed(run(es, ['翻到第12章']))).toEqual(['A']);
    expect(placed(run(es, ['翻到第章']))).toEqual([]);
  });

  it('正则可以用 \\x01 锚定消息开头', () => {
    const es = [entry({ keys: ['/\\x01小明: 早/'], comment: 'A' })];
    expect(placed(run(es, ['小明: 早上好']))).toEqual(['A']);
    expect(placed(run(es, ['她说 小明: 早上好']))).toEqual([]);
  });

  it('条目可以额外扫描角色描述', () => {
    const base = { keys: ['猫耳'], comment: 'A' };
    const scanData = {
      personaDescription: '',
      characterDescription: '她有一对猫耳',
      characterPersonality: '',
      characterDepthPrompt: '',
      scenario: '',
      creatorNotes: '',
    };
    expect(placed(run([entry(base)], ['你好'], { scanData }))).toEqual([]);
    expect(
      placed(
        run([entry({ ...base, extensions: { match_character_description: true } })], ['你好'], {
          scanData,
        }),
      ),
    ).toEqual(['A']);
  });
});

describe('次要关键词', () => {
  const make = (logic: number) => [
    entry({
      keys: ['学校'],
      secondary_keys: ['考试', '社团'],
      selective: true,
      comment: 'A',
      extensions: { selectiveLogic: logic },
    }),
  ];

  it('任意一个命中', () => {
    expect(placed(run(make(WI_LOGIC.andAny), ['学校的考试']))).toEqual(['A']);
    expect(placed(run(make(WI_LOGIC.andAny), ['学校的食堂']))).toEqual([]);
  });

  it('全部命中', () => {
    expect(placed(run(make(WI_LOGIC.andAll), ['学校的考试']))).toEqual([]);
    expect(placed(run(make(WI_LOGIC.andAll), ['学校的考试和社团']))).toEqual(['A']);
  });

  it('全都没命中', () => {
    expect(placed(run(make(WI_LOGIC.notAny), ['学校的食堂']))).toEqual(['A']);
    expect(placed(run(make(WI_LOGIC.notAny), ['学校的考试']))).toEqual([]);
  });

  it('不是全部命中', () => {
    expect(placed(run(make(WI_LOGIC.notAll), ['学校的考试']))).toEqual(['A']);
    expect(placed(run(make(WI_LOGIC.notAll), ['学校的考试和社团']))).toEqual([]);
  });

  it('没勾「启用次要关键词」时次要关键词不起作用', () => {
    const es = [entry({ keys: ['学校'], secondary_keys: ['考试'], comment: 'A' })];
    expect(placed(run(es, ['学校的食堂']))).toEqual(['A']);
  });
});

describe('递归', () => {
  const es = () => [
    entry({ keys: ['王都'], content: '王都由骑士团守卫', comment: '王都' }),
    entry({ keys: ['骑士团'], content: '团长是艾琳', comment: '骑士团' }),
    entry({ keys: ['艾琳'], content: '她怕猫', comment: '艾琳' }),
  ];

  it('触发的条目正文会带出别的条目', () => {
    expect(placed(run(es(), ['去王都']))).toEqual(['王都', '艾琳', '骑士团'].sort());
  });

  it('关掉递归就只有直接命中的', () => {
    expect(placed(run(es(), ['去王都'], { set: { recursive: false } }))).toEqual(['王都']);
  });

  it('最大递归步数', () => {
    const r = run(es(), ['去王都'], { set: { maxRecursionSteps: 2 } });
    expect(placed(r)).toEqual(['王都', '骑士团'].sort());
  });

  it('「不被递归触发」的条目只认聊天记录', () => {
    const list = es();
    list[1] = entry({
      keys: ['骑士团'],
      content: '团长是艾琳',
      comment: '骑士团',
      extensions: { exclude_recursion: true },
    });
    expect(placed(run(list, ['去王都']))).toEqual(['王都']);
  });

  it('「不触发别的条目」的条目正文不进扫描', () => {
    const list = es();
    list[0] = entry({
      keys: ['王都'],
      content: '王都由骑士团守卫',
      comment: '王都',
      extensions: { prevent_recursion: true },
    });
    expect(placed(run(list, ['去王都']))).toEqual(['王都']);
  });

  it('「递归时才参与」的条目第一轮不看', () => {
    const list = [
      entry({ keys: ['王都'], content: '王都由骑士团守卫', comment: '王都' }),
      entry({
        keys: ['骑士团'],
        content: 'x',
        comment: '骑士团',
        extensions: { delay_until_recursion: true },
      }),
    ];
    expect(placed(run(list, ['骑士团来了']))).toEqual([]);
    expect(placed(run(list, ['去王都']))).toEqual(['王都', '骑士团'].sort());
  });
});

describe('概率和预算', () => {
  it('概率没掷中就不触发', () => {
    const es = [entry({ constant: true, comment: 'A', extensions: { probability: 30 } })];
    expect(placed(run(es, ['x'], { random: () => 0.5 }))).toEqual([]);
    expect(placed(run(es, ['x'], { random: () => 0.1 }))).toEqual(['A']);
  });

  it('关掉概率开关就一定触发', () => {
    const es = [
      entry({
        constant: true,
        comment: 'A',
        extensions: { probability: 30, useProbability: false },
      }),
    ];
    expect(placed(run(es, ['x'], { random: () => 0.9 }))).toEqual(['A']);
  });

  it('超预算的条目不进,顺序号大的先占', () => {
    const es = [
      entry({ constant: true, comment: '小', content: '1234567890', insertion_order: 10 }),
      entry({ constant: true, comment: '大', content: '1234567890', insertion_order: 20 }),
    ];
    // 预算 = 25% * 60 = 15;一条 10 字 + 换行 = 11,两条 22
    const r = run(es, ['x'], { maxContext: 60 });
    expect(placed(r)).toEqual(['大']);
    expect(r.overflowed).toBe(true);
    expect(r.rows.find((x) => x.title === '小')?.reason).toContain('预算');
  });

  it('不受预算限制的条目照进', () => {
    const es = [
      entry({ constant: true, comment: '大', content: '1234567890', insertion_order: 20 }),
      entry({
        constant: true,
        comment: '小',
        content: '1234567890',
        insertion_order: 10,
        extensions: { ignore_budget: true },
      }),
    ];
    expect(placed(run(es, ['x'], { maxContext: 60 }))).toEqual(['大', '小'].sort());
  });

  it('没有上下文上限时预算不设限,除非设了封顶', () => {
    const es = [entry({ constant: true, comment: 'A', content: '1234567890' })];
    expect(run(es, ['x'], { maxContext: null }).budget).toBeNull();
    expect(run(es, ['x'], { maxContext: null, set: { budgetCap: 5 } }).budget).toBe(5);
  });
});

describe('位置', () => {
  it('没写位置的条目放在角色描述后', () => {
    const r = run([entry({ constant: true, content: 'A' })], ['x']);
    expect(r.before).toBe('');
    expect(r.after).toBe('A');
  });

  it('before_char 放前面;extensions.position 优先', () => {
    const r = run(
      [
        entry({ constant: true, content: 'A', position: 'before_char' }),
        entry({
          constant: true,
          content: 'B',
          position: 'before_char',
          extensions: { position: WI_POSITION.after },
        }),
      ],
      ['x'],
    );
    expect(r.before).toBe('A');
    expect(r.after).toBe('B');
  });

  it('同一位置里顺序号小的在前', () => {
    const r = run(
      [
        entry({ constant: true, content: '三', insertion_order: 30 }),
        entry({ constant: true, content: '一', insertion_order: 10 }),
        entry({ constant: true, content: '二', insertion_order: 20 }),
      ],
      ['x'],
    );
    expect(r.after).toBe('一\n二\n三');
  });

  it('指定深度:同深度同角色的合成一块', () => {
    const at = (content: string, depth: number, role: number, order: number) =>
      entry({
        constant: true,
        content,
        insertion_order: order,
        extensions: { position: WI_POSITION.atDepth, depth, role },
      });
    const r = run([at('甲', 2, 0, 10), at('乙', 2, 0, 20), at('丙', 2, 1, 30), at('丁', 0, 0, 40)], [
      'x',
    ]);
    expect(r.depth).toEqual(
      expect.arrayContaining([
        { depth: 2, role: 0, content: '甲\n乙' },
        { depth: 2, role: 1, content: '丙' },
        { depth: 0, role: 0, content: '丁' },
      ]),
    );
    expect(r.depth).toHaveLength(3);
  });

  it('作者注释上下的条目单独给出,上在前', () => {
    const r = run(
      [
        entry({ constant: true, content: '下', extensions: { position: WI_POSITION.anBottom } }),
        entry({ constant: true, content: '上', extensions: { position: WI_POSITION.anTop } }),
      ],
      ['x'],
    );
    expect(r.depth).toEqual([]);
    expect(r.authorNote).toBe('上\n下');
  });

  it('示例对话前后', () => {
    const r = run(
      [
        entry({ constant: true, content: '前', extensions: { position: WI_POSITION.emTop } }),
        entry({ constant: true, content: '后', extensions: { position: WI_POSITION.emBottom } }),
      ],
      ['x'],
    );
    expect(r.examples).toEqual(
      expect.arrayContaining([
        { position: 'before', content: '前' },
        { position: 'after', content: '后' },
      ]),
    );
  });

  it('自定义出口:按出口名归拢,没写出口名的放不进去', () => {
    const out = (content: string, name: string, order: number) =>
      entry({
        constant: true,
        comment: content,
        content,
        insertion_order: order,
        extensions: { position: WI_POSITION.outlet, outlet_name: name },
      });
    const r = run([out('甲', '成就', 10), out('乙', '成就', 20), out('丙', '物品', 30), out('丁', '', 40)], ['x']);
    // 同一个出口里顺序号大的在前 —— 酒馆就是这样,和别的位置相反
    expect(r.outlets).toEqual({ 成就: '乙\n甲', 物品: '丙' });
    expect(placed(r)).toEqual(['丙', '乙', '甲'].sort());
    expect(r.rows.find((x) => x.title === '丁')?.reason).toContain('出口名');
    expect(r.before).toBe('');
    expect(r.after).toBe('');
  });
});

describe('互斥分组', () => {
  const group = (comment: string, extra: Record<string, unknown> = {}) =>
    entry({ constant: true, comment, extensions: { group: '天气', ...extra } });

  it('同组只留一条,按权重掷', () => {
    const es = [group('晴', { group_weight: 100 }), group('雨', { group_weight: 100 })];
    expect(placed(run(es, ['x'], { random: () => 0.1 }))).toHaveLength(1);
    expect(placed(run(es, ['x'], { random: () => 0.1 }))).not.toEqual(
      placed(run(es, ['x'], { random: () => 0.9 })),
    );
  });

  it('标了优先的直接赢', () => {
    const es = [group('晴'), group('雨', { group_override: true }), group('雪')];
    for (const roll of [0, 0.5, 0.99]) {
      expect(placed(run(es, ['x'], { random: () => roll }))).toEqual(['雨']);
    }
  });
});

describe('其他', () => {
  it('@@activate / @@dont_activate', () => {
    const r = run(
      [
        entry({ comment: 'A', content: '@@activate\n正文A' }),
        entry({ comment: 'B', constant: true, content: '@@dont_activate\n正文B' }),
      ],
      ['x'],
    );
    expect(placed(r)).toEqual(['A']);
    expect(r.after).toBe('正文A');
  });

  it('聊天不够长时延迟条目不参与', () => {
    const es = [entry({ constant: true, comment: 'A', extensions: { delay: 3 } })];
    expect(placed(run(es, ['一', '二']))).toEqual([]);
    expect(placed(run(es, ['一', '二', '三']))).toEqual(['A']);
  });

  it('关键词和正文里的宏会展开', () => {
    const r = run([entry({ keys: ['{{char}}'], content: '{{char}}怕猫' })], ['艾琳来了'], {
      substitute: (s) => s.replaceAll('{{char}}', '艾琳'),
    });
    expect(r.after).toBe('艾琳怕猫');
  });

  it('最少触发数:不够就往更早的消息扫', () => {
    const es = [entry({ keys: ['暗号'], comment: 'A' })];
    const msgs = ['一', '二', '三', '暗号'];
    expect(placed(run(es, msgs))).toEqual([]);
    expect(placed(run(es, msgs, { set: { minActivations: 1 } }))).toEqual(['A']);
  });

  it('报告里写明为什么触发、为什么没触发', () => {
    const r = run(
      [entry({ keys: ['蛋包饭'], comment: 'A' }), entry({ keys: ['剪刀手'], comment: 'B' })],
      ['吃蛋包饭'],
    );
    expect(r.rows.find((x) => x.title === 'A')?.reason).toBe('命中「蛋包饭」');
    expect(r.rows.find((x) => x.title === 'B')?.reason).toBe('没有命中关键词');
  });
});

describe('关键词输入', () => {
  it('逗号分隔,正则里的逗号不切', () => {
    expect(splitKeys('猫, 狗 ,  ')).toEqual(['猫', '狗']);
    expect(splitKeys('猫, /a{1,3}/i, 狗')).toEqual(['猫', '/a{1,3}/i', '狗']);
  });

  it('认不认得出正则', () => {
    expect(parseRegexFromString('/ab+c/i')?.flags).toBe('i');
    expect(parseRegexFromString('abc')).toBeNull();
    expect(parseRegexFromString('/a/b/')).toBeNull();
    expect(parseRegexFromString('/(/')).toBeNull();
  });
});
