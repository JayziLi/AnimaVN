import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../../lib/chatEntry';
import { EMPTY_MACRO_CONTEXT } from '../../lib/macros';
import type { TagKind, VNLine } from '../script';
import { VNHistory, type VNHistoryProps } from './VNHistory';
import type { HistoryData, LogLines } from './logic';

const entry = (id: string, role: 'user' | 'assistant', text: string): ChatEntry => ({
  id,
  role,
  swipes: [text],
  swipeIndex: 0,
  swipeInfo: [{ sendDate: '' }],
  overswipe: 'regenerate',
});
const say = (text: string, over: Partial<VNLine> = {}): VNLine => ({ speaker: '星绘', text, ...over });
const kinds: TagKind[] = [{ kind: 'sprite', pattern: /<sprite:([^>]+)>/, prefix: '<sprite:' }];

const lines: VNLine[] = [say('「早」', { ja: 'おはよう' }), { speaker: null, text: '她笑了。' }];
const logLines: LogLines = { lines, plans: [null, null], hits: [], streaming: false };
const data: HistoryData = {
  of: (e) => (e.id === 'a' ? logLines : null),
  at: { entryId: 'a', line: 0 },
  showJa: true,
  jaHidden: () => false,
  esc: { current: null },
};

const props = (over: Partial<VNHistoryProps> = {}): VNHistoryProps => ({
  entries: [entry('u', 'user', '你好'), entry('a', 'assistant', '<sprite:开心>「早」她笑了。')],
  chatKey: 'c1',
  loading: false,
  raw: false,
  data,
  tagKinds: kinds,
  macros: EMPTY_MACRO_CONTEXT,
  charName: '星绘',
  userName: '旅行者',
  sending: false,
  onJump: () => {},
  onEdit: () => {},
  ...over,
});

describe('VNHistory', () => {
  it('一句一行:名字 + 台词,旁白没有名字,日语小字在中文上方,现在停的那句标「现在」', () => {
    const html = renderToStaticMarkup(<VNHistory {...props()} />);
    expect(html).toContain('旅行者');
    expect(html).toContain('「早」');
    expect(html.indexOf('おはよう')).toBeGreaterThan(-1);
    expect(html.indexOf('おはよう')).toBeLessThan(html.indexOf('「早」'));
    expect(html).toContain('现在');
    expect(html.match(/class="vh-ln /g)).toHaveLength(3);
    // 旁白一行没有名字
    expect(html.match(/class="vh-who"/g)).toHaveLength(2);
  });

  it('每句都能「回到这里」;用户消息不能', () => {
    const html = renderToStaticMarkup(<VNHistory {...props()} />);
    expect(html.match(/回到这里/g)).toHaveLength(2);
  });

  it('纸跟主题:样式里不写死颜色(只用 --av-* 变量)、没有胶囊、没有发光', () => {
    const css = readFileSync(fileURLToPath(new URL('./history.css', import.meta.url)), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/999px/);
    expect(css).not.toMatch(/text-shadow/);
    expect(css).not.toMatch(/--av-acc/);
  });

  it('显示原文:回复合成一整块,标签露成浅色小字,有「改」', () => {
    const html = renderToStaticMarkup(<VNHistory {...props({ raw: true })} />);
    expect(html).toContain('vh-raw can');
    expect(html).toContain('<span class="vh-tag">&lt;sprite:开心&gt;</span>');
    expect(html).toContain('aria-label="改原文"');
    expect(html).not.toContain('看这条回复的原文');
  });

  it('生成中不给改原文', () => {
    const html = renderToStaticMarkup(<VNHistory {...props({ raw: true, sending: true })} />);
    expect(html).not.toContain('vh-raw can');
    expect(html).not.toContain('aria-label="改原文"');
  });

  it('对话很长只先排最近几条,上面留一行「往上翻」', () => {
    const many: ChatEntry[] = Array.from({ length: 80 }, (_, i) => entry(`u${i}`, 'user', `第${i}句`));
    const html = renderToStaticMarkup(<VNHistory {...props({ entries: many })} />);
    expect(html).toContain('往上翻,更早的会接着载入');
    expect(html.match(/class="vh-ln /g)!.length).toBeLessThan(40);
    expect(html).toContain('第79句');
    expect(html).not.toContain('第0句');
  });

  it('游戏里「改原文」进来:那条回复一打开就是打字框;你说的、在等回复时不进编辑', () => {
    const html = renderToStaticMarkup(<VNHistory {...props({ editFirst: 'a' })} />);
    expect(html).toContain('<textarea');
    expect(html).toContain('&lt;sprite:开心&gt;「早」她笑了。');
    expect(html).toContain('vh-ln reply cur editing');
    expect(renderToStaticMarkup(<VNHistory {...props({ editFirst: 'u' })} />)).not.toContain('<textarea');
    expect(renderToStaticMarkup(<VNHistory {...props({ editFirst: 'a', sending: true })} />)).not.toContain('<textarea');
    expect(renderToStaticMarkup(<VNHistory {...props({ editFirst: 'gone' })} />)).not.toContain('<textarea');
  });

  it('没有对话 / 在读对话', () => {
    expect(renderToStaticMarkup(<VNHistory {...props({ entries: [] })} />)).toContain('还没有对话');
    expect(renderToStaticMarkup(<VNHistory {...props({ entries: [], loading: true })} />)).toContain('读取对话');
  });
});
