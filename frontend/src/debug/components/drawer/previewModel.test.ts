import { describe, expect, it } from 'vitest';
import type { PackSprite, WordRecordOut } from '../../lib/api';
import type { ChatEntry } from '../../lib/chatEntry';
import { vnTagKinds } from '../../vn/tags';
import { peaks, recentLines, recentSpriteWords, resolveWordLocally } from './previewModel';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');
let seq = 0;
const entry = (role: 'user' | 'assistant', text: string): ChatEntry => ({
  id: `e${seq++}`,
  role,
  swipes: [text],
  swipeIndex: 0,
  swipeInfo: [{ sendDate: '' }],
  overswipe: 'regenerate',
});
const sprite = (id: string, label: string, aliases: string[] = []) =>
  ({ id, pack_id: 'p1', label, aliases, description: '', enabled: true }) as unknown as PackSprite;
const record = (word: string, item: string, source = 'model'): WordRecordOut => ({
  word,
  item,
  source,
  guessed: false,
  unstable: false,
  score: null,
});

describe('recentLines:最近几句角色的台词', () => {
  const chat = [
    entry('assistant', '<sprite:微笑>「欢迎回来。」'),
    entry('user', '我回来了'),
    entry('assistant', '<bg:茶馆>两人走进茶馆。\n<sprite:害羞>「哼,才不是特意在这里等你的。」\n「两位里边请。」店员说。\n<sprite:认真>「这份文件明天之前要批完。」'),
  ];
  const opts = { charName: '刻晴', userName: 'Lj', kinds };

  it('只取角色说的,去掉标签,新的在前', () => {
    expect(recentLines(chat, opts)).toEqual(['「这份文件明天之前要批完。」', '「哼,才不是特意在这里等你的。」', '「欢迎回来。」']);
  });

  it('最多几句;同一句不重复;没有对话是空的', () => {
    expect(recentLines(chat, opts, 1)).toEqual(['「这份文件明天之前要批完。」']);
    expect(recentLines([...chat, entry('assistant', '<sprite:微笑>「欢迎回来。」')], opts, 3)).toEqual([
      '「欢迎回来。」',
      '「这份文件明天之前要批完。」',
      '「哼,才不是特意在这里等你的。」',
    ]);
    expect(recentLines([], opts)).toEqual([]);
  });
});

describe('recentSpriteWords:AI 写过的表情词', () => {
  it('新的在前、去重、只要立绘标签', () => {
    const chat = [
      entry('assistant', '<sprite:微笑>「早。」\n<sprite:才不是>「哼。」'),
      entry('user', '嗯'),
      entry('assistant', '<bg:茶馆><sprite:嘿嘿>「走吧。」\n<sprite:微笑>「好。」'),
    ];
    expect(recentSpriteWords(chat, kinds)).toEqual(['微笑', '嘿嘿', '才不是']);
    expect(recentSpriteWords(chat, kinds, 2)).toEqual(['微笑', '嘿嘿']);
  });
});

describe('resolveWordLocally:这个词会换成哪张(只查不写)', () => {
  const sprites = [sprite('s1', '微笑', ['smile']), sprite('s2', '害羞'), sprite('s3', '生气')];

  it('名字 > 别名 > 认词记录', () => {
    expect(resolveWordLocally('微笑', sprites, [record('微笑', 's3')])).toEqual({ sprite: sprites[0], how: 'name' });
    expect(resolveWordLocally(' Smile ', sprites, [])).toEqual({ sprite: sprites[0], how: 'name' });
    expect(resolveWordLocally('才不是', sprites, [record('才不是', 's2')])).toEqual({ sprite: sprites[1], how: 'record' });
  });

  it('记录指着的立绘不在了、哪儿都没有:null', () => {
    expect(resolveWordLocally('才不是', sprites, [record('才不是', 'gone')])).toBeNull();
    expect(resolveWordLocally('欸', sprites, [])).toBeNull();
    expect(resolveWordLocally('  ', sprites, [])).toBeNull();
  });
});

describe('peaks:波形', () => {
  it('长度就是条数,都在 0–1,最响的那条是 1', () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 10) * (i / 1000);
    const p = peaks(samples, 40);
    expect(p).toHaveLength(40);
    expect(p.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...p)).toBeCloseTo(1);
    expect(p[0]).toBeLessThan(p[39]);
  });

  it('没声音、比条数还短也不出错', () => {
    expect(peaks(new Float32Array(100), 10)).toEqual(new Array(10).fill(0));
    expect(peaks(new Float32Array([0.5, -1]), 4)).toHaveLength(4);
    expect(peaks(new Float32Array(0), 3)).toEqual([0, 0, 0]);
  });
});
