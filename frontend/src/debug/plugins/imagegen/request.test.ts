import { describe, expect, it } from 'vitest';
import { DEFAULT_CARD_PREFS, DEFAULT_IMAGEGEN_CONFIG, type ImageGenConfig } from './config';
import { buildGenerate, buildTrial, TRIAL_LOOK, trialPicture, type DrawOrder } from './request';

const names = { cardId: 'card-1', charName: '星绘', userName: '阿青' };
const order: DrawOrder = {
  chatId: 'chat-1',
  entryId: 'e1',
  swipe: 0,
  line: 3,
  trigger: 'manual',
  title: '窗边',
  description: '她靠在窗边',
  picture: trialPicture('星绘'),
  size: { w: 1344, h: 768 },
  connectionId: 'c-nai',
};

describe('出图请求', () => {
  it('带上这张卡选的连接和问指导模型的毫秒;种子随机时不发', () => {
    const r = buildGenerate(DEFAULT_IMAGEGEN_CONFIG, DEFAULT_CARD_PREFS, names, { ...order, planMs: 2412.6 });
    expect(r.connection_id).toBe('c-nai');
    expect(r.plan_ms).toBe(2413);
    expect('seed' in r).toBe(false);
    expect([r.width, r.height]).toEqual([1344, 768]);
    expect(r.model).toBe('nai-diffusion-5-curated');
    expect(r.style.artists).toContain('fuzichoco');
    expect('plan_ms' in buildGenerate(DEFAULT_IMAGEGEN_CONFIG, DEFAULT_CARD_PREFS, names, order)).toBe(false);
    expect(buildGenerate(DEFAULT_IMAGEGEN_CONFIG, DEFAULT_CARD_PREFS, names, { ...order, planMs: 9_999_999 }).plan_ms).toBe(600_000);
  });

  it('填死的种子照发;玩家三个叫法都当玩家;参考图关了不带', () => {
    const c: ImageGenConfig = { ...DEFAULT_IMAGEGEN_CONFIG, seed: 42 };
    const r = buildGenerate(c, { ...DEFAULT_CARD_PREFS, ref: { ...DEFAULT_CARD_PREFS.ref, kind: 'off' } }, names, order);
    expect(r.seed).toBe(42);
    expect(r.looks['星绘'].ref).toBeNull();
    expect(r.looks['阿青'].player).toBe(true);
    expect(r.looks['玩家']).toEqual(r.looks['阿青']);
    expect(r.looks['你']).toEqual(r.looks['阿青']);
  });

  it('测试出图:固定一幕、不挂在哪条消息上;没选卡叫「她」、用内置的样子、不带参考图', () => {
    const r = buildTrial(DEFAULT_IMAGEGEN_CONFIG, DEFAULT_CARD_PREFS, { cardId: null, charName: '', userName: '你' }, 'c-nai', {
      width: 1600,
      height: 900,
    });
    expect(r.connection_id).toBe('c-nai');
    expect([r.chat_id, r.entry_id, r.line, r.trigger]).toEqual([null, null, null, 'manual']);
    expect(r.picture.people.map((p) => p.who)).toEqual(['她']);
    expect(r.looks['她'].tags).toBe(TRIAL_LOOK.look);
    expect(r.looks['她'].ref).toBeNull();
    expect([r.width, r.height]).toEqual([1344, 768]);
    const own = buildTrial(DEFAULT_IMAGEGEN_CONFIG, { ...DEFAULT_CARD_PREFS, look: 'silver hair' }, names, 'c-nai', {
      width: 400,
      height: 800,
    });
    expect(own.looks['星绘'].tags).toBe('silver hair');
    expect([own.width, own.height]).toEqual([768, 1344]);
  });

  it('本地 SD:带调度器、LoRA(关着的照发)、过程预览的编号;模型、采样器不发 NovelAI 的默认值', () => {
    const loras = [
      { name: 'xinghui', weight: 1, on: true, trigger: '' },
      { name: 'flat', weight: 0.8, on: false, trigger: 'flat' },
    ];
    const c: ImageGenConfig = { ...DEFAULT_IMAGEGEN_CONFIG, scheduler: 'Karras', loras };
    const r = buildGenerate(c, DEFAULT_CARD_PREFS, names, { ...order, connKind: 'sdapi', jobId: 'job-1' });
    expect(r.scheduler).toBe('Karras');
    expect(r.loras).toEqual(loras);
    expect(r.job_id).toBe('job-1');
    expect(r.model).toBe('');
    expect(r.sampler).toBe('');
    // 选过 checkpoint、采样器就照发
    const picked = buildGenerate({ ...c, model: 'wai.safetensors', sampler: 'DPM++ 2M' }, DEFAULT_CARD_PREFS, names, {
      ...order,
      connKind: 'sdapi',
    });
    expect([picked.model, picked.sampler]).toEqual(['wai.safetensors', 'DPM++ 2M']);
    expect('job_id' in picked).toBe(false);
  });

  it('别的连接不带这三项,模型和采样器照旧', () => {
    const c: ImageGenConfig = { ...DEFAULT_IMAGEGEN_CONFIG, scheduler: 'Karras', loras: [{ name: 'x', weight: 1, on: true, trigger: '' }] };
    for (const connKind of ['novelai', 'openai', null, undefined] as const) {
      const r = buildGenerate(c, DEFAULT_CARD_PREFS, names, { ...order, connKind, jobId: 'job-1' });
      expect('scheduler' in r || 'loras' in r || 'job_id' in r).toBe(false);
      expect(r.model).toBe('nai-diffusion-5-curated');
      expect(r.sampler).toBe('k_euler_ancestral');
    }
  });

  it('测试出图也带上连接种类和预览编号', () => {
    const r = buildTrial(DEFAULT_IMAGEGEN_CONFIG, DEFAULT_CARD_PREFS, names, 'c-sd', { width: 1600, height: 900 }, { connKind: 'sdapi', jobId: 'job-2' });
    expect(r.job_id).toBe('job-2');
    expect(r.model).toBe('');
    expect(r.connection_id).toBe('c-sd');
  });
});
