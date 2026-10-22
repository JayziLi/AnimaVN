import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../../lib/api';
import { askRequest, questionOf, SAMPLE_LINE, type AskInput } from './jevAsk';

const asset = (id: string, kind: SceneAsset['kind'], label: string, over: Partial<SceneAsset> = {}): SceneAsset =>
  ({ id, kind, label, aliases: [], description: '', bgm_id: null, ...over }) as SceneAsset;

const bgs = [asset('b1', 'bg', '刻晴的房间', { bgm_id: 'm2', description: '玉衡星的书房' }), asset('b2', 'bg', '茶馆')];
const bgms = [asset('m1', 'bgm', '日常'), asset('m2', 'bgm', '温馨')];
const cgs = [asset('c1', 'cg', '烟花')];

const input = (over: Partial<AskInput> = {}): AskInput => ({
  kind: 'emotion',
  char: '刻晴',
  user: 'Lj',
  line: '「哼。」',
  sprites: [{ label: '害羞', aliases: ['脸红'], description: '' }],
  bgs,
  bgms,
  cgs,
  thresholds: { speaker: 0.8, bg: 0.6, bgm: 0.6, cg: 0.6 },
  prompts: { emotion: '改过的' },
  ...over,
});

describe('抽屉里拼的 Jev 请求', () => {
  it('表情:只带表情名单、问谁说的,这句算角色的', () => {
    const r = askRequest(input())!;
    expect(r.emotions).toEqual([{ label: '害羞', aliases: ['脸红'], description: '' }]);
    expect(r.bgs).toEqual([]);
    expect(r.ask_speaker).toBe(true);
    expect(r.lines).toEqual([{ text: '「哼。」', speaker: '刻晴' }]);
    expect(r.prompts).toEqual({ emotion: '改过的' });
    expect(questionOf('emotion')).toBe('e1');
  });

  it('没立绘的卡用内置表情;没写句子用示例', () => {
    const r = askRequest(input({ sprites: [], line: '  ' }))!;
    expect(r.emotions.length).toBeGreaterThan(3);
    expect(r.lines[0].text).toBe(SAMPLE_LINE);
  });

  it('背景:当作还在第一张、放它的默认曲,这句当旁白;只有一张背景不问', () => {
    const r = askRequest(input({ kind: 'bg' }))!;
    expect(r.scene).toMatchObject({ bg: '刻晴的房间', bgm: '温馨' });
    expect(r.lines[0].speaker).toBeNull();
    expect(r.emotions).toEqual([]);
    expect(askRequest(input({ kind: 'bg', bgs: [bgs[0]] }))).toBeNull();
    expect(questionOf('bg')).toBe('bg1');
  });

  it('BGM:只带曲子;只有一首不问', () => {
    const r = askRequest(input({ kind: 'bgm' }))!;
    expect(r.bgms.map((m) => m.label)).toEqual(['日常', '温馨']);
    expect(r.bgs).toEqual([]);
    expect(askRequest(input({ kind: 'bgm', bgms: [bgms[0]] }))).toBeNull();
  });

  it('CG:当作画面上是第一张 CG,地点带背景说明;没有 CG 不问', () => {
    const r = askRequest(input({ kind: 'cg' }))!;
    expect(r.scene).toMatchObject({ cg: '烟花', place: '刻晴的房间(玉衡星的书房)' });
    expect(askRequest(input({ kind: 'cg', cgs: [] }))).toBeNull();
  });
});
