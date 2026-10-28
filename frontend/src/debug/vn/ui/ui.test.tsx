import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfirmHere } from './ConfirmHere';
import { FaceCrop } from './FaceCrop';
import { Help } from './Help';
import { Kbd } from './Kbd';
import { paperButtonClass } from './logic';
import { PaperButton } from './PaperButton';
import { PaperToast, ToastStack } from './PaperToast';
import { Range } from './Range';
import { Seg } from './Seg';
import { Switch } from './Switch';
import { FrostLayer } from './FrostLayer';

const noop = () => {};

describe('PaperButton', () => {
  it('class 按种类和大小拼', () => {
    expect(paperButtonClass()).toBe('av-btn');
    expect(paperButtonClass('primary')).toBe('av-btn primary');
    expect(paperButtonClass('danger', true)).toBe('av-btn danger sm');
    expect(paperButtonClass('normal', false, true)).toBe('av-btn is-armed');
  });
  it('默认是 type=button,不会误提交表单', () => {
    const html = renderToStaticMarkup(<PaperButton kind="ghost">好</PaperButton>);
    expect(html).toContain('type="button"');
    expect(html).toContain('class="av-btn ghost"');
  });
});

describe('Kbd / Seg / Switch / Range', () => {
  it('Kbd 画成 .av-kbd', () => {
    expect(renderToStaticMarkup(<Kbd>Esc</Kbd>)).toBe('<kbd class="av-kbd">Esc</kbd>');
  });
  it('Seg 是 radiogroup,选中那格 aria-checked 且带 on', () => {
    const html = renderToStaticMarkup(
      <Seg
        label="位置"
        value="b"
        onPick={noop}
        options={[
          { value: 'a', name: '左' },
          { value: 'b', name: '右' },
          { value: 'c', name: '无', disabled: true },
        ]}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('class="av-seg"');
    expect(html).toMatch(/aria-checked="true" class="on"[^>]*>右/);
    expect(html).toMatch(/aria-checked="false" class=""[^>]*>左/);
    expect(html).toContain('disabled');
  });
  it('Seg 能换 class(设置页过渡期继续用 vn-seg)', () => {
    const html = renderToStaticMarkup(<Seg className="vn-seg" value={1} onPick={noop} options={[{ value: 1, name: '一' }]} />);
    expect(html).toContain('class="vn-seg"');
  });
  it('Switch 底下是 checkbox(role=switch),sm 是小号', () => {
    const html = renderToStaticMarkup(<Switch checked label="语音" onChange={noop} sm />);
    expect(html).toContain('class="av-switch sm"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="语音"');
    expect(html).toContain('checked');
  });
  it('Range 写 --p 填充比例', () => {
    const html = renderToStaticMarkup(<Range value={25} min={0} max={100} label="音量" onChange={noop} />);
    expect(html).toContain('type="range"');
    expect(html).toContain('class="av-range"');
    expect(html).toContain('--p:25%');
    expect(html).toContain('aria-label="音量"');
  });
});

describe('Help', () => {
  it('hover 模式只画「?」按钮,说明悬停了才出', () => {
    const html = renderToStaticMarkup(<Help tip="说明文字" />);
    expect(html).toContain('class="av-help"');
    expect(html).toContain('aria-label="说明"');
    expect(html).not.toContain('说明文字');
    expect(html).not.toContain('av-tipbox');
  });
  it('tap 模式没点开时 aria-expanded=false,不画展开的那段', () => {
    const html = renderToStaticMarkup(<Help tip="说明文字" mode="tap" />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('av-tip-inline');
  });
});

describe('FaceCrop', () => {
  it('有图:按脸裁,img 绝对定位', () => {
    const html = renderToStaticMarkup(<FaceCrop src="/a.png" aspect={0.5} size={40} face={{ x: 0.4, y: 0.1, w: 0.2, h: 0.14 }} title="开心" />);
    expect(html).toContain('class="av-face"');
    expect(html).toContain('width:40px;height:40px');
    expect(html).toContain('height:200px');
    expect(html).toContain('src="/a.png"');
  });
  it('没图:虚线空圈', () => {
    expect(renderToStaticMarkup(<FaceCrop aspect={1} />)).toContain('av-face is-none');
  });
  it('方形', () => {
    expect(renderToStaticMarkup(<FaceCrop src="/a.png" aspect={1} shape="square" />)).toContain('av-face is-square');
  });
});

describe('PaperToast', () => {
  it('出错用 alert,带英文原文;警告有「×」', () => {
    const err = renderToStaticMarkup(<PaperToast toast={{ id: 1, kind: 'err', text: '保存失败', code: 'ConnectionError: x' }} onRemove={noop} />);
    expect(err).toContain('role="alert"');
    expect(err).toContain('av-toast is-x is-err');
    expect(err).toContain('ConnectionError: x');
    expect(err).not.toContain('aria-label="收起"');
    const warn = renderToStaticMarkup(<PaperToast toast={{ id: 2, kind: 'warn', text: '余额不多' }} onRemove={noop} />);
    expect(warn).toContain('aria-label="收起"');
    expect(warn).toContain('role="status"');
  });
  it('提示条堆按位置和主题挂 class', () => {
    const html = renderToStaticMarkup(<ToastStack pos="bc" theme="black" toasts={[{ id: 1, text: '好了', en: 'Saved' }]} onRemove={noop} />);
    expect(html).toContain('av-toasts is-bc av-night');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Saved');
  });
});

describe('ConfirmDialog', () => {
  it('alertdialog,标题关联,按钮默认文字;出场时挂 av-pop-out', () => {
    const html = renderToStaticMarkup(<ConfirmDialog title="删掉这张卡?" body="找不回来" onClose={noop} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain('删除');
    expect(html).toContain('留着');
    expect(html).toContain('av-pop-in');
    const out = renderToStaticMarkup(<ConfirmDialog title="x" leaving onClose={noop} />);
    expect(out).toContain('av-pop-out');
    expect(out).toContain('av-fade-out');
  });
  it('主题决定纸', () => {
    expect(renderToStaticMarkup(<ConfirmDialog title="x" theme="black" onClose={noop} />)).toContain('av-night');
    expect(renderToStaticMarkup(<ConfirmDialog title="x" onClose={noop} />)).toContain('av-day');
  });
});

describe('FrostLayer', () => {
  it('一层 .av-frost-layer 里放模糊背景图', () => {
    const html = renderToStaticMarkup(<FrostLayer src="/bg.jpg" style={{ width: 100 }} />);
    expect(html).toContain('class="av-frost-layer"');
    expect(html).toContain('src="/bg.jpg"');
  });
});

describe('ConfirmHere(删存档就地确认)', () => {
  it('画出标题、说明和「删除 / 留着」,删除是红字、留着是主按钮', () => {
    const html = renderToStaticMarkup(<ConfirmHere title="删掉以后找不回来" body="这 12 条对话一起删" onClose={noop} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="false"');
    expect(html).toContain('删掉以后找不回来');
    expect(html).toContain('这 12 条对话一起删');
    expect(html).toMatch(/class="av-btn danger sm"[^>]*>删除</);
    expect(html).toMatch(/class="av-btn primary sm"[^>]*>留着</);
    expect(html).toContain('av-day');
  });
  it('淡出时换成 av-pop-out', () => {
    expect(renderToStaticMarkup(<ConfirmHere title="t" leaving onClose={noop} />)).toContain('av-pop-out');
  });
});
