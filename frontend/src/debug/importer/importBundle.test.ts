import { describe, expect, it } from 'vitest';
import type { ImportBundleDetail, ImportGroup, ImportPlan } from '../lib/api';
import type { ImportTarget } from './dropTarget';
import {
  applyBody,
  bundleOnly,
  bundleView,
  confirmModel,
  defaultBundlePresets,
  defaultVoiceConnections,
  isLocalUrl,
  MODEL_CODE_WARN,
  planHasVoices,
  shouldConfirm,
  VOICE_LOCAL,
  VOICE_NO_SERVICE,
  VOICE_REMOTE,
  voiceLines,
  voiceTarget,
} from './importModel';

const NONE: ImportTarget = { cardId: null, cardName: null, kind: null };

const detail = (over: Partial<ImportBundleDetail> = {}): ImportBundleDetail => ({
  note: '  原神刻晴,日语配音。 ',
  preview: '/api/import/pl/file?path=assets/a.png',
  cards: [{ name: '刻晴', state: null }],
  packs: [
    { kind: 'sprite', name: '玉衡星', detail: '14 张', thumbs: ['t1', 't2'] },
    { kind: 'sprite', name: '玉衡星(平涂)', detail: '15 张', thumbs: ['t3', 't4'] },
    { kind: 'scene', name: '原神 · 璃月', detail: '16 张背景、7 首 BGM', thumbs: ['b1'] },
  ],
  follows: ['认词记录 32 条', '配对表 2 张'],
  preset: { name: '刻晴 DeepSeek' },
  has_voice: false,
  bytes: 58_000_000,
  ...over,
});

const bundle = (d: ImportBundleDetail = detail(), key = 'b1'): ImportGroup => ({
  key,
  type: 'bundle',
  name: '刻晴',
  count: 1,
  owner: null,
  duplicate_of: null,
  detail: d,
});

const packFile: ImportGroup = {
  key: 'f1',
  type: 'pack_file',
  name: '刻晴 · 玉衡星',
  count: 14,
  owner: null,
  duplicate_of: null,
  detail: { kind: 'scene', name: '原神 · 璃月', detail: '16 张背景、7 首 BGM', thumbs: [] },
};

const plan = (groups: ImportGroup[], extra: Partial<ImportPlan> = {}): ImportPlan => ({
  plan_id: 'pl',
  groups,
  unknown: [],
  skipped: [],
  needs_confirm: false,
  ...extra,
});

describe('bundleView', () => {
  it('lists the new card, packs grouped by kind, and what follows', () => {
    const v = bundleView(bundle());
    expect(v.note).toBe('原神刻晴,日语配音。');
    expect(v.rows.map((r) => [r.label, r.text])).toEqual([
      ['角色卡', '刻晴'],
      ['立绘', '玉衡星 · 14 张、玉衡星(平涂) · 15 张'],
      ['背景 · BGM', '原神 · 璃月 · 16 张背景、7 首 BGM'],
      ['跟着走', '认词记录 32 条、配对表 2 张'],
    ]);
    // 一类最多三张缩略图;背景是横的
    expect(v.rows[1].thumbs).toEqual(['t1', 't2', 't3']);
    expect(v.rows[1].wide).toBe(false);
    expect(v.rows[2].wide).toBe(true);
    expect(v.preset).toEqual({ label: '也导入作者建议的预设「刻晴 DeepSeek」', hint: '另建一套,绑到这张卡' });
    expect(v.voiceNote).toBe('这个包里没有声音:导入后在卡编辑器的声音栏挂一个');
    expect(v.badge).toBeNull();
  });

  it('writes no warning when the name is free, and handles a state group', () => {
    const v = bundleView(
      bundle(
        detail({
          cards: [
            { name: '爱弥斯', state: '普通' },
            { name: '爱弥斯', state: '约会' },
          ],
          packs: [],
          follows: [],
          preset: null,
          has_voice: true,
        }),
      ),
    );
    expect(v.rows.map((r) => [r.label, r.text])).toEqual([
      ['角色卡', '爱弥斯(普通)'],
      ['', '爱弥斯(约会)'],
    ]);
    expect(v.badge).toBe('普通 / 约会');
    expect(v.preset).toBeNull();
    expect(v.voiceNote).toBeNull();
  });
});

describe('bundle plans', () => {
  it('uses the bundle layout only for a plan that is just one bundle', () => {
    expect(bundleOnly(plan([bundle()]))?.key).toBe('b1');
    expect(bundleOnly(plan([bundle(), packFile]))).toBeNull();
    expect(bundleOnly(plan([bundle()], { unknown: ['x.txt'] }))).toBeNull();
    expect(bundleOnly(plan([packFile]))).toBeNull();
  });

  it('always asks before importing a bundle, but not a lone pack file', () => {
    expect(shouldConfirm(plan([bundle()]))).toBe(true);
    expect(shouldConfirm(plan([packFile]))).toBe(false);
  });

  it('ticks the suggested preset by default and sends it as a group option', () => {
    const p = plan([bundle(), bundle(detail({ preset: null }), 'b2')]);
    const presets = defaultBundlePresets(p);
    expect(presets).toEqual({ b1: true });
    const model = confirmModel(p, NONE, null, false);
    expect(applyBody(model, {}, {}, false, { b1: false }).options).toEqual({ b1: { preset: false } });
    expect(applyBody(model, {}, {}, false, presets).options).toEqual({ b1: { preset: true } });
    // 没有角色包时不带 options
    expect(applyBody(confirmModel(plan([packFile]), NONE, null, false), {}, {}, false, {})).not.toHaveProperty('options');
  });

  it('draws bundles and pack files as plain rows in a mixed plan', () => {
    const m = confirmModel(plan([bundle(), packFile]), NONE, null, false);
    expect(m.rows.map((r) => [r.icon, r.title, r.effect])).toEqual([
      ['card', '角色包「刻晴」', '新建角色卡和 3 个包,都是另存的一份'],
      ['scene', '背景和 BGM「原神 · 璃月」· 16 张背景、7 首 BGM', '另建一个新的包,先放进素材库,不绑到卡上'],
    ]);
  });
});

describe('voices in a bundle or a voice pack (step 4)', () => {
  const LOCAL = { id: 'tts1', name: '本机 GPT-SoVITS', local: true };
  const kqJa = { name: '刻晴(日语)', detail: '12 段参考 + 2 个模型', connection: LOCAL, missing: 0 };
  const withVoice = bundle(detail({ has_voice: true, voices: [kqJa, { ...kqJa, name: '刻晴(中文)', missing: 3 }] }));
  const voicePack: ImportGroup = {
    key: 'f2',
    type: 'pack_file',
    name: '刻晴(日语)',
    count: 12,
    owner: null,
    duplicate_of: null,
    detail: { kind: 'voice', name: '刻晴(日语)', detail: '12 段参考 + 2 个模型', thumbs: [], voices: [{ ...kqJa, connection: null }] },
  };
  const conns = [
    { id: 'tts1', name: '本机 GPT-SoVITS', base_url: 'http://127.0.0.1:9880' },
    { id: 'tts2', name: '台式机', base_url: 'http://192.168.1.20:9880' },
  ];

  it('tells local from another computer by the address', () => {
    expect(isLocalUrl('http://127.0.0.1:9880')).toBe(true);
    expect(isLocalUrl('http://localhost:9880/')).toBe(true);
    expect(isLocalUrl('http://[::1]:9880')).toBe(true);
    expect(isLocalUrl('127.0.0.1:9880')).toBe(true);
    expect(isLocalUrl('http://192.168.1.20:9880')).toBe(false);
    expect(isLocalUrl('http://localhost.example.com')).toBe(false);
    expect(isLocalUrl('')).toBe(false);
  });

  it('lists each voice once, the kind named on the first, and what is missing', () => {
    expect(voiceLines(withVoice)).toEqual([
      { key: 'voice-0', label: '声音', text: '刻晴(日语) · 12 段参考 + 2 个模型', missing: null },
      { key: 'voice-1', label: '', text: '刻晴(中文) · 12 段参考 + 2 个模型', missing: '包里缺 3 个文件,导完这个声音只有设置' },
    ]);
    expect(voiceLines(bundle())).toEqual([]);
  });

  it('defaults to the backend connection and says it reads right away when it is local', () => {
    expect(defaultVoiceConnections(plan([withVoice, voicePack]))).toEqual({ b1: 'tts1' });
    const t = voiceTarget(withVoice, undefined, null);
    expect(t).toMatchObject({ id: 'tts1', name: '本机 GPT-SoVITS', options: null, status: VOICE_LOCAL });
  });

  it('gives a dropdown when there are several services and follows the pick', () => {
    const t = voiceTarget(withVoice, 'tts2', conns);
    expect(t.options).toEqual([
      { value: 'tts1', label: '本机 GPT-SoVITS' },
      { value: 'tts2', label: '台式机' },
    ]);
    expect(t).toMatchObject({ id: 'tts2', name: '台式机', local: false, status: VOICE_REMOTE });
    expect(VOICE_REMOTE).toBe('语音服务在另一台电脑,导完自动送过去');
    // 选的那个已经删掉了:换成第一个
    expect(voiceTarget(withVoice, 'gone', conns).id).toBe('tts1');
  });

  it('only lists connections that can read this voice, and says what happens', () => {
    const conns = [
      { id: 'r', name: '中转', base_url: 'http://r/v1', api_type: 'openai' as const },
      { id: 'f', name: 'Fish', base_url: 'https://api.fish.audio', api_type: 'fish' as const },
      { id: 'i', name: '索引', base_url: 'http://10.0.0.2:9890', api_type: 'indextts' as const },
    ];
    const row = (id: string, api_type: 'openai' | 'fish' | 'indextts', usable: boolean, note: string) => ({ id, name: id, api_type, usable, note, reason: usable ? '' : '用不上:只认音色名' });
    const targets = [row('r', 'openai', false, ''), row('f', 'fish', true, '只用参考音频克隆,没那么像'), row('i', 'indextts', true, '只用参考音频')];
    const voice = { name: 'v', detail: 'd', missing: 0, connection: { id: 'f', name: 'Fish', local: false }, has_models: true, empty_note: null, targets };
    const g = { key: 'k', type: 'bundle', name: 'x', files: [], owner: null, detail: { voices: [voice], cards: [], packs: [], follows: [], note: '', preview: null, preset: null, bytes: 0, folder: '' } } as unknown as ImportGroup;
    const t = voiceTarget(g, undefined, conns);
    expect(t.id).toBe('f');
    expect(t.options?.map((o) => o.value)).toEqual(['f', 'i']);
    expect(t.status).toBe('只用参考音频克隆,没那么像;以后加了 GPT-SoVITS 可以改挂');
    // 选过一条挂不上的(比如列表变了):换成第一条能挂的
    expect(voiceTarget(g, 'r', conns).id).toBe('f');
    // 全都挂不上:写后端给的说明
    const none = { ...voice, connection: null, empty_note: '会新建', targets: targets.map((x) => ({ ...x, usable: false })) };
    const g2 = { ...g, detail: { ...(g.detail as object), voices: [none] } } as unknown as ImportGroup;
    expect(voiceTarget(g2, undefined, conns)).toMatchObject({ id: null, status: '会新建', options: null });
    // 库里已经有一样的:不用选挂到哪,直接说
    const twin = { ...voice, existing: { id: 'v1', name: 'v' } };
    const g3 = { ...g, detail: { ...(g.detail as object), voices: [twin] } } as unknown as ImportGroup;
    expect(voiceTarget(g3, undefined, conns)).toMatchObject({ options: null, status: '库里已经有一样的声音:不再存一份,直接用那条' });
  });

  it('says there is no voice service yet when none exists', () => {
    expect(voiceTarget(voicePack, undefined, [])).toMatchObject({ id: null, status: VOICE_NO_SERVICE });
  });

  it('sends the chosen service as connection_id next to the preset', () => {
    const p = plan([withVoice, voicePack]);
    const model = confirmModel(p, NONE, null, false);
    expect(applyBody(model, {}, {}, false, { b1: true }, { b1: 'tts2', f2: 'tts1' }).options).toEqual({
      b1: { preset: true, connection_id: 'tts2' },
      f2: { connection_id: 'tts1' },
    });
  });

  it('asks before importing a voice pack and warns about model code', () => {
    expect(planHasVoices(plan([voicePack]))).toBe(true);
    expect(shouldConfirm(plan([voicePack]))).toBe(true);
    const v = bundleView(withVoice);
    expect(v.voiceNote).toBeNull();
    expect(v.codeWarn).toBe(MODEL_CODE_WARN);
    expect(bundleView(bundle()).codeWarn).toBeNull();
    const m = confirmModel(plan([voicePack]), NONE, null, false);
    expect(m.rows.map((r) => [r.icon, r.title, r.effect])).toEqual([
      ['voice', '声音「刻晴(日语)」· 12 段参考 + 2 个模型', '另建一个声音,先放进素材库,不挂到卡上'],
    ]);
  });
});
