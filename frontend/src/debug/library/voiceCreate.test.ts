import { describe, expect, it } from 'vitest';
import { ApiError, type VoiceProfile } from '../lib/api';
import { copyVoiceName, hasVoiceNamed, importOnce, newVoiceName, readRefs, refsLang } from './voiceCreate';

const voice = (name: string): VoiceProfile => ({
  id: 'v',
  name,
  aliases: [],
  connection_id: 'c',
  gpt_weights: '',
  sovits_weights: '',
  ref_path: '',
  text_lang: 'zh',
  speed: 1,
  params: {},
  emotions: [],
  card_count: 0,
});

describe('names', () => {
  it('picks the first free 新声音 name, ignoring case', () => {
    expect(newVoiceName([])).toBe('新声音');
    expect(newVoiceName(['刻晴', '新声音'])).toBe('新声音2');
    expect(newVoiceName(['新声音', '新声音2', '新声音3'])).toBe('新声音4');
    expect(newVoiceName(['Voice'], 'voice')).toBe('voice2');
  });

  it('names a second copy the way the backend does: 「名字 2」「名字 3」', () => {
    expect(copyVoiceName('刻晴', ['刻晴'])).toBe('刻晴 2');
    expect(copyVoiceName('刻晴', ['刻晴', '刻晴 2'])).toBe('刻晴 3');
    expect(copyVoiceName('Alice', ['alice', 'ALICE 2'])).toBe('Alice 3');
  });

  it('finds a voice with the same name, ignoring case and spaces around it', () => {
    expect(hasVoiceNamed(' Alice ', ['alice'])).toBe(true);
    expect(hasVoiceNamed('刻晴', ['刻晴(中文)'])).toBe(false);
  });
});

describe('readRefs', () => {
  it('stays quiet on an empty box', () => {
    expect(readRefs('  \n ')).toBeNull();
  });

  it('reads the character name and how many references there are', () => {
    const text = JSON.stringify({
      character: ' 刻晴 ',
      gpt_weights: 'D:/m/keqing.ckpt',
      refs: [{ file: 'D:/r/【平静】你好.wav' }, { file: 'D:/r/【开心】嘿嘿.wav' }],
    });
    const r = readRefs(text);
    expect(r).toMatchObject({ ok: true, name: '刻晴', count: 2, lang: null });
    expect(r?.ok && r.refs.gpt_weights).toBe('D:/m/keqing.ckpt');
  });

  it('finds the language the way the backend does', () => {
    const ref = (lang?: unknown) => ({ file: 'D:/r/a.wav', ...(lang !== undefined && { lang }) });
    // 每段参考都写着 ja(语音机上的清单就是这样)
    expect(refsLang({}, [ref('ja'), ref(' ja ')])).toBe('ja');
    expect(refsLang({}, [ref('ja'), ref()])).toBe('ja');
    // 顶层写了就听它的
    expect(refsLang({ text_lang: ' all_ja ' }, [ref('zh')])).toBe('all_ja');
    expect(refsLang({ lang: 'ja' }, [ref('zh')])).toBe('ja');
    // 没写、几段不一样、写的不是字:不动
    expect(refsLang({}, [ref()])).toBeNull();
    expect(refsLang({}, [ref('ja'), ref('zh')])).toBeNull();
    expect(refsLang({ text_lang: 3 }, [ref(4), 'x'])).toBeNull();
    expect(readRefs(JSON.stringify({ character: '诺亚', refs: [ref('ja')] }))).toMatchObject({ ok: true, lang: 'ja' });
  });

  it('says what is wrong, in the backend’s words', () => {
    expect(readRefs('{"character": "刻晴",')).toEqual({ ok: false, error: '不是合法的 JSON —— 把 refs.json 的全部内容贴进来' });
    expect(readRefs('[1, 2]')).toEqual({ ok: false, error: 'refs.json 应该是一个 { … } 对象' });
    expect(readRefs('{"refs": [{}]}')).toEqual({ ok: false, error: 'refs.json 里没有 character(角色名)' });
    expect(readRefs('{"character": "刻晴", "refs": []}')).toEqual({
      ok: false,
      error: 'refs.json 里没有 refs(参考音频列表)',
    });
  });
});

describe('importOnce', () => {
  it('hands back the imported voice', async () => {
    const sent: unknown[] = [];
    const r = await importOnce(async (c) => {
      sent.push(c);
      return voice('刻晴');
    });
    expect(r).toEqual({ kind: 'done', profile: voice('刻晴') });
    expect(sent).toEqual([undefined]);
  });

  it('turns a same-name 409 into a question instead of an error', async () => {
    const r = await importOnce(async () => {
      throw new ApiError('已经有叫「刻晴」的声音了:更新它,还是另建一个?', 409);
    });
    expect(r).toEqual({ kind: 'conflict', message: '已经有叫「刻晴」的声音了:更新它,还是另建一个?' });
  });

  it('sends the answer along the second time', async () => {
    const sent: unknown[] = [];
    await importOnce(async (c) => {
      sent.push(c);
      return voice('刻晴 2');
    }, 'new');
    expect(sent).toEqual(['new']);
  });

  it('lets other errors through, and a 409 after answering too', async () => {
    await expect(
      importOnce(async () => {
        throw new ApiError('refs 第 1 条没有 file(参考音频路径)', 400);
      }),
    ).rejects.toThrow('refs 第 1 条没有 file');
    await expect(
      importOnce(async () => {
        throw new ApiError('情绪名「开心」已经被「平静」占用了', 409);
      }, 'update'),
    ).rejects.toThrow('已经被');
  });
});
