import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LangAskDialog } from './LangAskDialog';

const noop = () => {};

describe('LangAskDialog(换声音后问换不换语言)', () => {
  it('换成日语声音:标题「只识别日语」、问句、开关「切换为日语（中文字幕）」默认关着、一个确定', () => {
    const html = renderToStaticMarkup(<LangAskDialog toJa onDone={noop} />);
    expect(html).toContain('这个声音只识别日语');
    expect(html).toContain('是否更换对话语言？');
    expect(html).toContain('切换为日语（中文字幕）');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('确定');
    expect(html).not.toContain('删除');
  });

  it('换成中文声音:问「切换为中文」', () => {
    const html = renderToStaticMarkup(<LangAskDialog toJa={false} onDone={noop} />);
    expect(html).toContain('这个声音只识别中文');
    expect(html).toContain('切换为中文');
  });
});
