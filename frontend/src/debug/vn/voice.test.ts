import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// api.ts 加载时就要读地址栏(后端地址跟着 hostname 走),测试环境没有 location
let api: typeof import('../lib/api');
let voice: typeof import('./voice');
beforeAll(async () => {
  (globalThis as { location?: unknown }).location ??= { hostname: 'localhost' };
  api = await import('../lib/api');
  voice = await import('./voice');
});

afterEach(() => {
  vi.restoreAllMocks();
  voice.voicePlayer.idle();
  voice.voicePlayer.reset();
});

const line = (i: number) => ({ profile_id: 'p', emotion: null, text: `第 ${i} 句` });

/** 排上 n 句,每句都按 fail 失败,等后端被请求 calls 次、手上没有合成中的句子 */
async function failAll(n: number, calls: number, fail: () => Error) {
  const speak = vi.spyOn(api.debugApi, 'speak').mockImplementation(() => Promise.reject(fail()));
  voice.voicePlayer.want(Array.from({ length: n }, (_, i) => line(i)));
  await vi.waitFor(() => {
    expect(speak).toHaveBeenCalledTimes(calls);
    const states = [...voice.voicePlayer.getSnapshot().clips.values()].map((c) => c.state);
    expect(states).not.toContain('loading');
  });
  return voice.voicePlayer.getSnapshot();
}

describe('isOutage', () => {
  it('counts only the failures where the voice server cannot be reached', () => {
    expect(voice.isOutage(new TypeError('Failed to fetch'))).toBe(true);
    expect(voice.isOutage(new Error('语音合成超过 60 秒没回来,这句先跳过'))).toBe(true);
    expect(voice.isOutage(new api.ApiError('连不上语音服务', 503))).toBe(true);
    expect(voice.isOutage(new api.ApiError('语音合成超时', 504))).toBe(true);
    expect(voice.isOutage(new api.ApiError('还没有参考音频', 400))).toBe(false);
    expect(voice.isOutage(new api.ApiError('声音不存在', 404))).toBe(false);
    expect(voice.isOutage(new api.ApiError('ref_audio_path not exists', 502))).toBe(false);
  });
});

describe('voice player failure count', () => {
  it('a missing reference marks the line but never pauses the voice', async () => {
    const snap = await failAll(5, 5, () => new api.ApiError('情绪「平静」还没填参考音频路径', 400));
    expect(snap.failures).toBe(0);
    expect(snap.lastError).toBe('情绪「平静」还没填参考音频路径');
    expect([...snap.clips.values()].filter((c) => c.state === 'error')).toHaveLength(5);
  });

  it('three lines in a row that cannot reach the server pause it', async () => {
    const snap = await failAll(5, voice.MAX_FAILURES, () => new api.ApiError('连不上语音服务', 503));
    expect(snap.failures).toBe(voice.MAX_FAILURES);
    // 停用以后排着的不再发
    await new Promise((r) => setTimeout(r, 20));
    expect(api.debugApi.speak).toHaveBeenCalledTimes(voice.MAX_FAILURES);
  });
});

describe('speak timeout', () => {
  it('turns the abort into a readable failure that counts as an outage', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));
    const err = await api.debugApi.speak(line(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(`${api.SPEAK_TIMEOUT_MS / 1000} 秒`);
    expect(voice.isOutage(err)).toBe(true);
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the status of a backend error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: '声音不存在' }), { status: 404 }),
    );
    const err = await api.debugApi.speak(line(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.ApiError);
    expect((err as InstanceType<typeof api.ApiError>).status).toBe(404);
    expect((err as Error).message).toBe('声音不存在');
  });
});
