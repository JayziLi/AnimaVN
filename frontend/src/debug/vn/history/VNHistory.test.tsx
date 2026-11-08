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
  it('一条消息一块:头像和名字只在开头一次,她的台词不再写名字;日语小字在中文上方,现在停的那句标「现在」', () => {
    const html = renderToStaticMarkup(<VNHistory {...props()} />);
    expect(html.match(/class="vh-head/g)).toHaveLength(2);
    expect(html).toContain('<span class="vh-nm me">旅行者</span>');
    expect(html).toContain('<span class="vh-nm">星绘</span>');
    expect(html).toContain('「早」');
    expect(html.indexOf('おはよう')).toBeGreaterThan(-1);
    expect(html.indexOf('おはよう')).toBeLessThan(html.indexOf('「早」'));
    expect(html).toContain('现在');
    expect(html.match(/class="vh-ln /g)).toHaveLength(3);
    expect(html).not.toContain('class="vh-who');
    // 「现在」是第一句:后面那句旁白还没播到,变淡
    expect(html).toContain('vh-ln later narr');
  });

  it('AI 替你写的那句:你的名字 + 「AI 写的」;别人的台词写名字', () => {
    const mixed: LogLines = {
      lines: [say('「早」'), { speaker: '旅行者', text: '「嗯」', player: true }, { speaker: '店长', text: '「欢迎」' }],
      plans: [null, null, null],
      hits: [],
      streaming: false,
    };
    const html = renderToStaticMarkup(<VNHistory {...props({ data: { ...data, of: (e) => (e.id === 'a' ? mixed : null) } })} />);
    expect(html).toContain('AI 写的');
    expect(html.match(/class="vh-who me"/g)).toHaveLength(1);
    expect(html).toContain('<div class="vh-who">店长</div>');
  });

  it('最后一条回复有几版:名字后面 ‹ 2 / 3 ›;只有一版、没给 onSwipe 不显示', () => {
    const three: ChatEntry = { ...entry('a', 'assistant', '「早」'), swipes: ['1', '「早」', '3'], swipeIndex: 1 };
    const html = renderToStaticMarkup(<VNHistory {...props({ entries: [entry('u', 'user', '你好'), three], onSwipe: () => {} })} />);
    expect(html).toContain('aria-label="换版本"');
    expect(html).toContain('2 / 3');
    expect(renderToStaticMarkup(<VNHistory {...props({ onSwipe: () => {} })} />)).not.toContain('换版本');
    expect(renderToStaticMarkup(<VNHistory {...props({ entries: [entry('u', 'user', '你好'), three] })} />)).not.toContain('换版本');
  });

  it('换背景插横幅、CG 那几句画竖线,小图在线头那句左边一栏', () => {
    const scene: HistoryData['scene'] = (_id, line) => ({
      bg: { id: 'b1', label: '深夜卧室', src: '/bg.webp', focus: 50 },
      cg: line === 1 ? { id: 'c1', thumb: '/cg.webp', full: '/cg-big.webp' } : null,
    });
    const html = renderToStaticMarkup(<VNHistory {...props({ data: { ...data, scene, pics: true } })} />);
    expect(html).toContain('class="vh-list pics"');
    expect(html.match(/class="vh-scene[ "]/g)).toHaveLength(1);
    expect(html).toContain('深夜卧室');
    expect(html).toContain('src="/cg.webp"');
    // 小图在「现在」后面:跟着下面那句一起淡;悬停写着显示几句
    expect(html).toContain('class="vh-cg alone later"');
    expect(html).toContain('title="CG · 显示 1 句(点开看大图)"');
    expect(html).toMatch(/class="vh-cg alone later">.*?<\/div><div class="vh-ln rail rs re later/);
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
