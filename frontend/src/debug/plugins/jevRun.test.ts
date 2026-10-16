import { describe, expect, it } from 'vitest';
import { vnTagKinds } from '../vn/tags';
import { NO_JEV, type JevDecision, type JevKinds } from './jev';
import { jevView } from './jevNotes';
import { JevRun, type AnnotateRequest, type AnnotateResponse, type JevSnapshot } from './jevRun';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
const ALL: JevKinds = { sprite: true, bg: true, bgm: true, cg: false, player: true };

/** 假后端:记下每次请求,按 answer 回(可以控制什么时候回) */
function setup(
  answer: (req: AnnotateRequest) => Partial<JevDecision>[] | Error,
  o: { jevKinds?: JevKinds; popup?: boolean; cg?: string | null; askTone?: boolean; twoQueues?: boolean } = {},
) {
  const calls: { req: AnnotateRequest; resolve: () => void; done?: boolean }[] = [];
  const snaps: JevSnapshot[] = [];
  const run = new JevRun({
    charName: '星绘',
    userName: 'Lj',
    prev: '——去食堂',
    kinds,
    jevKinds: o.jevKinds ?? ALL,
    templates: { sprite: '<sprite:{表情}>', bg: '<bg:{场景}>', bgm: '<bgm:{音乐}>', cg: '<cg:{CG}>' },
    emotions: [
      { label: '平静', aliases: [], description: '' },
      { label: '微笑', aliases: [], description: '' },
    ],
    bgs: [
      { label: '教室', aliases: [], description: '' },
      { label: '食堂', aliases: [], description: '' },
    ],
    bgms: [{ label: '日常', aliases: [], description: '' }],
    cgs: [
      { label: '午睡', aliases: [], description: '两人在教室里趴着睡午觉' },
      { label: '喂饭', aliases: [], description: '她用勺子喂你' },
    ],
    scene: { bg: '教室', bgm: null, cg: o.cg ?? null },
    placeOf: (bg) => (bg ? `${bg}(地点说明)` : ''),
    emotionBefore: '平静',
    popup: o.popup ?? true,
    askTone: o.askTone,
    thresholds: { speaker: 0.8, bg: 0.6, bgm: 0.6, cg: 0.6 },
    prompts: { emotion: '表情?' },
    annotate: (req) =>
      new Promise<AnnotateResponse>((resolve, reject) => {
        calls.push({
          req,
          resolve: () => {
            const a = answer(req);
            if (a instanceof Error) reject(a);
            else
              resolve({
                lines: req.targets.map((index, i) => ({
                  index,
                  speaker: null,
                  emotion: null,
                  bg: null,
                  bgm: null,
                  confidence: {},
                  ...a[i],
                })),
                ms: 150,
                tokens: 1000,
              });
          },
        });
      }),
    onChange: (s) => snaps.push(s),
    twoQueues: o.twoQueues,
  });
  const last = () => snaps[snaps.length - 1];
  /** 原文合并上最新的标注(正文本身不动) */
  const shown = (body: string) => jevView(body, last().record, kinds).text;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { run, calls, last, shown, flush };
}

describe('JevRun', () => {
  it('judges each line once it is written and records its tags as a note', async () => {
    const { run, calls, last, shown, flush } = setup((req) =>
      req.targets.map((k) => (req.lines[k].speaker === '星绘' ? { speaker: 'char' as const, emotion: '微笑' } : { bg: k === 0 ? '食堂' : null })),
    );
    run.feed('两人走进食堂。\n「今天', true);
    expect(calls.map((c) => c.req.targets)).toEqual([[0]]);
    expect(calls[0].req).toMatchObject({
      lines: [{ text: '两人走进食堂。', speaker: null }],
      ask_speaker: true,
      thresholds: { speaker: 0.8, bg: 0.6, bgm: 0.6 },
      prompts: { emotion: '表情?' },
    });
    expect(last().pendingFrom).toBe(0);

    run.feed('两人走进食堂。\n「今天有咖喱！」\n她', true);
    expect(calls.map((c) => c.req.targets)).toEqual([[0], [1]]);

    calls[1].resolve();
    await flush();
    // 第 1 句判完了,第 0 句还没回:等的是第 0 句
    expect(last().pendingFrom).toBe(0);
    expect(shown('两人走进食堂。\n「今天有咖喱！」\n她')).toContain('<sprite:微笑>「今天有咖喱！」');

    calls[0].resolve();
    await flush();
    expect(shown('两人走进食堂。\n「今天有咖喱！」\n她').startsWith('<bg:食堂>两人走进食堂。')).toBe(true);
    expect(last().pendingFrom).toBe(2);

    run.feed('两人走进食堂。\n「今天有咖喱！」\n她笑了。', false);
    expect(calls[2].req.scene).toEqual({ bg: '食堂', bgm: null, bg_changed: true, bgm_changed: false, cg: null, place: '' });
    const settled = run.settle(1000);
    calls[2].resolve();
    await settled;
    expect(last().pendingFrom).toBeNull();
    expect(last().record).toMatchObject({ kinds: ['sprite', 'bg', 'bgm', 'player'], lines: 3, requests: 3, tokens: 3000, failed: 0 });
    // 判成不用加标签的那句(旁白)也记一条:切句靠它知道这句判过
    expect(last().record.notes?.map((n) => [n.at, n.tags])).toEqual([
      [0, '<bg:食堂>'],
      [8, '<sprite:微笑>'],
      [17, ''],
    ]);
    expect(run.record()).toEqual(last().record);
  });

  it("drops the model's own Jev-kind tags and keeps the old face when Jev fails", async () => {
    const body = '<sprite:乱写>「早上好。」\n<bg:操场>她伸了个懒腰。';
    const { run, calls, last, shown, flush } = setup(() => new Error('Jev 返回 HTTP 500'));
    run.feed(body, false);
    expect(calls[0].req.targets).toEqual([0, 1]);
    calls[0].resolve();
    await flush();
    expect(shown(body)).toBe('<sprite:平静>「早上好。」\n她伸了个懒腰。');
    // 原文照存:模型写的原样
    expect(jevView(body, last().record, kinds).original).toBe(body);
    expect(last().record).toMatchObject({ failed: 2, error: 'Jev 返回 HTTP 500' });
    expect(last().pendingFrom).toBeNull();
  });

  it("leaves the AI-mode kinds to the model and only asks about the Jev ones", async () => {
    const body = '<bg:操场>两人走进食堂。\n<sprite:开心>「今天有咖喱！」';
    const { run, calls, last, shown, flush } = setup(() => [{ bg: '食堂' }, { speaker: 'char' }], {
      jevKinds: { ...NO_JEV, bg: true },
    });
    run.feed(body, false);
    expect(calls[0].req).toMatchObject({ emotions: [], bgms: [], ask_speaker: false });
    expect(calls[0].req.bgs).toHaveLength(2);
    calls[0].resolve();
    await flush();
    // 模型写的立绘标签留着;它写的背景标签摘掉,换成 Jev 判的
    expect(shown(body)).toBe('<bg:食堂>两人走进食堂。\n<sprite:开心>「今天有咖喱！」');
    expect(last().record.kinds).toEqual(['bg']);
  });

  it("marks the player's lines only when they pop up as choices", async () => {
    for (const [popup, expected] of [
      [true, '<我>「我送你回去。」'],
      [false, '「我送你回去。」'],
    ] as const) {
      const { run, calls, shown, flush } = setup(() => [{ speaker: 'user' }], { popup });
      run.feed('「我送你回去。」', false);
      calls[0].resolve();
      await flush();
      expect(shown('「我送你回去。」')).toBe(expected);
    }
  });

  it('keeps only the earliest scene change of the reply', async () => {
    const { run, calls, shown, flush } = setup((req) => req.targets.map(() => ({ bg: '食堂' })));
    run.feed('一。\n二。\n三', true);
    run.feed('一。\n二。\n三。', false);
    expect(calls.map((c) => c.req.targets)).toEqual([[0, 1], [2]]);
    calls[1].resolve();
    await flush();
    calls[0].resolve();
    await flush();
    expect(shown('一。\n二。\n三。')).toBe('<bg:食堂>一。\n二。\n三。');
  });

  it('lists each line with what Jev decided', async () => {
    const { run, calls, flush } = setup(() => [{ bg: '食堂' }, { speaker: 'char', emotion: '微笑' }]);
    run.feed('两人走进食堂。\n「今天有咖喱！」', false);
    calls[0].resolve();
    await flush();
    expect(run.results().map((r) => [r.index, r.text, r.speaker, r.decision !== 'failed' && r.decision?.emotion])).toEqual([
      [0, '两人走进食堂。', null, null],
      [1, '「今天有咖喱！」', '星绘', '微笑'],
    ]);
  });

  it('stops waiting when aborted or when Jev is too slow', async () => {
    const { run, calls, last, shown } = setup(() => [{ speaker: 'char', emotion: '微笑' }]);
    run.feed('「a」\n「b」', false);
    expect(calls).toHaveLength(1);
    await run.settle(20);
    expect(last().pendingFrom).toBeNull();
    expect(shown('「a」\n「b」')).toBe('<sprite:平静>「a」\n<sprite:平静>「b」');
    expect(last().record.failed).toBe(2);
    // 晚到的答案不再改标注
    const before = last();
    calls[0].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(last()).toBe(before);
  });

  it('judges the CG on every line and writes only real changes', async () => {
    const body = '两人回到教室。\n「好困……」\n她趴在桌上睡着了。\n「醒醒,吃饭了。」\n她揉着眼睛坐起来。';
    const answers: Partial<JevDecision>[] = [
      {}, // 没 CG
      { cg: '午睡' }, // 出 CG
      { cg: '午睡' }, // 还是这张:不再写
      { cg_off: true }, // 收起
      { cg_off: true }, // 已经收起了:不再写
    ];
    const { run, calls, shown, flush } = setup((req) => req.targets.map((k) => answers[k]), {
      jevKinds: { ...NO_JEV, cg: true },
    });
    run.feed(body, false);
    // 整段一次到达也一句一句判:上一句回来了才发下一句
    expect(calls.map((c) => c.req.targets)).toEqual([[0]]);
    expect(calls[0].req.cgs.map((c) => c.label)).toEqual(['午睡', '喂饭']);
    expect(calls[0].req.scene).toMatchObject({ cg: null, place: '教室(地点说明)' });
    expect(calls[0].req.ask_speaker).toBe(false);
    const settled = run.settle(100);
    for (let i = 0; i < 5; i++) {
      calls[i].resolve();
      await flush();
    }
    await settled;
    expect(calls.map((c) => c.req.targets)).toEqual([[0], [1], [2], [3], [4]]);
    // 每次都带着上一句判出来的画面
    expect(calls.map((c) => c.req.scene.cg)).toEqual([null, null, '午睡', '午睡', null]);
    expect(shown(body)).toBe('两人回到教室。\n<cg:午睡>「好困……」\n她趴在桌上睡着了。\n<cg:无>「醒醒,吃饭了。」\n她揉着眼睛坐起来。');
  });

  it('keeps the CG on screen when the scene changes', async () => {
    const answers: Partial<JevDecision>[] = [{ bg: '食堂' }, {}];
    const { run, calls, flush } = setup((req) => req.targets.map((k) => answers[k]), {
      jevKinds: { ...NO_JEV, bg: true, cg: true },
      cg: '午睡',
    });
    run.feed('两人走进食堂。\n她坐下了。', false);
    const settled = run.settle(100);
    for (let i = 0; i < 2; i++) {
      calls[i].resolve();
      await flush();
    }
    await settled;
    // 换了场景,告诉 Jev 的画面照样是那张 CG
    expect(calls.map((c) => c.req.scene.cg)).toEqual(['午睡', '午睡']);
  });

  it('tells Jev which CG is on screen when the next line goes out', async () => {
    const { run, calls, flush } = setup((req) => req.targets.map(() => ({ cg: '喂饭' })), {
      jevKinds: { ...NO_JEV, cg: true },
      cg: '午睡',
    });
    run.feed('「啊——」\n她', true);
    expect(calls[0].req.scene.cg).toBe('午睡');
    calls[0].resolve();
    await flush();
    run.feed('「啊——」\n她笑了。', false);
    expect(calls[1].req.scene.cg).toBe('喂饭');
  });
});

describe('tones (a two-level question a cartridge registers)', () => {
  const body = '两人走进食堂。\n「今天有咖喱！」\n「欢迎光临。」店员说。';
  const answer = (req: AnnotateRequest) =>
    req.targets.map((k) =>
      k === 1 ? { speaker: 'char' as const, emotion: '微笑', tone: '高' } : { speaker: null, tone: '低' },
    );

  it('asks for the tone only when told and keeps it on the character lines notes', async () => {
    const { run, calls, last, flush } = setup(answer, { askTone: true });
    run.feed(body, false);
    calls.forEach((c) => c.resolve());
    await flush();
    expect(calls.every((c) => c.req.ask_tone === true)).toBe(true);
    const notes = last().record.notes ?? [];
    expect(notes.map((n) => n.tone ?? null)).toEqual([null, '高', null, null]);
    // 档不写成标签
    expect(notes.map((n) => n.tags)).toEqual(['', '<sprite:微笑>', '', '']);
  });

  it('does not ask without it', () => {
    const { run, calls } = setup(answer);
    run.feed(body, false);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => 'ask_tone' in c.req)).toBe(false);
  });
});

describe('two queues (behind a switch)', () => {
  const body = '两人走进食堂。\n「好困……」\n她趴在桌上睡着了。\n「醒醒,吃饭了。」\n她揉着眼睛坐起来。';
  // 批量那边:第 0 句换到食堂,台词是角色说的、微笑
  const batch = (k: number): Partial<JevDecision> =>
    k === 0 ? { bg: '食堂' } : k % 2 === 1 ? { speaker: 'char', emotion: '微笑' } : {};
  // CG 那边
  const cgAnswers: Partial<JevDecision>[] = [{}, { cg: '午睡' }, { cg: '午睡' }, { cg_off: true }, {}];
  // 假的 Jev:问了哪几类就答哪几类(一条队列时一个请求全问,两条队列时批量的不问 CG、CG 的只问 CG)
  const both = (req: AnnotateRequest) =>
    req.targets.map((k) => ({
      ...(req.emotions.length || req.bgs.length || req.ask_speaker ? batch(k) : {}),
      ...(req.cgs.length ? cgAnswers[k] : {}),
    }));
  const KINDS: JevKinds = { ...ALL, cg: true };

  it('asks the other questions in one batch and CG line by line, CG waiting for the earlier backgrounds', async () => {
    const { run, calls, last, flush } = setup(both, { jevKinds: KINDS, twoQueues: true });
    run.feed(body, false);
    // 一批判全部句子(不带 CG),CG 第 0 句同时发
    expect(calls.map((c) => [c.req.targets, c.req.cgs.length > 0])).toEqual([
      [[0, 1, 2, 3, 4], false],
      [[0], true],
    ]);
    expect(calls[0].req.scene).toMatchObject({ cg: null, place: '' });
    expect(calls[1].req).toMatchObject({ emotions: [], bgs: [], bgms: [], ask_speaker: false });
    expect(calls[1].req.scene).toMatchObject({ cg: null, place: '教室(地点说明)' });
    // CG 第 0 句先回来:第 1 句还要等批量那边把第 0 句的背景判完
    calls[1].resolve();
    await flush();
    expect(calls).toHaveLength(2);
    expect(last().voicePendingFrom).toBe(0);
    calls[0].resolve();
    await flush();
    // 批量回来了:语音不用再等,画面还在一句一句判;CG 第 1 句的地点是判出来的食堂
    expect(calls).toHaveLength(3);
    expect(calls[2].req.targets).toEqual([1]);
    expect(calls[2].req.scene.place).toBe('食堂(地点说明)');
    expect(last().voicePendingFrom).toBeNull();
    expect(last().pendingFrom).toBe(1);
    const settled = run.settle(100);
    for (let i = 2; i < 5; i++) {
      calls[i].resolve();
      await flush();
    }
    calls[5].resolve();
    await flush();
    await settled;
    expect(calls.slice(1).map((c) => c.req.scene.cg)).toEqual([null, null, '午睡', '午睡', null]);
    expect(last().pendingFrom).toBeNull();
  });

  it('ends up with the same tags as judging line by line when Jev gives the same answers', async () => {
    const one = setup(both, { jevKinds: KINDS });
    const two = setup(both, { jevKinds: KINDS, twoQueues: true });
    for (const r of [one, two]) {
      r.run.feed(body, false);
      const settled = r.run.settle(100);
      for (let i = 0; i < 10 && r.calls.some((c) => !c.done); i++) {
        for (const c of r.calls.filter((x) => !x.done)) {
          c.done = true;
          c.resolve();
          await r.flush();
        }
      }
      await settled;
    }
    expect(two.shown(body)).toBe(one.shown(body));
    expect(two.last().record.notes).toEqual(one.last().record.notes);
    // 一条队列 5 个请求;两条队列 1 批 + 5 句 CG
    expect([one.calls.length, two.calls.length]).toEqual([5, 6]);
  });

  it('does nothing different when CG is not Jev, and sends only CG when CG is the only Jev kind', async () => {
    const plain = setup(both, { jevKinds: ALL, twoQueues: true });
    plain.run.feed(body, false);
    expect(plain.calls.map((c) => c.req.targets)).toEqual([[0, 1, 2, 3, 4]]);
    const cgOnly = setup(both, { jevKinds: { ...NO_JEV, cg: true }, twoQueues: true });
    cgOnly.run.feed(body, false);
    expect(cgOnly.calls.map((c) => [c.req.targets, c.req.cgs.length > 0])).toEqual([[[0], true]]);
    expect(cgOnly.last().voicePendingFrom).toBeNull();
  });
});
