import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../lib/chatEntry';
import { vnTagKinds } from '../vn/tags';
import { hiddenJaCount, hideJa, historyText, jaHiddenOf, showJaAgain } from './jaHide';
import { stripJa } from './lang';

const kinds = vnTagKinds('<sprite:{表情}>', '<bg:{场景}>', '<bgm:{音乐}>', '<cg:{CG}>');

const BILINGUAL = `<sprite:微笑>
「おかえり。今日も一日、お疲れさま。」
「欢迎回来。今天也辛苦啦。」

彼女はそう言って、ソファの端に寄って場所を空けた。
她说着，往沙发边上挪了挪，给他让出位置。`;

const entry = (swipes: string[], extra: Partial<ChatEntry> = {}): ChatEntry => ({
  id: 'a',
  role: 'assistant',
  swipes,
  swipeIndex: 0,
  swipeInfo: swipes.map(() => ({ sendDate: '' })),
  overswipe: 'regenerate',
  ...extra,
});

describe('stripJa:摘掉挂在中文上的日语行', () => {
  it('日语行去掉,空行照旧,单独一行的标签留着', () => {
    expect(stripJa(BILINGUAL, kinds)).toBe(`<sprite:微笑>
「欢迎回来。今天也辛苦啦。」

她说着，往沙发边上挪了挪，给他让出位置。`);
  });

  it('写在日语行里的标签并到下面那行中文开头', () => {
    expect(stripJa('<sprite:害羞>「ありがとう。」\n「谢谢。」', kinds)).toBe('<sprite:害羞>「谢谢。」');
  });

  it('先中后日写反了的也摘', () => {
    expect(stripJa('「谢谢你。」\n「ありがとうね。」', kinds)).toBe('「谢谢你。」');
  });

  it('只写了日语、没配上中文的留着;没有日语的原样返回', () => {
    expect(stripJa('「おやすみなさい。」', kinds)).toBe('「おやすみなさい。」');
    expect(stripJa('她笑了笑。\n「晚安。」', kinds)).toBe('她笑了笑。\n「晚安。」');
  });
});

describe('隐藏前文日语的记号', () => {
  it('藏起来:每个分支都记上,发给模型的历史摘掉日语', () => {
    const e = hideJa(entry([BILINGUAL, '「ただいま。」\n「我回来了。」']), kinds);
    expect(e.swipeInfo.every((s) => s.vn?.jaHidden)).toBe(true);
    expect(jaHiddenOf(e)).toBe(true);
    expect(historyText(e, kinds)).not.toMatch(/おかえり/);
    expect(historyText({ ...e, swipeIndex: 1 }, kinds)).toBe('「我回来了。」');
  });

  it('没有日语的、用户消息、还在写的不记', () => {
    const zh = entry(['她笑了笑。']);
    expect(hideJa(zh, kinds)).toBe(zh);
    const user = entry([BILINGUAL], { role: 'user' });
    expect(hideJa(user, kinds)).toBe(user);
    const streaming = entry([BILINGUAL], { streaming: true });
    expect(hideJa(streaming, kinds)).toBe(streaming);
  });

  it('恢复:记号去掉,别的记号留着;没藏的历史原样', () => {
    const base = entry([BILINGUAL], { swipeInfo: [{ sendDate: '', vn: { manual: [{ line: 0, item: 'x', label: 'x' }] } }] });
    const hidden = hideJa(base, kinds);
    expect(hiddenJaCount([hidden, base])).toBe(1);
    const back = showJaAgain(hidden);
    expect(back.swipeInfo[0].vn).toEqual(base.swipeInfo[0].vn);
    expect(historyText(back, kinds)).toBe(BILINGUAL);
    expect(hiddenJaCount([back])).toBe(0);
  });
});
