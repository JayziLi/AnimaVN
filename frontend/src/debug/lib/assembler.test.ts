import { describe, expect, it } from 'vitest';
import { assemble, type ChatTurn } from './assembler';
import { EMPTY_CARD, type TavernCard } from './cardParser';
import { WI_POSITION, parseBook } from './characterBook';
import { buildPresetSkeleton } from './presetParser';

function card(entries: Record<string, unknown>[], over: Partial<TavernCard> = {}): TavernCard {
  return {
    ...EMPTY_CARD,
    name: '艾琳',
    description: '骑士团长',
    character_book: parseBook({
      entries: entries.map((e, i) => ({ id: i, enabled: true, insertion_order: 100, keys: [], ...e })),
    }),
    ...over,
  };
}

function run(c: TavernCard, history: ChatTurn[], wiFormat = '{0}') {
  const preset = buildPresetSkeleton('测试');
  preset.formats.wi_format = wiFormat;
  return assemble({
    card: c,
    preset,
    order: preset.orderGroups[0].order,
    history,
    userName: '旅人',
    personaDescription: '',
    allowCardOverrides: true,
    tokenBudget: null,
  });
}

const talk = (...lines: string[]): ChatTurn[] =>
  lines.map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content }));

const from = (r: ReturnType<typeof run>, identifier: string) =>
  r.messages.filter((m) => m.sourceIdentifier === identifier).map((m) => m.content);

describe('世界书进提示词', () => {
  it('一条条目只出现一次', () => {
    const r = run(card([{ constant: true, content: '王都由骑士团守卫' }]), talk('你好'));
    const all = r.messages.map((m) => m.content).join('\n');
    expect(all.split('王都由骑士团守卫')).toHaveLength(2);
    expect(from(r, 'worldInfoBefore')).toEqual([]);
    expect(from(r, 'worldInfoAfter')).toEqual(['王都由骑士团守卫']);
  });

  it('前、后各放各的,各套一次模板', () => {
    const r = run(
      card([
        { constant: true, content: '前', position: 'before_char' },
        { constant: true, content: '后' },
      ]),
      talk('你好'),
      '[设定:{0}]',
    );
    expect(from(r, 'worldInfoBefore')).toEqual(['[设定:前]']);
    expect(from(r, 'worldInfoAfter')).toEqual(['[设定:后]']);
  });

  it('没触发的条目不进提示词', () => {
    const c = card([{ keys: ['蛋包饭'], content: '她最爱蛋包饭' }]);
    expect(from(run(c, talk('你好')), 'worldInfoAfter')).toEqual([]);
    expect(from(run(c, talk('吃蛋包饭吗')), 'worldInfoAfter')).toEqual(['她最爱蛋包饭']);
  });

  it('扫描文本带名字,关键词可以是说话人', () => {
    const c = card([{ keys: ['旅人:'], content: '旅人开口了' }]);
    expect(from(run(c, talk('你好')), 'worldInfoAfter')).toEqual(['旅人开口了']);
  });

  it('没有世界书的卡照常组装', () => {
    const r = run({ ...EMPTY_CARD, name: '艾琳', description: '骑士团长' }, talk('你好'));
    expect(from(r, 'charDescription')).toEqual(['骑士团长']);
    expect(r.worldInfo?.rows).toEqual([]);
  });
});

describe('指定深度', () => {
  const at = (content: string, depth: number, role = 0) => ({
    constant: true,
    content,
    extensions: { position: WI_POSITION.atDepth, depth, role },
  });

  const chat = (r: ReturnType<typeof run>) => {
    const i = r.messages.findIndex(
      (m) => m.sourceIdentifier === 'chatHistory' || /worldInfoDepth|depthPrompt/.test(m.sourceIdentifier),
    );
    return r.messages
      .slice(i)
      .filter((m) => m.sourceIdentifier !== 'jailbreak')
      .map((m) => `${m.role}:${m.content}`);
  };

  it('深度 0 在最后一条之后,深度 1 在它之前', () => {
    const r = run(card([at('零', 0), at('一', 1)]), talk('甲', '乙', '丙'));
    expect(chat(r)).toEqual(['user:甲', 'assistant:乙', 'system:一', 'user:丙', 'system:零']);
  });

  it('聊天记录不够长就垫在最前面', () => {
    const r = run(card([at('深', 4)]), talk('甲', '乙'));
    expect(chat(r)).toEqual(['system:深', 'user:甲', 'assistant:乙']);
  });

  it('按条目写的角色插入', () => {
    const r = run(card([at('用户口吻', 1, 1), at('角色口吻', 1, 2)]), talk('甲', '乙'));
    expect(chat(r)).toEqual(['user:甲', 'assistant:角色口吻', 'user:用户口吻', 'assistant:乙']);
  });

  it('插进去的条目和对话一起排队:挨着最新消息的留下,靠前的跟着旧对话一起丢', () => {
    // 上下文只有 20,世界书预算是它的 25%,装不下这两条 —— 标成不受预算限制,只测截断
    const free = (e: ReturnType<typeof at>) => ({ ...e, extensions: { ...e.extensions, ignore_budget: true } });
    const r = assemble({
      card: card([free(at('留在最后', 0)), free(at('跟着被丢', 3))]),
      preset: buildPresetSkeleton('测试'),
      order: buildPresetSkeleton('测试').orderGroups[0].order,
      history: talk('很长很长的第一句话', '很长很长的第二句话', '很长很长的第三句话', '最后一句'),
      userName: '旅人',
      personaDescription: '',
      allowCardOverrides: true,
      tokenBudget: 20,
    });
    expect(r.budget.droppedCount).toBeGreaterThan(0);
    const sent = r.messages.map((m) => m.content);
    expect(sent).toContain('留在最后');
    expect(sent).not.toContain('跟着被丢');
    expect(r.budget.parts.worldInfo).toBeGreaterThan(0);
  });
});

describe('角色备注和作者注释位', () => {
  it('卡的 depth_prompt 插进聊天记录', () => {
    const c = card([], {
      extensions: { depth_prompt: { prompt: '记住她怕猫', depth: 1, role: 'user' } },
    });
    const r = run(c, talk('甲', '乙'));
    const seq = r.messages
      .filter((m) => m.sourceIdentifier === 'chatHistory' || /worldInfoDepth|depthPrompt/.test(m.sourceIdentifier))
      .map((m) => `${m.role}:${m.content}`);
    // 深度 1 = 最后一条之前
    expect(seq).toEqual(['user:甲', 'user:记住她怕猫', 'assistant:乙']);
  });

  it('depth_prompt 没写深度和身份时是倒数第 4 条、system', () => {
    const c = card([], { extensions: { depth_prompt: { prompt: '备注' } } });
    const r = run(c, talk('一', '二', '三', '四', '五'));
    const seq = r.messages
      .filter((m) => m.sourceIdentifier === 'chatHistory' || /worldInfoDepth|depthPrompt/.test(m.sourceIdentifier))
      .map((m) => `${m.role}:${m.content}`);
    expect(seq).toEqual(['user:一', 'system:备注', 'assistant:二', 'user:三', 'assistant:四', 'user:五']);
  });

  it('作者注释位的世界书、角色备注、指定深度的世界书在同一深度按这个顺序合成一条', () => {
    const c = card(
      [
        { constant: true, content: '深度条目', extensions: { position: WI_POSITION.atDepth, depth: 4, role: 0 } },
        { constant: true, content: '注释下', extensions: { position: WI_POSITION.anBottom } },
      ],
      { extensions: { depth_prompt: { prompt: '备注', depth: 4 } } },
    );
    const r = run(c, talk('一'));
    const injected = r.messages.filter((m) => /worldInfoDepth|depthPrompt/.test(m.sourceIdentifier));
    expect(injected).toHaveLength(1);
    expect(injected[0].content).toBe('注释下\n备注\n深度条目');
  });
});

describe('预设的绝对深度块', () => {
  const withBlocks = (blocks: { name: string; role: 'system' | 'user' | 'assistant'; content: string; depth: number; order?: number }[]) => {
    const preset = buildPresetSkeleton('测试');
    for (const b of blocks) {
      preset.prompts.push({
        identifier: b.name,
        name: b.name,
        role: b.role,
        content: b.content,
        marker: false,
        systemPrompt: false,
        injectionPosition: 1,
        injectionDepth: b.depth,
        injectionOrder: b.order ?? 100,
        injectionTrigger: [],
        forbidOverrides: false,
      });
      preset.orderGroups[0].order.push({ identifier: b.name, enabled: true });
    }
    return preset;
  };
  const seq = (r: ReturnType<typeof assemble>) =>
    r.messages
      .filter((m) => m.sourceIdentifier === 'chatHistory' || m.sourceKind === 'preset' && m.part === 'preset' && /深度|注入|抢话|标签/.test(m.sourceName))
      .map((m) => `${m.role}:${m.content}`);

  const go = (preset: ReturnType<typeof buildPresetSkeleton>, history: ChatTurn[]) =>
    assemble({
      card: { ...EMPTY_CARD, name: '艾琳' },
      preset,
      order: preset.orderGroups[0].order,
      history,
      userName: '旅人',
      personaDescription: '',
      allowCardOverrides: true,
      tokenBudget: null,
    });

  it('不按编排的位置放,插进聊天记录', () => {
    const preset = withBlocks([{ name: '抢话', role: 'system', content: '注意玩家的续写', depth: 1 }]);
    const r = go(preset, talk('甲', '乙', '丙'));
    expect(seq(r)).toEqual(['user:甲', 'assistant:乙', 'system:注意玩家的续写', 'user:丙']);
    // 编排里它排在最前面,但不该在聊天记录之外出现
    expect(r.messages[0].content).not.toBe('注意玩家的续写');
  });

  it('深度 0 在最后一条之后,可以包住最后一条', () => {
    const preset = withBlocks([
      { name: '标签开', role: 'system', content: '<message>', depth: 1 },
      { name: '标签关', role: 'system', content: '</message>', depth: 0 },
    ]);
    expect(seq(go(preset, talk('甲', '乙')))).toEqual([
      'user:甲',
      'system:<message>',
      'assistant:乙',
      'system:</message>',
    ]);
  });

  it('同一深度:照酒馆的结果,user 在前 system 在后,order 大的更靠近末尾', () => {
    const preset = withBlocks([
      { name: '注入A', role: 'system', content: 'A', depth: 0, order: 100 },
      { name: '注入B', role: 'user', content: 'B', depth: 0, order: 100 },
      { name: '注入C', role: 'system', content: 'C', depth: 0, order: 200 },
      { name: '注入D', role: 'system', content: 'D', depth: 0, order: 100 },
    ]);
    // 酒馆在倒序列表上插 [C, A+D, B] 再整个反转,所以最终是 B、A+D、C
    expect(seq(go(preset, talk('甲')))).toEqual(['user:甲', 'user:B', 'system:A\nD', 'system:C']);
  });

  it('token 算在预设头上,空块记为跳过', () => {
    const preset = withBlocks([
      { name: '注入A', role: 'system', content: 'A', depth: 0 },
      { name: '注入空', role: 'system', content: '{{// 只有注释}}', depth: 0 },
    ]);
    const r = go(preset, talk('甲'));
    expect(r.budget.parts.preset).toBeGreaterThan(0);
    expect(r.skipped.find((s) => s.identifier === '注入空')?.reason).toBe('块内容为空');
  });
});

describe('变量', () => {
  /** 在骨架预设的「聊天记录」前面插几个文本块 */
  const presetWith = (blocks: { id: string; content: string; enabled?: boolean; depth?: number }[]) => {
    const preset = buildPresetSkeleton('测试');
    const at = preset.orderGroups[0].order.findIndex((o) => o.identifier === 'chatHistory');
    blocks.forEach((b, i) => {
      preset.prompts.push({
        identifier: b.id,
        name: b.id,
        role: 'system',
        content: b.content,
        marker: false,
        systemPrompt: false,
        injectionPosition: b.depth === undefined ? 0 : 1,
        injectionDepth: b.depth ?? 4,
        injectionOrder: 100,
        injectionTrigger: [],
        forbidOverrides: false,
      });
      preset.orderGroups[0].order.splice(at + i, 0, { identifier: b.id, enabled: b.enabled ?? true });
    });
    return preset;
  };
  const go = (
    preset: ReturnType<typeof buildPresetSkeleton>,
    over: Partial<Parameters<typeof assemble>[0]> = {},
  ) =>
    assemble({
      card: { ...EMPTY_CARD, name: '艾琳', description: '骑士团长' },
      preset,
      order: preset.orderGroups[0].order,
      history: talk('你好'),
      userName: '旅人',
      personaDescription: '',
      allowCardOverrides: true,
      tokenBudget: null,
      ...over,
    });
  const text = (r: ReturnType<typeof assemble>, id: string) =>
    r.messages.find((m) => m.sourceIdentifier === id)?.content;

  it('前面的块写、后面的块读 —— 预设靠这个在块之间传话', () => {
    const preset = presetWith([
      { id: '清空', content: '{{setvar::style::}}' },
      { id: '轻小说', content: '{{setvar::style::日式轻小说}}' },
      { id: '文风', content: '文风:{{getvar::style}}' },
    ]);
    const r = go(preset);
    expect(text(r, '文风')).toBe('文风:日式轻小说');
    // 只写变量、不出字的块不会变成一条空消息
    expect(text(r, '轻小说')).toBeUndefined();
    expect(r.skipped.find((s) => s.identifier === '轻小说')?.reason).toBe('块内容为空');
  });

  it('关掉那个块,读到的就是清空后的值', () => {
    const preset = presetWith([
      { id: '清空', content: '{{setvar::style::}}' },
      { id: '轻小说', content: '{{setvar::style::日式轻小说}}', enabled: false },
      { id: '文风', content: '文风:[{{getvar::style}}]' },
    ]);
    expect(text(go(preset, { variables: { local: { style: '上一轮留下的' }, global: {} } }), '文风')).toBe(
      '文风:[]',
    );
  });

  it('算完的变量随结果交回去,传进来的那份不动', () => {
    const preset = presetWith([{ id: '计数', content: '第 {{incvar::轮次}} 轮 {{setglobalvar::seen::1}}' }]);
    const mine = { local: { 轮次: 4 }, global: {} };
    const r = go(preset, { variables: mine });
    // 块首尾的空白不裁,酒馆也是原样发
    expect(text(r, '计数')).toBe('第 5 轮 ');
    expect(r.variables).toEqual({ local: { 轮次: 5 }, global: { seen: '1' } });
    expect(mine).toEqual({ local: { 轮次: 4 }, global: {} });
  });

  it('每段文字只求一次:聊天记录里的 {{incvar}} 不会被世界书扫描再加一遍', () => {
    const r = go(presetWith([]), {
      history: [{ role: 'user', content: '这是第 {{incvar::n}} 次' }],
      card: card([{ keys: ['次'], content: '命中' }]),
    });
    expect(r.variables?.local.n).toBe(1);
    expect(r.messages.find((m) => m.sourceKind === 'history')?.content).toBe('这是第 1 次');
  });

  it('绝对深度的块也按编排的先后求值', () => {
    const preset = presetWith([
      { id: '写', content: '{{setvar::mode::战斗}}' },
      { id: '插入', content: '当前模式:{{getvar::mode}}', depth: 0 },
    ]);
    expect(text(go(preset), '插入')).toBe('当前模式:战斗');
  });

  it('世界书的自定义出口从 {{outlet}} 出来', () => {
    const preset = presetWith([{ id: '成就栏', content: '成就:{{outlet::成就}}' }]);
    const c = card([
      { constant: true, content: '屠龙者', extensions: { position: WI_POSITION.outlet, outlet_name: '成就' } },
    ]);
    const r = go(preset, { card: c });
    expect(text(r, '成就栏')).toBe('成就:屠龙者');
    expect(from(r, 'worldInfoAfter')).toEqual([]);
  });

  it('卡顶替主提示词时,{{original}} 是被顶掉的预设原文', () => {
    const preset = buildPresetSkeleton('测试');
    const main = preset.prompts.find((p) => p.identifier === 'main');
    if (main) main.content = '预设的主提示词';
    const r = go(preset, {
      card: { ...EMPTY_CARD, name: '艾琳', system_prompt: '{{original}}\n另外:{{char}}怕猫' },
    });
    expect(text(r, 'main')).toBe('预设的主提示词\n另外:艾琳怕猫');
  });

  it('不是顶替的场合,{{original}} 原样留着;{{charPrompt}} 拿到的卡原文里也一样', () => {
    const preset = presetWith([
      { id: '普通块', content: '这里没有可顶替的:{{original}}' },
      { id: '引用卡', content: '<卡>{{charPrompt}}</卡>' },
    ]);
    const r = go(preset, {
      card: { ...EMPTY_CARD, name: '艾琳', system_prompt: '  {{original}}\r\n{{char}}怕猫  ' },
    });
    expect(text(r, '普通块')).toBe('这里没有可顶替的:{{original}}');
    expect(text(r, '引用卡')).toBe('<卡>{{original}}\n艾琳怕猫</卡>');
  });

  it('注释宏不进提示词', () => {
    const preset = presetWith([{ id: '说明', content: '{{// 给自己看的}}正文{{// 另一条}}' }]);
    expect(text(go(preset), '说明')).toBe('正文');
  });
});

describe('示例对话位置', () => {
  it('世界书的示例排在卡自己的示例前后', () => {
    const c = card(
      [
        {
          constant: true,
          content: '{{user}}: 前问\n{{char}}: 前答',
          extensions: { position: WI_POSITION.emTop },
        },
        {
          constant: true,
          content: '<START>\n{{user}}: 后问\n{{char}}: 后答',
          extensions: { position: WI_POSITION.emBottom },
        },
      ],
      { mes_example: '<START>\n{{user}}: 中问\n{{char}}: 中答' },
    );
    const r = run(c, talk('你好'));
    // 示例里的每一句都以 system 的身份发,谁说的写在 name 里
    const said = r.messages.filter((m) => m.sourceKind === 'examples' && m.name).map((m) => `${m.name}:${m.content}`);
    expect(said).toEqual([
      'example_user:前问',
      'example_assistant:前答',
      'example_user:中问',
      'example_assistant:中答',
      'example_user:后问',
      'example_assistant:后答',
    ]);
    expect(r.messages.filter((m) => m.sourceIdentifier === 'newChat')).toHaveLength(3);
  });

  it('预算紧的时候先保聊天记录,示例对话整段整段地让', () => {
    const c = card([], {
      mes_example: '<START>\n{{user}}: 第一段问\n{{char}}: 第一段答\n<START>\n{{user}}: 第二段问\n{{char}}: 第二段很长很长很长很长很长很长很长很长的答',
    });
    const preset = buildPresetSkeleton('测试');
    const input = {
      card: c,
      preset,
      order: preset.orderGroups[0].order,
      history: talk('你好', '你也好'),
      userName: '旅人',
      personaDescription: '',
      allowCardOverrides: true,
    };
    const all = assemble({ ...input, tokenBudget: null });
    const named = (r: ReturnType<typeof assemble>) => r.messages.filter((m) => m.name).map((m) => m.content);
    expect(named(all)).toHaveLength(4);

    // 一个数算:全都放得下要多少(每条 4 个、带名字的多一些、回复开头 3 个)
    const count = (r: ReturnType<typeof assemble>) => r.messages.reduce((sum, m) => sum + m.tokens + 4, 3);
    const tight = assemble({ ...input, tokenBudget: count(all) - 1 });
    expect(named(tight)).toEqual(['第一段问', '第一段答']);
    expect(tight.budget.droppedCount).toBe(0);
    expect(tight.skipped.find((s) => s.identifier === 'dialogueExamples')?.reason).toBe('超出 token 预算');
  });
});
