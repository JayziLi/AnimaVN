import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { tapOnlyClosesBar } from './phoneBar';
import { GameIcon } from './ui/GameIcon';
import { VoiceLineIconsView } from './VoiceButtons';

describe('点画面:只收输入框,还是翻下一句', () => {
  const tap = (over: Partial<Parameters<typeof tapOnlyClosesBar>[0]> = {}) =>
    tapOnlyClosesBar({ phoneBar: true, barOpen: false, myTurn: false, hasDraft: false, ...over });

  it('手机:点开过输入框,这一下只收键盘,不翻句', () => {
    expect(tap({ barOpen: true })).toBe(true);
  });
  it('手机:写了字、或者轮到你,也只收键盘', () => {
    expect(tap({ barOpen: true, hasDraft: true })).toBe(true);
    expect(tap({ barOpen: true, myTurn: true })).toBe(true);
  });
  it('手机:没点开过输入框,照常翻句', () => {
    expect(tap()).toBe(false);
  });
  it('电脑:和原来一样,点开了、没写字、也不是轮到你才收起', () => {
    expect(tap({ phoneBar: false, barOpen: true })).toBe(true);
    expect(tap({ phoneBar: false, barOpen: true, hasDraft: true })).toBe(false);
    expect(tap({ phoneBar: false, barOpen: true, myTurn: true })).toBe(false);
    expect(tap({ phoneBar: false })).toBe(false);
  });
});

describe('手机输入框上面的语音图标', () => {
  const render = (over: Partial<Parameters<typeof VoiceLineIconsView>[0]> = {}) =>
    renderToStaticMarkup(
      <VoiceLineIconsView paused={false} loading={false} busy={false} replayTitle="重听" onReplay={() => {}} onRegenerate={() => {}} {...over} />,
    );
  const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? [];

  it('只有两颗:重听这一句、重新生成这句语音', () => {
    const html = render();
    expect(buttons(html)).toHaveLength(2);
    expect(html).toContain('aria-label="重听这一句"');
    expect(html).toContain('aria-label="重新生成这句语音"');
  });
  it('不写字,只放图标', () => {
    expect(render().replace(/<[^>]*>/g, '')).toBe('');
  });
  it('重新生成语音的图标和重来的 ↻ 不一样', () => {
    const retry = renderToStaticMarkup(<GameIcon name="retry" size={22} />);
    expect(render()).not.toContain(retry);
  });
  it('语音暂停了:两颗都点不了', () => {
    const [replay, regen] = buttons(render({ paused: true }));
    expect(replay).toContain('disabled');
    expect(regen).toContain('disabled');
  });
  it('这句正在合成:重新生成点不了;重听还能点,好了就放', () => {
    const [replay, regen] = buttons(render({ loading: true }));
    expect(replay).not.toContain('disabled');
    expect(regen).toContain('disabled');
  });
  it('在排队或合成时重新生成那颗呼吸,念完就停', () => {
    expect(buttons(render({ busy: true }))[1]).toContain('busy');
    expect(buttons(render())[1]).not.toContain('busy');
  });
});

describe('手机竖屏的样式', () => {
  const css = readFileSync(fileURLToPath(new URL('./vnLine.css', import.meta.url)), 'utf8');
  const start = css.indexOf('第 9 段 手机竖屏');
  const phone = css.slice(start, css.indexOf('长按台词出小菜单', start));

  it('不再写死按钮条有多宽(这次重叠的根源:加了 ‹ 4/4 › 以后按钮条比写死的 176 宽)', () => {
    expect(phone).not.toContain('176px');
  });
  it('打字时语音那排和右下让开,输入框占满一排', () => {
    expect(phone).toMatch(/:has\(\.ga-bar:focus-within\)[^{]*\.vn-strip-voice/);
    expect(phone).toMatch(/:has\(\.ga-bar:focus-within\)[^{]*\.vn-strip-tools/);
    expect(phone).toMatch(/:has\(\.ga-bar:focus-within\)[^{]*\.ga-bar/);
  });
  it('语音面板里不再重复放「这一句」', () => {
    expect(phone).toMatch(/\.vn-strip-voice \.ga-vq-line\s*\{\s*display: none/);
  });
});
