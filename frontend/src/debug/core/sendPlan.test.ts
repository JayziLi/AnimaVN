import { describe, expect, it } from 'vitest';
import type { PresetOrderEntry } from '../lib/presetParser';
import type { JevKinds } from '../plugins/jev';
import { JEV_KINDS } from '../plugins/registry';
import { TIPS } from '../components/drawer/tips';
import {
  autoRows,
  blockSendPlan,
  langStatus,
  sendBadge,
  type AutoFillMaterial,
  type BlockSend,
  type SendPlanInput,
} from './sendPlan';

const NONE = Object.fromEntries(JEV_KINDS.map((k) => [k, false])) as JevKinds;
const ALL: AutoFillMaterial = { sprite: true, bg: true, bgm: true, cg: true };
const on = (identifier: string): PresetOrderEntry => ({ identifier, enabled: true });
const off = (identifier: string): PresetOrderEntry => ({ identifier, enabled: false });

const plan = (o: Partial<SendPlanInput> = {}) =>
  blockSendPlan({
    order: [on('main'), on('chatHistory')],
    configuredJev: NONE,
    jevKinds: NONE,
    offKinds: NONE,
    material: ALL,
    mainVoiceLang: 'ja',
    autoFill: false,
    ...o,
  });
const of = (p: BlockSend[], identifier: string) => p.find((b) => b.identifier === identifier);
const pick = (b: BlockSend | undefined) => (b ? [b.state, b.reason] : null);

describe('blockSendPlan · 立绘 / 背景 / BGM / CG', () => {
  it('sends a block that is on in the preset', () => {
    expect(of(plan({ order: [on('anima_sprite')] }), 'anima_sprite')).toEqual({
      identifier: 'anima_sprite',
      plugin: 'sprite',
      state: 'send',
      reason: 'normal',
    });
  });

  it('skips it when the plugin is switched off, before anything else', () => {
    const p = plan({ order: [on('anima_bg')], offKinds: { ...NONE, bg: true }, jevKinds: { ...NONE, bg: true }, material: { ...ALL, bg: false } });
    expect(pick(of(p, 'anima_bg'))).toEqual(['skip', 'off']);
  });

  it('skips it when Jev tags this kind (with a key)', () => {
    expect(pick(of(plan({ order: [on('anima_bgm')], jevKinds: { ...NONE, bgm: true } }), 'anima_bgm'))).toEqual(['skip', 'jev']);
  });

  it('skips it when the card has nothing for this kind — a card with nothing bound skips the sprite block', () => {
    const bare: AutoFillMaterial = { sprite: false, bg: false, bgm: false, cg: false };
    expect(pick(of(plan({ order: [on('anima_sprite')], material: bare }), 'anima_sprite'))).toEqual(['skip', 'no-material']);
    expect(pick(of(plan({ order: [on('anima_cg')], material: { ...ALL, cg: false } }), 'anima_cg'))).toEqual(['skip', 'no-material']);
  });

  it('still sends it when Jev was chosen but there is no key, and says so', () => {
    const p = plan({ order: [on('anima_sprite')], configuredJev: { ...NONE, sprite: true } });
    expect(pick(of(p, 'anima_sprite'))).toEqual(['send', 'no-key']);
  });

  it('skips a block the preset has turned off', () => {
    expect(pick(of(plan({ order: [off('anima_sprite')] }), 'anima_sprite'))).toEqual(['skip', 'user-off']);
  });

  it('fills a missing block when auto-fill is on, but not for the three skips above', () => {
    expect(pick(of(plan({ autoFill: true }), 'anima_sprite'))).toEqual(['auto', 'auto-fill']);
    expect(of(plan({ autoFill: false }), 'anima_sprite')).toBeUndefined();
    expect(of(plan({ autoFill: true, offKinds: { ...NONE, sprite: true } }), 'anima_sprite')).toBeUndefined();
    expect(of(plan({ autoFill: true, jevKinds: { ...NONE, sprite: true } }), 'anima_sprite')).toBeUndefined();
    expect(of(plan({ autoFill: true, material: { ...ALL, sprite: false } }), 'anima_sprite')).toBeUndefined();
  });

  it('only lists blocks in the order or filled in this time, in plugin block order', () => {
    const p = plan({ order: [on('anima_player'), on('anima_cg'), off('anima_lang'), on('anima_sprite')] });
    expect(p.map((b) => b.identifier)).toEqual(['anima_sprite', 'anima_cg', 'anima_lang', 'anima_player']);
  });
});

describe('blockSendPlan · 外语', () => {
  const order = [on('anima_sprite'), on('anima_lang')];

  it('skips it without a main voice', () => {
    expect(pick(of(plan({ order, mainVoiceLang: null }), 'anima_lang'))).toEqual(['skip', 'lang-no-voice']);
  });

  it('skips it when the main voice is not Japanese', () => {
    expect(pick(of(plan({ order, mainVoiceLang: 'zh' }), 'anima_lang'))).toEqual(['skip', 'lang-not-ja']);
    expect(pick(of(plan({ order, mainVoiceLang: 'all_ja' }), 'anima_lang'))).toEqual(['send', 'normal']);
  });

  it('sends the short version when no tag block is sent this time', () => {
    expect(pick(of(plan({ order, jevKinds: { ...NONE, sprite: true } }), 'anima_lang'))).toEqual(['short', 'lang-trim']);
    expect(pick(of(plan({ order: [on('anima_lang')] }), 'anima_lang'))).toEqual(['short', 'lang-trim']);
    // 一块自动补的标签块也算发了
    expect(pick(of(plan({ order: [on('anima_lang')], autoFill: true }), 'anima_lang'))).toEqual(['send', 'normal']);
  });

  it('skips it when the preset turned it off', () => {
    expect(pick(of(plan({ order: [on('anima_sprite'), off('anima_lang')] }), 'anima_lang'))).toEqual(['skip', 'user-off']);
  });

  it('fills it when missing for a Japanese voice, short when no tag block goes out, and never for other voices', () => {
    const tags = [on('anima_sprite')];
    expect(of(plan({ order: tags, autoFill: true }), 'anima_lang')).toMatchObject({ state: 'auto', reason: 'auto-fill' });
    expect(of(plan({ order: tags, autoFill: true }), 'anima_lang')?.short).toBeUndefined();
    expect(of(plan({ order: tags, autoFill: true, jevKinds: { ...NONE, sprite: true }, material: { ...ALL, bg: false, bgm: false, cg: false } }), 'anima_lang')).toMatchObject({
      state: 'auto',
      short: true,
    });
    expect(of(plan({ order: tags, autoFill: true, mainVoiceLang: 'zh' }), 'anima_lang')).toBeUndefined();
    expect(of(plan({ order: tags, autoFill: false }), 'anima_lang')).toBeUndefined();
  });
});

describe('blockSendPlan · 别替玩家说话', () => {
  it('sends it when on, skips it when the preset turned it off, fills it when missing', () => {
    expect(pick(of(plan({ order: [on('anima_player')] }), 'anima_player'))).toEqual(['send', 'normal']);
    expect(pick(of(plan({ order: [off('anima_player')] }), 'anima_player'))).toEqual(['skip', 'user-off']);
    expect(pick(of(plan({ autoFill: true }), 'anima_player'))).toEqual(['auto', 'auto-fill']);
    expect(of(plan({ autoFill: false }), 'anima_player')).toBeUndefined();
  });

  it('does not care about Jev, the switches or the material', () => {
    const p = plan({
      order: [on('anima_player')],
      jevKinds: { ...NONE, sprite: true, player: true },
      offKinds: { ...NONE, sprite: true, bg: true, bgm: true, cg: true },
      material: { sprite: false, bg: false, bgm: false, cg: false },
      mainVoiceLang: null,
    });
    expect(pick(of(p, 'anima_player'))).toEqual(['send', 'normal']);
  });
});

// ── 显示:预设左栏的小块、外语页页头、自动补块页的清单(P4)──

const send = (o: Partial<BlockSend> & Pick<BlockSend, 'identifier' | 'plugin' | 'state' | 'reason'>): BlockSend => o;

describe('sendBadge', () => {
  it('says nothing for a block sent as the preset says, or one the preset turned off', () => {
    expect(sendBadge(send({ identifier: 'anima_sprite', plugin: 'sprite', state: 'send', reason: 'normal' }))).toBeNull();
    expect(sendBadge(send({ identifier: 'anima_sprite', plugin: 'sprite', state: 'skip', reason: 'user-off' }))).toBeNull();
  });

  it('labels each state with its question-mark text', () => {
    const badge = (b: BlockSend) => {
      const x = sendBadge(b);
      return x && [x.text, x.tip, x.kind];
    };
    expect(badge(send({ identifier: 'anima_sprite', plugin: 'sprite', state: 'send', reason: 'no-key' }))).toEqual(['先按 AI 写', 'skip_nokey', 'note']);
    expect(badge(send({ identifier: 'anima_lang', plugin: 'lang', state: 'short', reason: 'lang-trim' }))).toEqual(['精简版', 'lang_short', 'note']);
    expect(badge(send({ identifier: 'anima_bgm', plugin: 'bgm', state: 'auto', reason: 'auto-fill' }))).toEqual(['自动补', 'auto_fill', 'auto']);
    expect(badge(send({ identifier: 'anima_lang', plugin: 'lang', state: 'auto', reason: 'auto-fill', short: true }))).toEqual(['自动补 · 精简版', 'auto_fill', 'auto']);
    expect(badge(send({ identifier: 'anima_bg', plugin: 'bg', state: 'skip', reason: 'jev' }))).toEqual(['这次不发', 'skip_jev', 'skip']);
    expect(badge(send({ identifier: 'anima_cg', plugin: 'cg', state: 'skip', reason: 'off' }))).toEqual(['这次不发', 'skip_off', 'skip']);
    expect(badge(send({ identifier: 'anima_sprite', plugin: 'sprite', state: 'skip', reason: 'no-material' }))).toEqual(['这次不发', 'skip_nomaterial', 'skip']);
    // CG 没素材用它自己那句
    expect(badge(send({ identifier: 'anima_cg', plugin: 'cg', state: 'skip', reason: 'no-material' }))).toEqual(['这次不发', 'skip_nocg', 'skip']);
    expect(badge(send({ identifier: 'anima_lang', plugin: 'lang', state: 'skip', reason: 'lang-not-ja' }))).toEqual(['这次不发', 'lang_not_ja', 'skip']);
    expect(badge(send({ identifier: 'anima_lang', plugin: 'lang', state: 'skip', reason: 'lang-no-voice' }))).toEqual(['这次不发', 'lang_no_voice', 'skip']);
  });

  it('only points at question-mark texts that exist', () => {
    const states = blockSendPlan({
      order: [{ identifier: 'anima_sprite', enabled: true }, { identifier: 'anima_lang', enabled: true }],
      configuredJev: { ...NONE, sprite: true },
      jevKinds: NONE,
      offKinds: { ...NONE, cg: true },
      material: { ...ALL, bg: false },
      mainVoiceLang: 'zh',
      autoFill: true,
    });
    for (const b of states) {
      const x = sendBadge(b);
      if (x) expect(TIPS[x.tip]).toBeTruthy();
    }
  });
});

describe('langStatus', () => {
  const lang = (o: Partial<BlockSend>): BlockSend[] => [send({ identifier: 'anima_lang', plugin: 'lang', state: 'send', reason: 'normal', ...o })];

  it('follows the plan when the language block is in it', () => {
    expect(langStatus(lang({}), { hasPreset: true, mainVoiceLang: 'ja' })).toEqual({ state: 'send', auto: false });
    expect(langStatus(lang({ state: 'short', reason: 'lang-trim' }), { hasPreset: true, mainVoiceLang: 'ja' })).toEqual({ state: 'short', auto: false });
    expect(langStatus(lang({ state: 'auto', reason: 'auto-fill', short: true }), { hasPreset: true, mainVoiceLang: 'ja' })).toEqual({ state: 'short', auto: true });
    expect(langStatus(lang({ state: 'auto', reason: 'auto-fill' }), { hasPreset: true, mainVoiceLang: 'ja' })).toEqual({ state: 'send', auto: true });
    expect(langStatus(lang({ state: 'skip', reason: 'user-off' }), { hasPreset: true, mainVoiceLang: 'ja' })).toEqual({ state: 'skip', why: { tip: 'skip_user_off' } });
    expect(langStatus(lang({ state: 'skip', reason: 'lang-not-ja' }), { hasPreset: true, mainVoiceLang: 'zh' })).toEqual({ state: 'skip', why: { tip: 'lang_not_ja' } });
  });

  it('says why when the block is not in the plan at all', () => {
    expect(langStatus([], { hasPreset: false, mainVoiceLang: 'ja' })).toEqual({ state: 'skip', why: { text: '还没选预设。' } });
    expect(langStatus([], { hasPreset: true, mainVoiceLang: null })).toEqual({ state: 'skip', why: { tip: 'lang_no_voice' } });
    expect(langStatus([], { hasPreset: true, mainVoiceLang: 'zh' })).toEqual({ state: 'skip', why: { tip: 'lang_not_ja' } });
    expect(langStatus([], { hasPreset: true, mainVoiceLang: 'ja' })).toEqual({
      state: 'skip',
      why: { text: '当前预设里没有这一块，自动补块也关着，所以这次不发送。' },
    });
  });
});

describe('autoRows', () => {
  it('lists what is filled in this time, with what is special about it', () => {
    const plan = [
      send({ identifier: 'anima_sprite', plugin: 'sprite', state: 'auto', reason: 'auto-fill' }),
      send({ identifier: 'anima_bg', plugin: 'bg', state: 'skip', reason: 'jev' }),
      send({ identifier: 'anima_lang', plugin: 'lang', state: 'auto', reason: 'auto-fill', short: true }),
      send({ identifier: 'anima_player', plugin: 'player', state: 'auto', reason: 'auto-fill' }),
    ];
    const auto = [
      { identifier: 'anima_sprite', name: '立绘指令 · 插件', reason: 'no-key' as const },
      { identifier: 'anima_lang', name: '外语指令 · 插件', reason: 'ai' as const },
      { identifier: 'anima_player', name: '别替玩家说话 · 插件', reason: 'ai' as const },
    ];
    expect(autoRows(plan, auto)).toEqual([
      { identifier: 'anima_sprite', name: '立绘指令 · 插件', note: '预设里没有 · 先按 AI 写(Jev 还没填 key)' },
      { identifier: 'anima_lang', name: '外语指令 · 插件', note: '预设里没有 · 精简版' },
      { identifier: 'anima_player', name: '别替玩家说话 · 插件', note: '预设里没有' },
    ]);
    expect(autoRows([], [])).toEqual([]);
  });
});
