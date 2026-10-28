import { describe, expect, it } from 'vitest';
import type { PackSprite, SceneAsset, TtsConnection, VoiceProfile } from '../../lib/api';
import { cardFacts, headTags, type CardViewRaw, pickLabels } from './cardView';

const sprite = (id: string, enabled = true): PackSprite =>
  ({ id, pack_id: 'p1', label: id, aliases: [], description: '', enabled }) as unknown as PackSprite;

const asset = (id: string, kind: SceneAsset['kind'], pack_id: string, over: Partial<SceneAsset> = {}): SceneAsset =>
  ({ id, kind, pack_id, label: id, aliases: [], description: '', enabled: true, parent_id: null, ...over }) as SceneAsset;

const voice = (id: string, name: string, text_lang: string, connection_id = 'conn1') =>
  ({ id, name, text_lang, connection_id, emotions: [] }) as unknown as VoiceProfile;

const conn = (over: Partial<TtsConnection> = {}): TtsConnection => ({
  id: 'conn1',
  name: '5090',
  api_type: 'gpt_sovits',
  base_url: 'http://x',
  sample_steps: 64,
  emo_alpha: 1,
  profile_count: 3,
  ...over,
});

/** 一张什么都没绑的卡 */
const bare = (over: Partial<CardViewRaw> = {}): CardViewRaw => ({
  card: { id: 'c1', name: '刻晴' },
  packs: { card_id: 'c1', pack_ids: [], current: null },
  sprites: [],
  sceneParts: { bg: [], bgm: [] },
  sceneAssets: [],
  cgAssets: [],
  voices: { main: null, extras: [] },
  profiles: [],
  ...over,
});

describe('cardFacts:抽屉里看的那张卡用了哪些素材', () => {
  it('什么都没绑的卡:全是 0 / null,名单是内置表情', () => {
    const f = cardFacts(bare());
    expect(f).toEqual({
      id: 'c1',
      name: '刻晴',
      sprites: 0,
      spritePack: null,
      listRef: 'builtin',
      mainVoice: null,
      voices: { main: null, extras: [] },
      scene: { packName: null, bg: 0, bgm: 0, cgPackName: null, cg: 0 },
      prefs: {},
    });
  });

  it('立绘只数启用的;名单是当前立绘包', () => {
    const f = cardFacts(
      bare({
        packs: { card_id: 'c1', pack_ids: ['p1'], current: 'p1' },
        spritePacks: [{ id: 'p1', name: '玉衡星' }],
        sprites: [sprite('a'), sprite('b'), sprite('c', false)],
      }),
    );
    expect(f.sprites).toBe(2);
    expect(f.spritePack).toEqual({ id: 'p1', name: '玉衡星' });
    expect(f.listRef).toBe('pack:p1');
  });

  it('场景包里 2 个背景 3 首 BGM;停用的不算', () => {
    const f = cardFacts(
      bare({
        sceneParts: { bg: ['s1'], bgm: ['s1'] },
        scenePacks: [{ id: 's1', name: '原神 · 璃月', cg_pack_id: null }],
        sceneAssets: [
          asset('b1', 'bg', 's1'),
          asset('b2', 'bg', 's1'),
          asset('b3', 'bg', 's1', { enabled: false }),
          asset('m1', 'bgm', 's1'),
          asset('m2', 'bgm', 's1'),
          asset('m3', 'bgm', 's1'),
        ],
      }),
    );
    expect(f.scene).toMatchObject({ packName: '原神 · 璃月', bg: 2, bgm: 3 });
  });

  it('背景只算出背景的包、BGM 只算出曲子的包(两栏分开绑)', () => {
    const f = cardFacts(
      bare({
        sceneParts: { bg: ['s1'], bgm: ['s2'] },
        sceneAssets: [asset('b1', 'bg', 's1'), asset('m1', 'bgm', 's1'), asset('b2', 'bg', 's2'), asset('m2', 'bgm', 's2')],
      }),
    );
    expect(f.scene).toMatchObject({ bg: 1, bgm: 1 });
  });

  it('CG 只数构图(parent_id 为空的),场景包里没拆的和 CG 包里的都算', () => {
    const f = cardFacts(
      bare({
        sceneParts: { bg: ['s1'], bgm: [] },
        sceneAssets: [asset('cg1', 'cg', 's1'), asset('cg1-v', 'cg', 's1', { parent_id: 'cg1' })],
        cgPackIds: ['g1'],
        cgPacks: [{ id: 'g1', name: '烟花 · CG' }],
        cgAssets: [asset('cg2', 'cg', 'g1'), asset('cg2-v1', 'cg', 'g1', { parent_id: 'cg2' }), asset('cg3', 'cg', 'g1')],
      }),
    );
    expect(f.scene.cg).toBe(3);
    expect(f.scene.cgPackName).toBe('烟花 · CG');
  });

  it('场景包的 CG 拆成了 CG 包:不再数场景包里那份', () => {
    const f = cardFacts(
      bare({
        sceneParts: { bg: ['s1'], bgm: [] },
        scenePacks: [{ id: 's1', name: '璃月', cg_pack_id: 'g1' }],
        sceneAssets: [asset('cg1', 'cg', 's1')],
      }),
    );
    expect(f.scene.cg).toBe(0);
  });

  it('主声音按 CardVoices.main 在声音列表里找;找不到当没有', () => {
    const zh = voice('v1', '刻晴(中文)', 'zh');
    expect(cardFacts(bare({ voices: { main: 'v1', extras: [] }, profiles: [zh] })).mainVoice).toBe(zh);
    expect(cardFacts(bare({ voices: { main: 'gone', extras: [] }, profiles: [zh] })).mainVoice).toBeNull();
  });

  it('按卡设置原样带上(卡带看自己那一项)', () => {
    const prefs = { 'plugin.imagegen': { look: 'long hair' } };
    expect(cardFacts(bare({ prefs })).prefs).toBe(prefs);
  });
});

describe('headTags:页头的小标签', () => {
  const keqing = cardFacts(
    bare({
      packs: { card_id: 'c1', pack_ids: ['p1'], current: 'p1' },
      spritePacks: [{ id: 'p1', name: '玉衡星' }],
      sprites: Array.from({ length: 14 }, (_, i) => sprite(`s${i}`)),
      sceneParts: { bg: ['s1'], bgm: ['s1'] },
      scenePacks: [{ id: 's1', name: '原神 · 璃月', cg_pack_id: null }],
      sceneAssets: [asset('b1', 'bg', 's1'), asset('b2', 'bg', 's1'), asset('m1', 'bgm', 's1')],
      voices: { main: 'v1', extras: [] },
      profiles: [voice('v1', '刻晴(中文)', 'zh')],
    }),
  );

  it('立绘页:「包名 · N 张」;没绑立绘包写「没绑立绘」', () => {
    expect(headTags('sprite', keqing, [])).toEqual(['玉衡星 · 14 张']);
    expect(headTags('sprite', cardFacts(bare()), [])).toEqual(['没绑立绘']);
  });

  it('语音页:主声音名、用哪台语音服务;连接名里已经有引擎名就不重复', () => {
    expect(headTags('voice', keqing, [conn()])).toEqual(['刻晴(中文)', '用 5090 · GPT-SoVITS']);
    expect(headTags('voice', keqing, [conn({ name: 'GPT-SoVITS' })])).toEqual(['刻晴(中文)', '用 GPT-SoVITS']);
    expect(headTags('voice', keqing, [])).toEqual(['刻晴(中文)']);
    expect(headTags('voice', cardFacts(bare()), [conn()])).toEqual(['没设音色']);
  });

  it('背景 / BGM / CG 页:「包名 · N 张 / N 首」', () => {
    expect(headTags('bg', keqing, [])).toEqual(['原神 · 璃月 · 2 张']);
    expect(headTags('bgm', keqing, [])).toEqual(['原神 · 璃月 · 1 首']);
    expect(headTags('cg', keqing, [])).toEqual(['没绑 CG 包']);
    expect(headTags('bg', cardFacts(bare()), [])).toEqual(['没绑场景包']);
  });

  it('外语页:主声音是不是日语', () => {
    expect(headTags('lang', keqing, [])).toEqual(['刻晴(中文)的声音不是日语']);
    const ja = cardFacts(bare({ voices: { main: 'v2', extras: [] }, profiles: [voice('v2', '刻晴(日语)', 'ja')] }));
    expect(headTags('lang', ja, [])).toEqual(['刻晴(日语)的声音是日语']);
    expect(headTags('lang', cardFacts(bare()), [])).toEqual(['没设音色']);
  });

  it('别的页没有小标签', () => {
    expect(headTags('jev', keqing, [])).toEqual([]);
  });
});

describe('pickLabels', () => {
  it('同名的卡接上注释的第一小段,分不出来时接「第 N 张」', () => {
    const labels = pickLabels([
      { id: 'a', name: '刻晴', note: '日语配音版：开场白和示例日中对照' },
      { id: 'b', name: '刻晴', note: '中文版：开场白和示例只有中文' },
      { id: 'c', name: '阿米娅', note: '本地测试用角色' },
      { id: 'd', name: 'Wikira' },
      { id: 'e', name: 'Wikira', note: '' },
      { id: 'f', name: '' },
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      a: '刻晴 · 日语配音版',
      b: '刻晴 · 中文版',
      c: '阿米娅',
      d: 'Wikira · 第 1 张',
      e: 'Wikira · 第 2 张',
      f: '(未命名)',
    });
  });
});

