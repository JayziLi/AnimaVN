import { describe, expect, it } from 'vitest';
import type { Fold, LineState, Timeline } from '../core/timeline';
import { sprite } from '../core/timeline.fixtures';
import type { PackSprite } from '../lib/api';
import { emotionCandidates, type TagMatch } from '../plugins/emotionMatch';
import { manualLabel } from '../plugins/manualMarks';
import {
  cellSourceText,
  effectiveEmotion,
  emotionHow,
  manualSelect,
  originIn,
  originText,
  recordable,
  speakerText,
  voicePickText,
  type EmotionHowInput,
} from './inspectorText';
import { parseReply, type VNLine } from './script';
import { vnTagKinds } from './tags';

const how = (over: Partial<EmotionHowInput>) =>
  emotionHow({
    manual: null,
    tag: null,
    line: 0,
    by: 'ai',
    fromStart: false,
    shown: '微笑',
    rawOnFail: false,
    mapped: null,
    ...over,
  });
const tag = (word: string, match: TagMatch, line = 0) => ({ word, line, match });

describe('emotionHow', () => {
  it('手改的:只说是你改的;这句有标签时带上原来写的词', () => {
    expect(how({ manual: '害羞' })).toBe('你手改的,只改这一句');
    expect(how({ manual: '害羞', tag: tag('羞耻', { state: 'exact', label: '害羞' }) })).toBe(
      '你手改的,只改这一句(AI 写的是「羞耻」)',
    );
  });

  it('手改的不提形态换算(玩家明说的)', () => {
    expect(how({ manual: '害羞', mapped: { from: '开心', form: '夜晚' } })).toBe('你手改的,只改这一句');
  });

  it('名字对上、别名对上:不分大小写、去掉首尾空白', () => {
    expect(how({ tag: tag('开心', { state: 'exact', label: '开心' }) })).toBe('AI 写的是「开心」,名字对上');
    expect(how({ tag: tag(' Joy ', { state: 'exact', label: 'joy' }) })).toBe('AI 写的是「 Joy 」,名字对上');
    expect(how({ tag: tag('坏笑', { state: 'exact', label: '调皮' }) })).toBe('AI 写的是「坏笑」,是「调皮」的别名');
  });

  it('认词记录带来源,模型带相似度', () => {
    expect(how({ tag: tag('嘟嘴', { state: 'record', label: '微笑', source: 'model' }) })).toBe(
      'AI 写的是「嘟嘴」,认词记录认成「微笑」(模型认过一次)',
    );
    expect(how({ tag: tag('嘟嘴', { state: 'record', label: '微笑', source: 'player' }) })).toBe(
      'AI 写的是「嘟嘴」,认词记录认成「微笑」(你改的)',
    );
    expect(how({ tag: tag('嘟嘴', { state: 'model', label: '微笑', score: 0.7123 }) })).toBe(
      'AI 写的是「嘟嘴」,模型认成「微笑」(相似度 0.71)',
    );
  });

  it('还在认、认不出:保持上一句;没配立绘时认不出用原词', () => {
    expect(how({ tag: tag('嘟嘴', { state: 'pending' }) })).toBe('AI 写的是「嘟嘴」,模型还在认,先保持上一句');
    expect(how({ tag: tag('嘟嘴', { state: 'failed', reason: '模型没装' }) })).toBe(
      'AI 写的是「嘟嘴」,认不出(模型没装),保持上一句',
    );
    expect(how({ rawOnFail: true, tag: tag('嘟嘴', { state: 'failed', reason: '模型没装' }) })).toBe(
      'AI 写的是「嘟嘴」,认不出(模型没装),没配立绘,直接用原词',
    );
  });

  it('谁写的:Jev 标的、开场白里写的', () => {
    expect(how({ by: 'jev', tag: tag('开心', { state: 'exact', label: '开心' }) })).toBe('Jev 标的是「开心」,名字对上');
    expect(how({ by: 'card', tag: tag('开心', { state: 'exact', label: '开心' }) })).toBe(
      '开场白里写的是「开心」,名字对上',
    );
  });

  it('标签写在这条回复前面的句子上:沿用第几句', () => {
    expect(how({ line: 3, tag: tag('开心', { state: 'exact', label: '开心' }, 1) })).toBe(
      '沿用第 2 句:AI 写的是「开心」,名字对上',
    );
  });

  it('这条回复到这句没写标签:沿用上一句;从开局起就没写过:开局默认', () => {
    expect(how({ line: 2 })).toBe('这句没写表情,沿用上一句');
    expect(how({ fromStart: true })).toBe('开局默认那张');
    expect(how({ fromStart: true, shown: null })).toBe('还没写过表情');
  });

  it('形态换算过:接在后面写换算到这个形态的默认图', () => {
    expect(how({ tag: tag('开心', { state: 'exact', label: '开心' }), mapped: { from: '开心', form: '夜晚' } })).toBe(
      'AI 写的是「开心」,名字对上;「开心」不在「夜晚」这个形态里,换算到这个形态的默认图',
    );
    expect(how({ fromStart: true, shown: null, mapped: { from: null, form: '夜晚' } })).toBe(
      '还没写过表情;换算到这个形态的默认图',
    );
  });
});

// ---- 手改的表情 ----

const choicesOf = (sprites: readonly PackSprite[]) => emotionCandidates(sprites).map((c) => ({ item: c.key, label: c.label }));
const PACK = [sprite('s1', '微笑'), sprite('s2', '平静'), sprite('s3', '生气')];

describe('manualSelect', () => {
  const choices = choicesOf(PACK);

  it('没改:不选、占位写「选一张…」', () => {
    expect(manualSelect(undefined, choices)).toEqual({ value: '', placeholder: '选一张…' });
  });

  it('改了、找得到:选中那一张(按立绘 id,改过名也认得),不要占位', () => {
    expect(manualSelect({ item: 's1', label: '微笑' }, choices)).toEqual({ value: 's1', placeholder: null });
    expect(manualSelect({ item: 's2', label: '以前叫这个' }, choices)).toEqual({ value: 's2', placeholder: null });
  });

  it('id 对不上(删了重建的)按记下的名字找', () => {
    expect(manualSelect({ item: 'old', label: '生气' }, choices)).toEqual({ value: 's3', placeholder: null });
  });

  it('真找不到才是「改的那张不在了」', () => {
    expect(manualSelect({ item: 'gone', label: '不存在' }, choices)).toEqual({ value: '', placeholder: '改的那张不在了' });
  });

  it('没配立绘:在内置表情里找(item 就是表情名)', () => {
    const builtin = choicesOf([]);
    const first = builtin[0];
    expect(manualSelect({ item: first.item, label: first.label }, builtin)).toEqual({ value: first.item, placeholder: null });
    expect(manualSelect({ item: '没有这个', label: first.label }, builtin)).toEqual({ value: first.item, placeholder: null });
  });

  it('和 manualLabel(画面、语音用的那个)找到的是同一张', () => {
    const marks = [
      { line: 0, item: 's1', label: '微笑' },
      { line: 0, item: 's2', label: '以前叫这个' },
      { line: 0, item: 'old', label: '生气' },
      { line: 0, item: 'gone', label: '不存在' },
    ];
    for (const sprites of [PACK, []]) {
      const choices = choicesOf(sprites);
      for (const m of [...marks, { line: 0, item: choices[1].item, label: '别的' }]) {
        const { value } = manualSelect(m, choices);
        expect(choices.find((c) => c.item === value)?.label ?? null).toBe(manualLabel(m, sprites));
      }
    }
  });
});

describe('effectiveEmotion', () => {
  it('手改了:就是手改的那张,注明是你改的', () => {
    expect(effectiveEmotion('害羞', '平静')).toEqual({ v: '害羞', note: '你手改的' });
    expect(effectiveEmotion('害羞', null)).toEqual({ v: '害羞', note: '你手改的' });
  });

  it('没改:照旧是标签累计下来的,没有写「无」', () => {
    expect(effectiveEmotion(null, '平静')).toEqual({ v: '平静' });
    expect(effectiveEmotion(null, null)).toEqual({ v: '无' });
  });
});

describe('recordable', () => {
  it('认词记录、模型认的才能「以后都认成」', () => {
    expect(recordable({ state: 'record', label: 'a', source: 'migrated' })).toBe(true);
    expect(recordable({ state: 'model', label: 'a', score: 0.5 })).toBe(true);
    expect(recordable({ state: 'exact', label: 'a' })).toBe(false);
    expect(recordable({ state: 'pending' })).toBe(false);
    expect(recordable({ state: 'failed', reason: 'x' })).toBe(false);
  });
});

// ---- 背景、CG 从哪来 ----

const st = (bg: string | null): LineState =>
  ({ spriteLabel: null, shownLabel: null, form: null, scene: { bg, bgm: null, bgmFrom: null, cg: null }, cgFrame: null }) as unknown as LineState;
const fold = (bg: string | null): Fold =>
  ({ spriteLabel: null, scene: { bg, bgm: null, bgmFrom: null, cg: null }, cgFrom: null }) as unknown as Fold;
const entry = (start: string | null, lines: (string | null)[], end: string | null) => ({
  start: fold(start),
  lines: lines.map(st),
  empty: st(lines[0] ?? start),
  end: fold(end),
});
const timeline = (initial: string | null, entries: ReturnType<typeof entry>[]): Timeline =>
  ({ initial: st(initial), entries, end: entries.length ? entries[entries.length - 1].end : fold(initial) }) as unknown as Timeline;
const bgOf = (s: LineState | Fold) => s.scene.bg as unknown as string | null;

describe('originIn', () => {
  const tl = timeline('A', [
    entry('A', ['A', 'B', 'B', 'B'], 'B'),
    entry('B', ['B', 'B'], 'C'),
    entry('C', ['D', 'D', 'D'], 'D'),
  ]);

  it('还没有回复:开局', () => {
    expect(originIn(tl, -1, 0, bgOf)).toEqual({ at: 'initial' });
  });

  it('这句换的、这条回复前面第几句换的', () => {
    expect(originIn(tl, 0, 1, bgOf)).toEqual({ at: 'here' });
    expect(originIn(tl, 0, 3, bgOf)).toEqual({ at: 'line', line: 1 });
    // 第一句就和这条开头不一样:第一句换的
    expect(originIn(tl, 2, 0, bgOf)).toEqual({ at: 'here' });
    expect(originIn(tl, 2, 2, bgOf)).toEqual({ at: 'line', line: 0 });
  });

  it('之前的回复里换的', () => {
    expect(originIn(tl, 1, 1, bgOf)).toEqual({ at: 'before' });
  });

  it('开局起没变过;变过又变回来的不算开局', () => {
    expect(originIn(tl, 0, 0, bgOf)).toEqual({ at: 'initial' });
    const back = timeline('A', [entry('A', ['B', 'A'], 'A'), entry('A', ['A'], 'A')]);
    expect(originIn(back, 1, 0, bgOf)).toEqual({ at: 'before' });
  });

  it('句号超出范围时按最后一句算;一句都没有的回复看 empty', () => {
    expect(originIn(tl, 0, 99, bgOf)).toEqual({ at: 'line', line: 1 });
    const none = timeline('A', [entry('A', [], 'A')]);
    expect(originIn(none, 0, 0, bgOf)).toEqual({ at: 'initial' });
  });
});

describe('originText', () => {
  it('大白话', () => {
    expect(originText({ at: 'here' })).toBe('这句换的');
    expect(originText({ at: 'line', line: 2 })).toBe('沿用第 3 句');
    expect(originText({ at: 'before' })).toBe('沿用之前的');
    expect(originText({ at: 'initial' })).toBe('开局默认');
  });
});

// ---- 说话人 ----

const ln = (over: Partial<VNLine>): VNLine => ({ speaker: '星绘', text: '「你好」', ...over });

describe('speakerText', () => {
  it('角色的台词前没写名字:默认是她;写了(named)只写名字', () => {
    const o = { charName: '星绘' };
    expect(speakerText(ln({}), o)).toBe('星绘(台词前没写名字,默认是她)');
    expect(speakerText(ln({ named: true }), o)).toBe('星绘');
  });

  it('按切句的结果:写了名字的长台词切成几句,后几句也不说「没写名字」', () => {
    const tags = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
    const opts = { charName: '星绘', userName: 'Lj', tags, streaming: false };
    const long = `「${'今天也辛苦了。'.repeat(20)}」`;
    const named = parseReply(`<sprite:开心>星绘：${long}`, opts).lines;
    expect(named.length).toBeGreaterThan(1);
    expect(named.map((l) => speakerText(l, opts))).toEqual(named.map(() => '星绘'));
    // 没写名字的长台词每句都注明
    const bare = parseReply(`<sprite:开心>${long}`, opts).lines;
    expect(bare.length).toBeGreaterThan(1);
    expect(bare.map((l) => speakerText(l, opts))).toEqual(bare.map(() => '星绘(台词前没写名字,默认是她)'));
  });

  it('别人、旁白、玩家、没带标签的', () => {
    const o = { charName: '星绘' };
    expect(speakerText(ln({ speaker: '店员' }), o)).toBe('店员');
    expect(speakerText(ln({ speaker: null }), o)).toBe('旁白');
    expect(speakerText(ln({ speaker: '我', player: true }), o)).toBe('我(玩家台词)');
    expect(speakerText(ln({ speaker: null, untagged: true }), o)).toBe('(没写立绘标签,不算角色的)');
    expect(speakerText(ln({ speaker: null, untagged: true }), { ...o, jev: true })).toBe('(Jev 判成不是角色说的)');
  });
});

// ---- 语音:配对表 ----

const cell = (over: Partial<{ source: string; guessed: boolean; pending: boolean; unstable: boolean }> = {}) => ({
  source: 'migrated',
  guessed: false,
  pending: false,
  unstable: false,
  ...over,
});

describe('cellSourceText', () => {
  it('来源加小标(和插件页配对表同一份叫法)', () => {
    expect(cellSourceText(cell())).toBe('旧结果');
    expect(cellSourceText(cell({ guessed: true, unstable: true }))).toBe('旧结果 · 模型猜的 · 今天本来就不稳定');
    expect(cellSourceText(cell({ source: 'local', pending: true, unstable: true }))).toBe('本地模型配的 · 今天本来就不稳定 · 待重配');
    expect(cellSourceText(cell({ source: 'name' }))).toBe('同名');
    expect(cellSourceText(cell({ source: 'player' }))).toBe('你改的');
    expect(cellSourceText(cell({ source: 'chat' }))).toBe('聊天模型配的');
    expect(cellSourceText(cell({ source: 'jev' }))).toBe('Jev 配的');
    expect(cellSourceText(cell({ source: '别的' }))).toBe('别的');
  });
});

describe('voicePickText', () => {
  it('旧算法:按名字挑', () => {
    expect(voicePickText({ records: false, sprite: '开心', row: null })).toBe('按名字挑');
  });

  it('配对表配好的:立绘 → 那一行(来源);来源还没读到时不写', () => {
    expect(voicePickText({ records: true, sprite: '开心', row: '平静', cell: cell({ guessed: true }) })).toBe(
      '配对表:开心 → 平静(旧结果 · 模型猜的)',
    );
    expect(voicePickText({ records: true, sprite: '开心', row: '平静' })).toBe('配对表:开心 → 平静');
  });

  it('表里还没有这张、不是包里的表情:先按名字挑', () => {
    expect(voicePickText({ records: true, sprite: '开心', row: null })).toBe('配对表里还没有「开心」这张,先按名字挑');
    expect(voicePickText({ records: true, sprite: null, row: null })).toBe('按名字挑');
  });
});
