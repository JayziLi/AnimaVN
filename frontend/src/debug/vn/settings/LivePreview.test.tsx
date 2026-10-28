import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VN_SETTINGS } from '../vnSettings';
import { LivePreview, type LivePreviewData } from './LivePreview';

const data: LivePreviewData = {
  bg: '/bg.png',
  sprite: '/spr.png',
  lines: [{ who: '星绘', text: '「今天也是晴天。」' }],
  accentStyle: {},
};

describe('LivePreview', () => {
  it('电脑:右边一栏,有标题、重播 / 下一句', () => {
    const html = renderToStaticMarkup(<LivePreview data={data} settings={DEFAULT_VN_SETTINGS} />);
    expect(html).toContain('class="vn-sp-pv"');
    expect(html).toContain('重播这句');
    expect(html).not.toContain('vn-sp-pvm');
  });

  it('手机:收成一条 —— 实机预览 + 正在播的那句 + 展开,画面收起着(inert)', () => {
    const html = renderToStaticMarkup(<LivePreview strip data={data} settings={DEFAULT_VN_SETTINGS} />);
    expect(html).toContain('class="vn-sp-pvm"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('实机预览');
    expect(html).toContain('<span class="ln">「今天也是晴天。」</span>');
    expect(html).toContain('展开');
    expect(html).toContain('inert');
    expect(html).not.toContain('重播这句');
  });
});
