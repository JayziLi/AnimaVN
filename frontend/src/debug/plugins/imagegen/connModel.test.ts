import { describe, expect, it } from 'vitest';
import type { ImageConn } from './api';
import { DEFAULT_CARD_PREFS, DEFAULT_IMAGEGEN_CONFIG } from './config';
import {
  accountText,
  addressText,
  autoName,
  checkText,
  connectionText,
  connOption,
  connPatch,
  costPending,
  costText,
  drawBlockOf,
  keyHint,
  kindsOf,
  moreSummary,
  novelaiCost,
  qualityChoices,
  sdMoreSummary,
  sdSampler,
  sentSize,
  DEFAULT_RELAY_SIZES,
  extraError,
  modelOf,
  relaySizes,
  tidyUrl,
  timingParts,
  timingText,
  trialCost,
  urlChanged,
  without,
} from './connModel';
import type { ImageSetup } from './setup';

const conn = (id: string, kind: ImageConn['kind']): ImageConn => ({
  id,
  name: id,
  kind,
  base_url: null,
  has_key: true,
  options: {},
  created_at: '2026-11-07T00:00:00Z',
});
const setup = (c: string | null): ImageSetup => ({ v: 1, conn: c, byConn: {} });
const screen = { width: 1600, height: 900 };

describe('画图连接', () => {
  it('卡片小字:类型 · 地址;NovelAI 没填地址是官方地址', () => {
    expect(addressText({ kind: 'novelai', base_url: null })).toBe('官方地址');
    expect(addressText({ kind: 'sdapi', base_url: 'http://192.168.1.20:7860' })).toBe('192.168.1.20:7860');
    expect(addressText({ kind: 'openai', base_url: 'https://api.example.com/v1' })).toBe('api.example.com/v1');
    expect(addressText({ kind: 'sdapi', base_url: null })).toBe('没填地址');
  });

  it('连上后自动起名:NovelAI 带档位,本机写「本机」,别的写主机名', () => {
    expect(autoName('novelai', null, 'Opus · Anlas 1200')).toBe('NovelAI · Opus');
    expect(autoName('novelai', null, 'Opus(没有在订阅) · Anlas 0')).toBe('NovelAI · Opus');
    expect(autoName('novelai', null, null)).toBe('NovelAI');
    expect(autoName('sdapi', 'http://127.0.0.1:7860', null)).toBe('本地 SD · 本机');
    expect(autoName('sdapi', 'http://192.168.1.20:7860', null)).toBe('本地 SD · 192.168.1.20');
    expect(autoName('openai', 'https://api.example.com/v1', null)).toBe('中转 · api.example.com');
    expect(autoName('openai', null, null)).toBe('中转站');
  });

  it('为什么画不了:还没读到 / 一条都没有 / 这张卡没选或选的删了 / 这种还不能出图', () => {
    const nai = conn('a', 'novelai');
    const sd = conn('b', 'sdapi');
    expect(drawBlockOf(null, null, true)).toBe('loading');
    expect(drawBlockOf([nai], null, true)).toBe('loading');
    expect(drawBlockOf([], setup(null), true)).toBe('none');
    expect(drawBlockOf([nai], setup(null), true)).toBe('pick');
    expect(drawBlockOf([nai], setup('gone'), true)).toBe('pick');
    expect(drawBlockOf([nai, sd], setup('b'), true)).toBeNull();
    expect(drawBlockOf([nai, sd], setup('a'), true)).toBeNull();
    const relay = conn('r', 'openai');
    expect(drawBlockOf([relay], setup('r'), true)).toBe('model');
    expect(drawBlockOf([relay], { ...setup('r'), byConn: { r: { model: 'nai-diffusion-4-5-full' } } }, true)).toBe('model');
    expect(drawBlockOf([relay], { ...setup('r'), byConn: { r: { model: 'gpt-image-2' } } }, true)).toBeNull();
    expect(drawBlockOf([nai], null, false)).toBe('pick');
    expect(kindsOf([nai, sd])).toEqual({ a: 'novelai', b: 'sdapi' });
    expect(kindsOf(null)).toEqual({});
  });

  it('实际发出去的大小:NovelAI、本地 SD 对齐 64;中转按「可用尺寸」吸附,没填原样发', () => {
    expect(sentSize('novelai', { w: 1000, h: 700 })).toEqual({ w: 1024, h: 704 });
    expect(sentSize('sdapi', { w: 1344, h: 768 })).toEqual({ w: 1344, h: 768 });
    expect(sentSize('openai', { w: 1000, h: 700 })).toEqual({ w: 1000, h: 700 });
    expect(sentSize(null, { w: 1000, h: 700 })).toEqual({ w: 1024, h: 704 });
    expect(sentSize('openai', { w: 1344, h: 768 }, DEFAULT_RELAY_SIZES)).toEqual({ w: 1536, h: 1024 });
    expect(sentSize('openai', { w: 768, h: 1344 }, DEFAULT_RELAY_SIZES)).toEqual({ w: 1024, h: 1536 });
    expect(sentSize('openai', { w: 1000, h: 1000 }, DEFAULT_RELAY_SIZES)).toEqual({ w: 1024, h: 1024 });
    expect(relaySizes({ options: {} })).toBe(DEFAULT_RELAY_SIZES);
    expect(relaySizes({ options: { sizes: '' } })).toBe('');
  });

  it('额外参数要是 JSON 对象;还没选过模型的连接拿到的是 NovelAI 默认值,算空', () => {
    expect(extraError('')).toBeNull();
    expect(extraError('{"quality": "low"}')).toBeNull();
    expect(extraError('{oops')).toContain('JSON');
    expect(extraError('[1]')).toContain('JSON');
    expect(modelOf('openai', 'nai-diffusion-5-full')).toBe('');
    expect(modelOf('openai', 'gpt-image-2')).toBe('gpt-image-2');
    expect(modelOf('novelai', 'nai-diffusion-5-full')).toBe('nai-diffusion-5-full');
  });

  it('按钮上的花费:Opus 免费范围写「免费」,要扣写多少;中转按中转站计费', () => {
    const c = DEFAULT_IMAGEGEN_CONFIG;
    expect(costText('novelai', 0)).toBe('免费');
    expect(costText('novelai', 26)).toBe('扣 26 Anlas');
    expect(costText('openai', 0)).toBe('按你的中转站计费');
    expect(costText('sdapi', 0)).toBe('本地');
    expect(novelaiCost(c, { w: 1344, h: 768 }, true, false)).toBe(0);
    expect(novelaiCost(c, { w: 1344, h: 768 }, true, true)).toBe(5);
    expect(trialCost({ kind: 'novelai' }, c, DEFAULT_CARD_PREFS, undefined, true, screen)).toBe('免费');
    expect(trialCost({ kind: 'novelai' }, { ...c, steps: 40 }, DEFAULT_CARD_PREFS, undefined, true, screen)).toMatch(/^扣 \d+ Anlas$/);
    // 不是 Opus:V5 1344×768、23 步扣 26(10-09 在 Tablet 上实扣)
    const tablet = { tier: 1, active: true, anlas: 100, v5_percent: null, v5_next_percent_s: null };
    expect(trialCost({ kind: 'novelai' }, c, DEFAULT_CARD_PREFS, tablet, true, screen)).toBe('扣 26 Anlas');
    // V4.5 带立绘参考另加 5;没选卡不带参考图
    const v45 = { ...c, model: 'nai-diffusion-4-5-full' };
    expect(trialCost({ kind: 'novelai' }, v45, DEFAULT_CARD_PREFS, undefined, true, screen)).toBe('扣 5 Anlas');
    expect(trialCost({ kind: 'novelai' }, v45, DEFAULT_CARD_PREFS, undefined, false, screen)).toBe('免费');
    expect(trialCost({ kind: 'openai' }, c, DEFAULT_CARD_PREFS, undefined, true, screen)).toBe('按你的中转站计费');
  });

  it('本地 SD 的采样器:NovelAI 的 k_ 开头按没选算;别的照用', () => {
    expect(sdSampler('k_euler_ancestral')).toBe('');
    expect(sdSampler('')).toBe('');
    expect(sdSampler('DPM++ 2M')).toBe('DPM++ 2M');
  });

  it('本地 SD「更多」收着时的小字:没有 NovelAI 的采样器名和噪声调度', () => {
    const c = { ...DEFAULT_IMAGEGEN_CONFIG, steps: 28, scale: 6 };
    expect(sdMoreSummary(c)).toBe('步数 28 · 引导 6.0 · 种子随机');
    expect(sdMoreSummary({ ...c, sampler: 'DPM++ 2M', scheduler: 'Karras', seed: 42 })).toBe('步数 28 · 引导 6.0 · DPM++ 2M · Karras · 种子 42');
  });

  it('质量词选项:本地 SD 三个都有;NovelAI 照模型', () => {
    expect(qualityChoices('sdapi', '').map((q) => q.value)).toEqual(['standard', 'light', 'none']);
    expect(qualityChoices('novelai', 'nai-diffusion-4-5-full').map((q) => q.value)).toEqual(['standard', 'none']);
    expect(qualityChoices('novelai', 'nai-diffusion-5-full').map((q) => q.value)).toEqual(['standard', 'light', 'none']);
  });

  it('查额度、查连接的那一行', () => {
    expect(accountText({ tier: 3, active: true, anlas: 1200, v5_percent: 80, v5_next_percent_s: 0 })).toBe(
      'Opus · Anlas 1200 · V5 额度还剩 80%',
    );
    expect(accountText({ tier: 1, active: true, anlas: 5, v5_percent: null, v5_next_percent_s: null })).toBe('等级 1 · Anlas 5');
    expect(checkText({ ok: true, message: 'Opus · Anlas 1200', ms: 412 })).toBe('通了 · Opus · Anlas 1200 · 0.4 秒');
    expect(checkText({ ok: false, message: '这种连接还不能用', ms: 0 })).toBe('这种连接还不能用');
  });

  it('用时:三段给横条,相册那行带上构思;老图没记就是空的', () => {
    const t = { queue: 0, draw: 2800, fetch: 300, plan: 2412 };
    expect(timingParts(t).map((p) => [p.label, p.ms])).toEqual([
      ['排队', 0],
      ['画', 2800],
      ['传回', 300],
    ]);
    expect(timingText(t)).toBe('构思 2.4 · 排队 0.0 · 画 2.8 · 传回 0.3 秒');
    expect(timingText({ ...t, plan: null })).toBe('排队 0.0 · 画 2.8 · 传回 0.3 秒');
    expect(timingText(undefined)).toBe('');
    expect(timingParts(undefined)).toEqual([]);
    expect(connectionText({ connection: { id: 'c1', name: 'NovelAI · Opus', kind: 'novelai' } })).toBe('NovelAI · Opus');
    expect(connectionText({})).toBe('');
  });
});

describe('画面页', () => {
  it('下拉里的一条连接:名字里看得出种类就不再写一遍', () => {
    expect(connOption({ name: 'NovelAI · Opus', kind: 'novelai' })).toBe('NovelAI · Opus');
    expect(connOption({ name: '本地 SD · 本机', kind: 'sdapi' })).toBe('本地 SD · 本机');
    expect(connOption({ name: '中转 · api.example.com', kind: 'openai' })).toBe('中转 · api.example.com');
    expect(connOption({ name: '中转站', kind: 'openai' })).toBe('中转站');
    expect(connOption({ name: 'Forge · 5090', kind: 'sdapi' })).toBe('Forge · 5090(本地 SD)');
    expect(connOption({ name: '小号', kind: 'novelai' })).toBe('小号(NovelAI)');
    expect(connOption({ name: '便宜的', kind: 'openai' })).toBe('便宜的(中转站)');
  });

  it('「更多」收着时写的那一行:采样器去掉括号;V5 固定 Karras', () => {
    const c = {
      ...DEFAULT_IMAGEGEN_CONFIG,
      model: 'nai-diffusion-4-5-full',
      steps: 23,
      scale: 5,
      sampler: 'k_euler_ancestral',
      noise: 'exponential' as const,
      seed: null,
    };
    expect(moreSummary(c)).toBe('步数 23 · 引导 5.0 · Euler Ancestral · Exponential · 种子随机');
    expect(moreSummary({ ...c, seed: 42 })).toBe('步数 23 · 引导 5.0 · Euler Ancestral · Exponential · 种子 42');
    expect(moreSummary({ ...c, model: 'nai-diffusion-4-5-curated', sampler: 'k_dpmpp_2m' })).toContain('DPM++ 2M · Exponential');
    expect(moreSummary({ ...c, model: 'nai-diffusion-5-full' })).toContain('Euler Ancestral · Karras');
  });

  it('按钮上的花费作不作数:NovelAI 的账户还在查时不作数;查到了、查不到(按 Opus 算)、别的种类都作数', () => {
    const tablet = { tier: 1, active: true, anlas: 100, v5_percent: null, v5_next_percent_s: null };
    expect(costPending(conn('a', 'novelai'), {}, {})).toBe(true);
    expect(costPending(conn('a', 'novelai'), { b: tablet }, { b: '401' })).toBe(true);
    expect(costPending(conn('a', 'novelai'), { a: tablet }, {})).toBe(false);
    expect(costPending(conn('a', 'novelai'), {}, { a: '401' })).toBe(false);
    expect(costPending(conn('a', 'sdapi'), {}, {})).toBe(false);
    expect(costPending(conn('a', 'openai'), {}, {})).toBe(false);
  });
});

describe('改一条连接', () => {
  const sd = { kind: 'sdapi' as const, base_url: 'http://192.168.1.20:7860', has_key: true };
  const nai = { kind: 'novelai' as const, base_url: null, has_key: true };

  it('地址收拾干净:去掉空白和末尾的 /,空的算没填(和后端存的时候一样)', () => {
    expect(tidyUrl('  http://a:7860/// ')).toBe('http://a:7860');
    expect(tidyUrl('   ')).toBeNull();
    expect(tidyUrl('')).toBeNull();
  });

  it('改没改地址:末尾多个 / 不算改;NovelAI 没有地址这一项', () => {
    expect(urlChanged(sd, 'http://192.168.1.20:7860/')).toBe(false);
    expect(urlChanged(sd, 'http://192.168.1.20:7861')).toBe(true);
    expect(urlChanged(sd, '')).toBe(true);
    expect(urlChanged(nai, 'http://whatever')).toBe(false);
  });

  it('保存发什么:地址变了带地址,填了 key 带 key,什么都没变不发', () => {
    expect(connPatch(sd, 'http://192.168.1.20:7860', '  ')).toBeNull();
    expect(connPatch(sd, 'http://192.168.1.20:7861/', '')).toEqual({ base_url: 'http://192.168.1.20:7861' });
    expect(connPatch(sd, '', '')).toEqual({ base_url: null });
    expect(connPatch(sd, 'http://192.168.1.20:7860', ' u:p ')).toEqual({ api_key: 'u:p' });
    expect(connPatch(sd, 'http://192.168.1.20:7861', 'u:p')).toEqual({ base_url: 'http://192.168.1.20:7861', api_key: 'u:p' });
    expect(connPatch(nai, '', 'pst-new')).toEqual({ api_key: 'pst-new' });
  });

  it('key 框的灰字:有 key 只写已保存;改了地址旧 key 要被清掉,写要重填;没 key 写这种连接的提示', () => {
    expect(keyHint(sd, 'http://192.168.1.20:7860')).toBe('已保存(留空不变)');
    expect(keyHint(sd, 'http://192.168.1.20:7861')).toBe('改了地址,要重填');
    expect(keyHint({ ...sd, has_key: false }, 'http://192.168.1.20:7860')).toBe('可不填');
    // 本来就没 key,改地址也没东西可清
    expect(keyHint({ ...sd, has_key: false }, 'http://192.168.1.20:7861')).toBe('可不填');
    expect(keyHint(nai, '')).toBe('已保存(留空不变)');
    expect(keyHint({ ...nai, has_key: false }, '')).toBe('pst- 开头的那串');
  });

  it('按连接存的账户、报错:去掉一条,别的不动、原来的那份不改', () => {
    const m = { a: 1, b: 2 };
    expect(without(m, 'a')).toEqual({ b: 2 });
    expect(without(m, 'gone')).toEqual({ a: 1, b: 2 });
    expect(m).toEqual({ a: 1, b: 2 });
  });
});
