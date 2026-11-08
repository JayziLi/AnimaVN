import { describe, expect, it } from 'vitest';
import type { ImportGroup, ImportPlan, ImportVoiceFolderDetail, ImportVoiceTarget } from '../lib/api';
import type { ImportTarget } from './dropTarget';
import {
  VOICE_FOLDER_SHOWN,
  applyBody,
  confirmModel,
  libraryRouteAfterImport,
  planHasVoices,
  shouldConfirm,
  voiceFolderCounts,
  voiceFolderEffect,
  voiceFolderOnly,
  voiceFolderPick,
  voiceFolderSkipped,
  voiceFolderTargets,
  voiceFolderView,
} from './importModel';

const NONE: ImportTarget = { cardId: null, cardName: null, kind: null };

const target = (over: Partial<ImportVoiceTarget> & Pick<ImportVoiceTarget, 'id'>): ImportVoiceTarget => ({
  name: over.id,
  api_type: 'gpt_sovits',
  usable: true,
  reason: '',
  note: '',
  best: false,
  ...over,
});

const refs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: i === 0 ? '平静' : `情绪${i}`, text: `第 ${i} 句`, file: `凯露 's 声音/refs/${i}.wav` }));

const detail = (over: Partial<ImportVoiceFolderDetail> = {}): ImportVoiceFolderDetail => ({
  name: "凯露 's 声音(日语)",
  folder: "凯露 's 声音",
  lang: 'ja',
  models: [
    { kind: 'gpt', name: '凯露-e15.ckpt', size: 150_000_000, file: "凯露 's 声音/models/凯露-e15.ckpt" },
    { kind: 'sovits', name: '凯露_e8_s152.pth', size: 90_000_000, file: "凯露 's 声音/models/凯露_e8_s152.pth" },
  ],
  refs: refs(6),
  skipped: ['voice_031.wav', 'voice_044.wav', '凯露-e8.ckpt'],
  existing: null,
  connections: [target({ id: 'g1', name: '台式机', best: true }), target({ id: 'i1', name: '索引', api_type: 'indextts', note: '只拿参考音频' })],
  ...over,
});

const group = (d: ImportVoiceFolderDetail = detail(), key = 'voice:1'): ImportGroup => ({
  key,
  type: 'voice_folder',
  name: d.name,
  count: d.refs.length,
  owner: null,
  duplicate_of: null,
  detail: d,
});

const plan = (groups: ImportGroup[], extra: Partial<ImportPlan> = {}): ImportPlan => ({
  plan_id: 'pl',
  groups,
  unknown: [],
  skipped: [],
  needs_confirm: true,
  ...extra,
});

describe('voice folder in the plan', () => {
  it('is recognised only when it is the whole drop', () => {
    expect(voiceFolderOnly(plan([group()]))?.key).toBe('voice:1');
    expect(voiceFolderOnly(plan([group()], { unknown: ['a.png'] }))).toBeNull();
    expect(voiceFolderOnly(plan([group(), group(detail(), 'voice:2')]))).toBeNull();
    expect(planHasVoices(plan([group()]))).toBe(true);
    expect(shouldConfirm(plan([group()], { needs_confirm: false }))).toBe(true);
  });

  it('counts: 2 个模型 + 12 段参考, refs only when there is no model', () => {
    expect(voiceFolderCounts(detail({ refs: refs(12) }))).toBe('2 个模型 + 12 段参考');
    expect(voiceFolderCounts(detail({ models: [] }))).toBe('6 段参考');
  });

  it('shows the first four emotions and the rest after expanding', () => {
    const d = detail({ refs: refs(12) });
    const v = voiceFolderView(group(d), null, false);
    expect(VOICE_FOLDER_SHOWN).toBe(4);
    expect(v.emotions).toHaveLength(4);
    expect(v.hidden).toBe(8);
    expect(v.emotions[0]).toEqual({ label: '平静', text: '第 0 句' });
    const all = voiceFolderView(group(d), null, true);
    expect(all.emotions).toHaveLength(12);
    expect(all.hidden).toBe(0);
  });

  it('view: file count includes the skipped, kana hint, model names, source from the folder name', () => {
    const v = voiceFolderView(group(), null, false);
    expect(v.meta).toEqual({ source: "凯露 's 声音", files: 2 + 6 + 3, modelBytes: 240_000_000 });
    expect(v.models).toEqual({ count: 2, names: '凯露-e15.ckpt · 凯露_e8_s152.pth' });
    expect(v.kana).toBe(true);
    expect(voiceFolderView(group(detail({ lang: 'zh' })), '声音.zip', false).kana).toBe(false);
    expect(voiceFolderView(group(), '声音.zip', false).meta.source).toBe('声音.zip');
  });

  it('title and effect rows in the generic confirm list (mixed drops)', () => {
    const m = confirmModel(plan([group()]), NONE, null, false);
    expect(m.rows[0]).toMatchObject({ icon: 'voice', title: "声音「凯露 's 声音(日语)」· 2 个模型 + 6 段参考" });
    expect(m.rows[0].effect).toBe('另建一个声音,先放进素材库,不挂到卡上');
    const twin = confirmModel(plan([group(detail({ existing: { id: 'v9', name: '凯露' } }))]), NONE, null, false);
    expect(twin.rows[0].effect).toContain('直接用那条');
  });
});

describe('skipped note', () => {
  it('audio without a proper name, and older models, in two sentences', () => {
    expect(voiceFolderSkipped(['voice_031.wav', 'voice_044.wav', '凯露-e8.ckpt'])).toEqual([
      'voice_031.wav、voice_044.wav 看不出情绪和原文,先不导。要用就改名成「【情绪】原文.wav」再导一次。',
      '凯露-e8.ckpt 是旧的一轮,没导(同一种模型只取轮数最大的)。',
    ]);
    expect(voiceFolderSkipped([])).toEqual([]);
    expect(voiceFolderSkipped(['a.wav', 'b.wav', 'c.wav', 'd.wav'])[0]).toMatch(/^a\.wav、b\.wav、c\.wav 等 4 个 看不出/);
  });
});

describe('where to attach', () => {
  it('rows: disabled ones say why, the best gsv with models says it fits best', () => {
    const d = detail({
      connections: [
        target({ id: 'g1', name: '台式机', best: true }),
        target({ id: 'i1', name: '索引', api_type: 'indextts', note: '只拿参考音频' }),
        target({ id: 'g2', name: '笔记本', usable: false, reason: '没有模型' }),
      ],
    });
    expect(voiceFolderTargets(d)).toEqual([
      { id: 'g1', name: '台式机', note: '最像:模型和参考音频都用上', disabled: false, good: true },
      { id: 'i1', name: '索引', note: '只拿参考音频', disabled: false, good: false },
      { id: 'g2', name: '笔记本', note: '没有模型', disabled: true, good: false },
    ]);
    // 没有模型时 IndexTTS 是推荐的:不写「最像」
    const refsOnly = detail({
      models: [],
      connections: [target({ id: 'g2', usable: false, reason: '没有模型' }), target({ id: 'i1', api_type: 'indextts', best: true, note: '用参考音频' })],
    });
    expect(voiceFolderTargets(refsOnly).map((r) => [r.note, r.good])).toEqual([
      ['没有模型', false],
      ['用参考音频', false],
    ]);
  });

  it('pick: chosen if usable, else the recommended, else the first usable, else none', () => {
    const d = detail({
      connections: [target({ id: 'g1', usable: false, reason: '没有模型' }), target({ id: 'i1', api_type: 'indextts' }), target({ id: 'i2', api_type: 'indextts', best: true })],
    });
    expect(voiceFolderPick(d, undefined)).toBe('i2');
    expect(voiceFolderPick(d, 'i1')).toBe('i1');
    expect(voiceFolderPick(d, 'g1')).toBe('i2'); // 选的用不了
    expect(voiceFolderPick(d, 'gone')).toBe('i2');
    expect(voiceFolderPick(detail({ connections: [target({ id: 'g1', usable: false })] }), undefined)).toBeNull();
    expect(voiceFolderPick(detail({ connections: [] }), 'x')).toBeNull();
  });

  it('effect line', () => {
    const conns = [
      { id: 'g1', name: '台式机', base_url: 'http://10.0.0.2:9880' },
      { id: 'l1', name: '本机', base_url: 'http://127.0.0.1:9880' },
    ];
    expect(voiceFolderEffect(detail(), 'g1', conns)).toBe('台式机在另一台电脑:导完自动把文件送过去,送完就能念。');
    expect(voiceFolderEffect(detail(), 'l1', conns)).toBe('本机:导完自动准备好文件,好了就能念。');
    expect(voiceFolderEffect(detail(), 'g1', null)).toBe('');
    expect(voiceFolderEffect(detail({ existing: { id: 'v', name: 'x' } }), 'g1', conns)).toContain('直接用那条');
    expect(voiceFolderEffect(detail({ connections: [] }), null, conns)).toContain('127.0.0.1:9880');
    expect(voiceFolderEffect(detail({ connections: [], models: [] }), null, conns)).toContain('IndexTTS');
    expect(voiceFolderEffect(detail({ connections: [target({ id: 'g1', usable: false })] }), null, conns)).toContain('要 GPT-SoVITS 才能念');
    expect(voiceFolderEffect(detail({ models: [], connections: [target({ id: 'g1', usable: false })] }), null, conns)).toContain('没有模型');
    const fish = [{ id: 'f1', name: 'Fish', base_url: 'https://api.fish.audio', api_type: 'fish' as const }];
    expect(voiceFolderEffect(detail(), 'f1', fish)).toBe('Fish:导完就能念,参考音频念的时候带过去。');
  });
});

describe('apply body', () => {
  it('carries connection, name and language only when set', () => {
    const p = plan([group()]);
    const model = confirmModel(p, NONE, null, false);
    const body = applyBody(model, {}, {}, false, {}, { 'voice:1': 'g1' }, { 'voice:1': { name: '  新名字 ', lang: 'zh' } });
    expect(body.options).toEqual({ 'voice:1': { connection_id: 'g1', name: '新名字', lang: 'zh' } });
    expect(applyBody(model, {}, {}, false, {}, { 'voice:1': 'g1' }).options).toEqual({ 'voice:1': { connection_id: 'g1' } });
    expect(applyBody(model, {}, {}, false, {}, {}, { 'voice:1': { name: '   ' } }).options).toEqual({ 'voice:1': {} });
    expect(applyBody(model, {}, {}, false, {}, {}, { 'other:9': { name: 'x' } }).options).toBeUndefined();
  });
});

describe('after import', () => {
  const result = (created?: { voices?: string[] }) => ({
    job_id: 'job1',
    card_id: null,
    notice: { title: '', detail: '', unknown: [] },
    report: [],
    created: created && { cards: [], sprite_packs: [], scene_packs: [], cg_packs: [], ...created },
  });

  it('opens the new voice, or the existing one when nothing new was made', () => {
    const p = plan([group()]);
    expect(libraryRouteAfterImport(result({ voices: ['v7'] }), p, {}, null)).toEqual({ tab: 'voice', id: 'v7' });
    const dup = plan([group(detail({ existing: { id: 'v1', name: '凯露' } }))]);
    expect(libraryRouteAfterImport(result({}), dup, {}, null)).toEqual({ tab: 'voice', id: 'v1' });
  });
});
