import { describe, expect, it } from 'vitest';
import type { SpeakRequest } from '../../lib/api';
import type { ChatEntry } from '../../lib/chatEntry';
import type { TagHit, TagKind, VNLine } from '../script';
import {
  editNote,
  entryRows,
  firstChanged,
  historyBlocks,
  rawSegments,
  revoiceCount,
  showsRaw,
  type BlockItem,
  type HistoryData,
  type HistoryScene,
  type LogLines,
  type RowOptions,
} from './logic';

const entry = (id: string, role: 'user' | 'assistant', text: string, extra: Partial<ChatEntry> = {}): ChatEntry => ({
  id,
  role,
  swipes: [text],
  swipeIndex: 0,
  swipeInfo: [{ sendDate: '' }],
  overswipe: 'regenerate',
  ...extra,
});

const say = (text: string, over: Partial<VNLine> = {}): VNLine => ({ speaker: '星绘', text, ...over });
const narr = (text: string): VNLine => ({ speaker: null, text });
const plan = (text: string): SpeakRequest => ({ profile_id: 'v1', emotion: null, text });
const hit = (lineIndex: number, raw: string): TagHit => ({ kind: 'sprite', raw, label: raw, lineIndex });
const ll = (lines: VNLine[], plans: (SpeakRequest | null)[] = [], hits: TagHit[] = []): LogLines => ({
  lines,
  plans: lines.map((_, i) => plans[i] ?? null),
  hits,
  streaming: false,
});

const dataOf = (map: Record<string, LogLines>, over: Partial<HistoryData> = {}): HistoryData => ({
  of: (e) => map[e.id] ?? null,
  at: null,
  showJa: true,
  jaHidden: () => false,
  esc: { current: null },
  ...over,
});
const opts = (data: HistoryData, over: Partial<RowOptions> = {}): RowOptions => ({
  raw: false,
  one: new Set(),
  editingId: null,
  data,
  sending: false,
  expand: (e) => e.swipes[e.swipeIndex],
  plain: (s) => s,
  ...over,
});

describe('entryRows', () => {
  it('用户消息一行,空的不排', () => {
    const o = opts(dataOf({}));
    expect(entryRows(entry('u', 'user', '你好'), o)).toEqual([{ kind: 'user', key: 'u', entryId: 'u', text: '你好' }]);
    expect(entryRows(entry('u', 'user', '  '), o)).toEqual([]);
  });

  it('回复按画面上的句子一句一行:台词、旁白、你说的', () => {
    const e = entry('a', 'assistant', 'x');
    const lines = [say('「早」'), narr('她笑了。'), say('「嗯」', { speaker: '我', player: true })];
    const rows = entryRows(e, opts(dataOf({ a: ll(lines, [plan('早')]) }, { at: { entryId: 'a', line: 1 } })));
    expect(rows.map((r) => (r.kind === 'line' ? [r.role, r.speaker, r.current, r.plan?.text ?? null] : r.kind))).toEqual([
      ['char', '星绘', false, '早'],
      ['narr', null, true, null],
      ['player', '我', false, null],
    ]);
    expect(rows.map((r) => r.key)).toEqual(['a:0', 'a:1', 'a:2']);
  });

  it('日语小字:字幕关了、这条被隐藏前文日语藏了,都不带', () => {
    const e = entry('a', 'assistant', 'x');
    const lines = [say('「早」', { ja: 'おはよう' })];
    const ja = (o: Partial<HistoryData>) => {
      const r = entryRows(e, opts(dataOf({ a: ll(lines) }, o)))[0];
      return r.kind === 'line' ? r.ja : 'x';
    };
    expect(ja({})).toBe('おはよう');
    expect(ja({ showJa: false })).toBeNull();
    expect(ja({ jaHidden: () => true })).toBeNull();
  });

  it('显示原文:回复合成一整块,只有它在生成时不给改;用户消息照常一行', () => {
    const e = entry('a', 'assistant', '<sprite:开心>「早」');
    const data = dataOf({ a: ll([say('「早」')]) });
    const rows = entryRows(e, opts(data, { raw: true }));
    expect(rows).toEqual([{ kind: 'reply', key: 'a', entryId: 'a', raw: '<sprite:开心>「早」', editable: true, current: false }]);
    expect(entryRows(e, opts(data, { raw: true, sending: true }))[0]).toMatchObject({ editable: false });
    expect(entryRows({ ...e, streaming: true }, opts(data, { raw: true }))[0]).toMatchObject({ editable: false });
    expect(entryRows(entry('u', 'user', '{{user}}说'), opts(data, { raw: true, expand: () => '展开了' }))[0]).toMatchObject({
      text: '{{user}}说',
    });
  });

  it('单独展开 / 正在改的那条也是整块,别的条不动', () => {
    const e = entry('a', 'assistant', '「早」');
    const data = dataOf({ a: ll([say('「早」')]) });
    expect(entryRows(e, opts(data, { one: new Set(['a']) }))[0].kind).toBe('reply');
    expect(entryRows(e, opts(data, { editingId: 'a' }))[0].kind).toBe('reply');
    expect(entryRows(e, opts(data, { one: new Set(['b']) }))[0].kind).toBe('line');
    expect(showsRaw('a', { raw: false, one: new Set(), editingId: null })).toBe(false);
  });

  it('还没切出句子的回复整段放一行,摘掉标签', () => {
    const e = entry('a', 'assistant', '<sprite:开心>你好');
    const rows = entryRows(e, opts(dataOf({}), { plain: (s) => s.replace(/<[^>]+>/g, '') }));
    expect(rows).toEqual([{ kind: 'plain', key: 'a', entryId: 'a', text: '你好', current: false }]);
    expect(entryRows(entry('b', 'assistant', '<sprite:开心>'), opts(dataOf({}), { plain: (s) => s.replace(/<[^>]+>/g, '') }))).toEqual([]);
  });
});

describe('firstChanged(改完原文从哪句开始播)', () => {
  const a = ll([say('「一」'), narr('二'), say('「三」')], [], [hit(0, '<sprite:平静>')]);
  it('一句没变是 -1', () => {
    expect(firstChanged(a, ll([say('「一」'), narr('二'), say('「三」')], [], [hit(0, '<sprite:平静>')]))).toBe(-1);
  });
  it('第一处字不一样的那句', () => {
    expect(firstChanged(a, ll([say('「一」'), narr('二二'), say('「三」')], [], [hit(0, '<sprite:平静>')]))).toBe(1);
    expect(firstChanged(a, ll([say('「一」'), narr('二'), say('「四」')], [], [hit(0, '<sprite:平静>')]))).toBe(2);
  });
  it('字没变、表情标签变了也算', () => {
    expect(firstChanged(a, ll([say('「一」'), narr('二'), say('「三」')], [], [hit(0, '<sprite:开心>')]))).toBe(0);
    expect(firstChanged(a, ll([say('「一」'), narr('二'), say('「三」')], [], [hit(0, '<sprite:平静>'), hit(2, '<sprite:害羞>')]))).toBe(2);
  });
  it('说话人变了、日语变了也算', () => {
    expect(firstChanged(a, ll([say('「一」', { speaker: '别人' }), narr('二'), say('「三」')], [], [hit(0, '<sprite:平静>')]))).toBe(0);
    expect(firstChanged(ll([say('「一」', { ja: 'a' })]), ll([say('「一」', { ja: 'b' })]))).toBe(0);
  });
  it('只删了后面几句 = 剩下的最后一句;后面加了句 = 新加的第一句', () => {
    expect(firstChanged(a, ll([say('「一」')], [], [hit(0, '<sprite:平静>')]))).toBe(0);
    expect(firstChanged(a, ll([say('「一」'), narr('二')], [], [hit(0, '<sprite:平静>')]))).toBe(1);
    expect(firstChanged(a, ll([say('「一」'), narr('二'), say('「三」'), narr('四')], [], [hit(0, '<sprite:平静>')]))).toBe(3);
  });
  it('原来没有句子 = 从头;新的没有句子 = -1', () => {
    expect(firstChanged(null, a)).toBe(0);
    expect(firstChanged(a, null)).toBe(-1);
    expect(firstChanged(a, ll([]))).toBe(-1);
  });
});

describe('语音重念和小字', () => {
  it('要念的句子里原来没有同样文字的才算', () => {
    const old = ll([say('「一」'), say('「二」')], [plan('一'), plan('二')]);
    const nu = ll([say('「一」'), say('「二二」'), narr('三')], [plan('一'), plan('二二'), plan('三')]);
    expect(revoiceCount(old, nu)).toBe(2);
    expect(revoiceCount(old, old)).toBe(0);
    expect(revoiceCount(null, nu)).toBe(3);
    expect(revoiceCount(old, null)).toBe(0);
    // 不念的句子不算
    expect(revoiceCount(old, ll([say('「新」')]))).toBe(0);
  });
  it('列表里那行小字', () => {
    expect(editNote(0)).toBe('改过');
    expect(editNote(2)).toBe('改过 · 2 句语音重念');
  });
});

describe('rawSegments(原文里的标签和宏标成浅色小字)', () => {
  const kinds: TagKind[] = [{ kind: 'sprite', pattern: /<sprite:([^>]+)>/, prefix: '<sprite:' }];
  it('标签、宏分出来,正文原样', () => {
    const segs = rawSegments('<sprite:开心>「早,{{user}}」\n她笑了<sprite:害羞>', kinds);
    expect(segs.map((s) => [s.text, s.mark])).toEqual([
      ['<sprite:开心>', true],
      ['「早,', false],
      ['{{user}}', true],
      ['」\n她笑了', false],
      ['<sprite:害羞>', true],
    ]);
    expect(segs.map((s) => s.text).join('')).toBe('<sprite:开心>「早,{{user}}」\n她笑了<sprite:害羞>');
  });
  it('没有标签就是一整段;模板不合法(pattern 为 null)的那类不认', () => {
    expect(rawSegments('你好', kinds)).toEqual([{ text: '你好', mark: false }]);
    expect(rawSegments('<x>', [{ kind: 'bg', pattern: null, prefix: '' }])).toEqual([{ text: '<x>', mark: false }]);
    expect(rawSegments('', kinds)).toEqual([]);
  });
});

describe('historyBlocks', () => {
  const bg = (id: string): HistoryScene['bg'] => ({ id, label: id, src: null, focus: 50 });
  const cg = (id: string): HistoryScene['cg'] => ({ id, thumb: `/${id}`, full: null });
  // a(两句) · 你 · b(两句):a 第 2 句出 CG,一直到 b 第 1 句;b 第 2 句换了背景
  const entries = [entry('a', 'assistant', 'x'), entry('u', 'user', '继续'), entry('b', 'assistant', 'y')];
  const scenes: Record<string, HistoryScene[]> = {
    a: [{ bg: bg('卧室'), cg: null }, { bg: bg('卧室'), cg: cg('床') }],
    u: [{ bg: bg('卧室'), cg: cg('床') }],
    b: [{ bg: bg('卧室'), cg: cg('床') }, { bg: bg('天台'), cg: null }],
  };
  const data = dataOf(
    { a: ll([say('「一」'), narr('二')]), b: ll([say('「三」'), narr('四')]) },
    { scene: (id, line) => scenes[id]?.[line] ?? null },
  );
  const tag = (it: BlockItem) =>
    `${it.t}${it.t === 'row' ? `:${it.key}` : ''}${it.rail.on ? `|${it.rail.start ? 's' : ''}${it.rail.end ? 'e' : ''}` : ''}`;

  it('一条消息一块:开头一行,下面是句子;背景换了插横幅(列表第一行也算)', () => {
    const blocks = historyBlocks(entries, 0, -1, opts(data));
    expect(blocks.map((b) => [b.entry.id, b.user])).toEqual([
      ['a', false],
      ['u', true],
      ['b', false],
    ]);
    expect(blocks.flatMap((b) => b.items).filter((it) => it.t === 'scene').map((it) => it.t === 'scene' && it.bg.id)).toEqual([
      '卧室',
      '天台',
    ]);
  });

  it('CG 竖线从出现那句起(小图放在它左边,不占行),跨过你的消息,到收起前那句止', () => {
    const blocks = historyBlocks(entries, 0, -1, opts(data));
    expect(blocks.map((b) => b.items.map(tag))).toEqual([
      ['scene', 'head', 'row:a:0', 'cg|s', 'row:a:1|s'],
      ['head|', 'row:u|'],
      ['head|', 'row:b:0|e', 'scene', 'row:b:1'],
    ]);
    // 线头那句是这条的最后一句:要撑高
    const shots = blocks.flatMap((x) => x.items).flatMap((it) => (it.t === 'cg' ? [[it.span, it.alone]] : []));
    expect(shots).toEqual([[3, true]]);
  });

  it('直接换成下一张:前一张到这句止,下一张从下一句起;小图记着显示几句', () => {
    const two = { a: [{ bg: null, cg: cg('A') }, { bg: null, cg: { ...cg('B')!, ai: true } }, { bg: null, cg: null }] };
    const d = dataOf(
      { a: ll([say('「一」'), narr('二'), narr('三')]) },
      { scene: (id, line) => two[id as 'a']?.[line] ?? null },
    );
    const [b] = historyBlocks([entry('a', 'assistant', 'x')], 0, -1, opts(d));
    expect(b.items.map(tag)).toEqual(['head', 'cg|s', 'row:a:0|se', 'cg|s', 'row:a:1|se', 'row:a:2']);
    expect(b.items.flatMap((it) => (it.t === 'cg' ? [[it.span, it.alone]] : []))).toEqual([
      [1, true],
      [1, true],
    ]);
  });

  it('CG 从一条回复的第一句开始:线从小图起,开头那行不画', () => {
    const only = { a: [{ bg: null, cg: cg('床') }, { bg: null, cg: cg('床') }] };
    const d = dataOf({ a: ll([say('「一」'), narr('二')]) }, { scene: (id, line) => only[id as 'a']?.[line] ?? null });
    const [b] = historyBlocks([entry('a', 'assistant', 'x')], 0, -1, opts(d));
    expect(b.items.map(tag)).toEqual(['head', 'cg|s', 'row:a:0|s', 'row:a:1|e']);
    expect(b.items.flatMap((it) => (it.t === 'cg' ? [it.alone] : []))).toEqual([false]);
  });

  it('「现在」后面的句子和整条消息标 later;不知道现在在哪就都不淡', () => {
    const now = dataOf({ a: ll([say('「一」'), narr('二')]), b: ll([say('「三」')]) }, { at: { entryId: 'a', line: 0 } });
    const blocks = historyBlocks(entries, 0, 0, opts(now));
    const later = (b: (typeof blocks)[number]) => b.items.flatMap((it) => (it.t === 'row' ? [it.later] : []));
    expect(blocks.map((b) => b.later)).toEqual([false, true, true]);
    expect(later(blocks[0])).toEqual([false, true]);
    expect(later(blocks[2])).toEqual([true]);
    expect(historyBlocks(entries, 0, -1, opts(now)).every((b) => !b.later)).toBe(true);
  });

  it('「现在」后面的 CG 小图、横幅也标 later(还没看到的图不剧透)', () => {
    const now = dataOf(
      { a: ll([say('「一」'), narr('二')]), b: ll([say('「三」'), narr('四')]) },
      { at: { entryId: 'a', line: 0 }, scene: (id, line) => scenes[id]?.[line] ?? null },
    );
    const flat = historyBlocks(entries, 0, 0, opts(now)).flatMap((b) => b.items);
    const pics = flat.flatMap((it) => (it.t === 'cg' || it.t === 'scene' ? [`${it.t}:${it.later}`] : []));
    expect(pics).toEqual(['scene:false', 'cg:true', 'scene:true']);
  });

  it('只排后面几条时(first > 0)下标照整段对话算', () => {
    const now = dataOf({ b: ll([say('「三」'), narr('四')]) }, { at: { entryId: 'b', line: 0 } });
    const [b] = historyBlocks([entries[2]], 2, 2, opts(now));
    expect(b.later).toBe(false);
    expect(b.items.flatMap((it) => (it.t === 'row' ? [it.later] : []))).toEqual([false, true]);
  });
});
