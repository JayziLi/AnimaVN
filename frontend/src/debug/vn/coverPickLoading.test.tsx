import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PackSprite } from '../lib/api';
import { spriteForMood } from './titleArt';
import { VNLoading } from './VNLoading';
import { VNPick } from './VNPick';
import { VNTitle, type TitleCard } from './VNTitle';

const cards: TitleCard[] = [
  { id: 'c1', name: '星绘', avatar: null, hasLastChat: true },
  { id: 'c2', name: 'DeepSeek娘', avatar: null, hasLastChat: false },
];

describe('VNPick:选角色(10-23 新版)', () => {
  const html = renderToStaticMarkup(
    <VNPick
      cards={cards}
      currentCardId="c1"
      lastPlayed={null}
      onBack={() => {}}
      onContinue={() => {}}
      onImport={() => {}}
      onWantAvatar={() => {}}
    />,
  );
  it('搜索框占位「搜索名字、作者」,没有按标签筛选那一排', () => {
    expect(html).toContain('placeholder="搜索名字、作者"');
    expect(html).not.toContain('按标签筛选');
    expect(html).not.toContain('标签');
  });
  it('卡面是星语式:错开的细线框 + 名字 + AnimaVN 小标,选中那张带 on', () => {
    expect(html.match(/class="pk-tile/g)?.length).toBe(3); // 两张卡 + 导入那一格
    expect(html).toContain('class="ofr"');
    expect(html).toContain('class="mk"');
    expect(html).toContain('pk-tile on cur');
  });
  it('不放角色台词,「只留继续 / 资料」,没有「新的故事」', () => {
    expect(html).not.toContain('啊,对了');
    expect(html).not.toContain('新的故事');
    expect(html).toContain('继续');
    expect(html).toContain('资料');
  });
  it('纸面跟主题:默认白 = av-day;没给 onMore / onExport 就不画「更多」「导出」', () => {
    expect(html).toContain('class="pk-panel av-day"');
    expect(html).not.toContain('更多');
    expect(html).not.toContain('导出');
  });
  it('给了 onMore / onExport 才出「更多」和「导出」', () => {
    const withMore = renderToStaticMarkup(
      <VNPick
        cards={cards}
        currentCardId="c1"
        lastPlayed={null}
        onBack={() => {}}
        onContinue={() => {}}
        onWantAvatar={() => {}}
        onMore={() => {}}
        onExport={() => {}}
      />,
    );
    expect(withMore).toContain('更多');
    expect(withMore).toContain('导出');
  });
});

describe('VNLoading:加载页(U32)', () => {
  const render = (over: Partial<Parameters<typeof VNLoading>[0]> = {}) =>
    renderToStaticMarkup(
      <VNLoading charName="星绘" scenePackName="同居日常 · 星庇所" backdrop={null} fraction={0.5} slow={false} onSkip={() => {}} {...over} />,
    );
  it('右下「正在载入 · 名字 · 场景包」,左下 Tips,没有立绘、没有台词、没有拱形头像', () => {
    const html = render();
    expect(html).toContain('正在载入');
    expect(html).toContain('同居日常');
    expect(html).toContain('<em>Tips</em>');
    expect(html).not.toContain('vn-ld-face');
    expect(html).not.toContain('接下来');
  });
  it('进度:细线上的菱形跟着走,aria-valuenow 是百分数', () => {
    const html = render({ fraction: 0.5 });
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('--p:0.5000');
  });
  it('网络慢:进度停六成,左下换成「先进去」按钮,小贴士不画', () => {
    const html = render({ fraction: 0.9, slow: true });
    expect(html).toContain('aria-valuenow="62"');
    expect(html).toContain('先进去');
    expect(html).not.toContain('<em>Tips</em>');
  });
  it('图没到先铺平均色,不画 <img>;到了才画', () => {
    expect(render()).toContain('class="av-ld-ph"');
    expect(render()).not.toContain('av-ld-bg');
    expect(render({ backdrop: '/bg.jpg' })).toContain('av-ld-bg');
  });
});

describe('VNTitle:封面', () => {
  const sprites: PackSprite[] = [];
  const render = (over: Partial<Parameters<typeof VNTitle>[0]> = {}) =>
    renderToStaticMarkup(
      <VNTitle
        variant="paper"
        cold={false}
        cardId="c1"
        charName="星绘"
        lastPlayed={new Date(Date.now() - 2 * 3600000).toISOString()}
        lastMood={null}
        sprites={sprites}
        faces={new Map()}
        home={{ key: 'k', src: '/bg.jpg', focus: 50, label: '夜路' }}
        cards={cards}
        onContinue={() => {}}
        onNewStory={() => {}}
        onLoad={() => {}}
        onSettings={() => {}}
        onExit={() => {}}
        onPick={() => {}}
        {...over}
      />,
    );
  it('「继续」下面一行「地点 · 什么时候」,右下不放卡', () => {
    const html = render();
    // 地点衬线、中间的点淡墨、时间无衬线(照组件库 .cv-cont 分三段画)
    expect(html).toContain('<b>夜路</b><span class="sep">·</span>2 小时前');
    expect(html).not.toContain('vn-tt2-last');
  });
  it('没有角色时右下才是「先选一个角色」那张小卡,不用字符当图标', () => {
    const html = render({ cardId: null });
    expect(html).toContain('vn-tt2-last');
    expect(html).not.toContain('▶');
  });
  it('纸面跟主题:默认白 = av-day;全游戏不显示作品名、tag 小签', () => {
    const html = render();
    expect(html).toContain('vn-title paper av-day');
    expect(html).not.toContain('tag');
  });
});

describe('spriteForMood:指到「继续」换成存档那一刻的表情', () => {
  const s = (label: string): PackSprite => ({ id: label, label, aliases: [], has_image: true }) as unknown as PackSprite;
  const all = [s('平静'), s('微笑'), s('害羞')];
  it('有这个表情就用它', () => {
    expect(spriteForMood(all, 'continue', '害羞')?.label).toBe('害羞');
  });
  it('没有这个表情,或没存下来,退回这个场合的近义词', () => {
    expect(spriteForMood(all, 'continue', '大哭')?.label).toBe('微笑');
    expect(spriteForMood(all, 'continue', null)?.label).toBe('微笑');
  });
});
