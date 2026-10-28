import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CondWrap, SettingError, SettingGroupHead, SettingRow } from './SettingRow';

describe('SettingRow', () => {
  it('名字、斜体英文、BETA、说明各自画出来', () => {
    const html = renderToStaticMarkup(
      <SettingRow id="x" name="模型" en="Model" beta note="一句说明">
        <button>控件</button>
      </SettingRow>,
    );
    expect(html).toContain('data-row="x"');
    expect(html).toContain('<span class="st-nm">模型</span>');
    expect(html).toContain('<span class="st-en">Model</span>');
    expect(html).toContain('BETA');
    expect(html).toContain('一句说明');
    expect(html).toContain('<button>控件</button>');
  });

  it('没改过的行没有「改过」标记;改过的有,「恢复默认」带悬停说明', () => {
    const base = { name: '文字速度', resetText: '瞬间', onReset: () => undefined };
    const plain = renderToStaticMarkup(<SettingRow {...base} />);
    expect(plain).not.toContain('st-row changed');
    expect(plain).toContain('title="恢复默认:瞬间"');
    const changed = renderToStaticMarkup(<SettingRow {...base} changed />);
    expect(changed).toContain('st-row changed');
  });

  it('没给 onReset 的行(只读、按钮)没有「恢复默认」', () => {
    expect(renderToStaticMarkup(<SettingRow name="数据库" />)).not.toContain('恢复默认');
  });

  it('右边的当前值', () => {
    expect(renderToStaticMarkup(<SettingRow name="自动播放间隔" value="1.5 秒" />)).toContain('1.5 秒');
  });

  it('和插件页是同一个的小签,悬停说清楚两边一起变', () => {
    const html = renderToStaticMarkup(<SettingRow name="字幕" dup="外语" />);
    expect(html).toContain('和插件 · 外语是同一个');
    expect(html).toContain('data-tip="在「插件 · 外语」里改的也是这一个,两边一起变"');
  });

  it('说明后面的跳转', () => {
    const html = renderToStaticMarkup(<SettingRow name="跳字音" note="先调速度" jump={{ text: '去调文字速度', onJump: () => undefined }} />);
    expect(html).toContain('class="st-jump"');
    expect(html).toContain('去调文字速度');
  });

  it('名字旁的「?」:电脑是悬停(没有手机的点开样式);手机的点开模式由 usePhone 决定,服务端渲染一律当电脑', () => {
    const html = renderToStaticMarkup(<SettingRow name="主题" tip="白纸、黑纸还是玻璃" />);
    expect(html).toContain('class="av-help"');
    expect(html).not.toContain('av-tips-tap');
    expect(html).not.toContain('av-tip-inline');
  });

  it('条件行:open=false 收起且不可点(inert),open=true 展开;不写 open 就不包', () => {
    const closed = renderToStaticMarkup(<SettingRow name="特效音量" open={false} />);
    expect(closed).toContain('class="st-cond"');
    expect(closed).toContain('inert');
    const opened = renderToStaticMarkup(<SettingRow name="特效音量" open />);
    expect(opened).toContain('class="st-cond open"');
    expect(opened).not.toContain('inert');
    expect(renderToStaticMarkup(<SettingRow name="文字速度" />)).not.toContain('st-cond');
  });
});

describe('CondWrap / SettingError / SettingGroupHead', () => {
  it('CondWrap 的开合', () => {
    expect(renderToStaticMarkup(<CondWrap open>x</CondWrap>)).toContain('st-cond open');
    expect(renderToStaticMarkup(<CondWrap open={false}>x</CondWrap>)).not.toContain('open');
  });

  it('出错的红字:有话时展开,红圆「!」+ 字;没话收起', () => {
    const on = renderToStaticMarkup(<SettingError text="语音最近一次失败:连不上" />);
    expect(on).toContain('st-cond open');
    expect(on).toContain('role="alert"');
    expect(on).toContain('<i aria-hidden="true">!</i>');
    expect(on).toContain('语音最近一次失败:连不上');
    const off = renderToStaticMarkup(<SettingError text={null} />);
    expect(off).not.toContain('st-cond open');
  });

  it('小节标题:宋体名 + 斜体英文 + 小字,右边可放按钮', () => {
    const html = renderToStaticMarkup(
      <SettingGroupHead title="语音" en="Voice" note="这张卡用「星绘」的声音">
        <button>换音色 · 试音</button>
      </SettingGroupHead>,
    );
    expect(html).toContain('<span class="zh">语音</span>');
    expect(html).toContain('<span class="en">Voice</span>');
    expect(html).toContain('这张卡用「星绘」的声音');
    expect(html).toContain('换音色 · 试音');
  });
});
