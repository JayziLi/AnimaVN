/**
 * 局内全屏菜单:左边一列导航(分三组:角色相关 / 历史对话管理 / 设置方面,组间一道细线、不写组名),
 * 右边换页。插件 / 素材 / 模型 / 开发者和别的页一样是普通一项,在同一块面板里开,没有单独的整屏工具层。
 * 游戏画面还在后面,只是模糊压暗。竖屏时导航变成顶部一排能横着滑的标签(见 vn.css)。
 *
 * 这里只管壳子,每页画什么由外面传进来。
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimaLogo } from './AnimaLogo';
import { popThemeClass, type PopTheme } from './ui/logic';
import { menuCrumb } from './menuLabel';

export type MenuPage = 'log' | 'save' | 'album' | 'card' | 'plugin' | 'assets' | 'preset' | 'model' | 'config' | 'dev';

/** 每一项的线条图标:照设计稿 kit/icons.js 局内菜单那几个(24×24、1.5 线宽、圆头圆角、跟字色) */
const NAV_ICON: Record<MenuPage | 'exit' | 'load', ReactNode> = {
  // 角色:半身人像
  card: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c.9-3.5 3.7-5.5 7-5.5s6.1 2 7 5.5" />
    </>
  ),
  // 预设:折角纸 + 两行字
  preset: (
    <>
      <path d="M6.5 3.5h7.5l4 4v13h-11.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9.5 12h5M9.5 15.5h5" />
    </>
  ),
  // 插件:插头
  plugin: (
    <>
      <path d="M9 3.5v4M15 3.5v4" />
      <path d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16.5v4" />
    </>
  ),
  // 历史:逆时针箭头绕一圈的钟
  log: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3.7h3.7" />
      <path d="M12 8v4.3l2.8 1.7" />
    </>
  ),
  // 存档:书签
  save: <path d="M7 4.5h10v15l-5-3.6-5 3.6z" />,
  // 相册:一张图(山 + 太阳)
  album: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="15.5" cy="9.5" r="1.5" />
      <path d="M4 16.5l4.5-4.5 3.5 3.5 2-2 5.5 5" />
    </>
  ),
  // 设置:两根滑杆
  config: (
    <>
      <path d="M4.5 7.5h8M16.5 7.5h3M4.5 16.5h3M11.5 16.5h8" />
      <circle cx="14.5" cy="7.5" r="2" />
      <circle cx="9.5" cy="16.5" r="2" />
    </>
  ),
  // 模型:芯片
  model: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" />
    </>
  ),
  // 素材:三层叠起来
  assets: (
    <>
      <path d="M12 4 3.5 8.2 12 12.4l8.5-4.2z" />
      <path d="M3.5 12.2 12 16.4l8.5-4.2" />
      <path d="M3.5 16.2 12 20.4l8.5-4.2" />
    </>
  ),
  // 开发者:代码尖括号
  dev: (
    <>
      <path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5" />
      <path d="M13.5 5.5l-3 13" />
    </>
  ),
  // 读档(从封面来):文件夹 + 往外拿的箭头
  load: (
    <>
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2.3H19a1.5 1.5 0 0 1 1.5 1.5v8.2A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M12 16.2v-5M9.8 13.2 12 11l2.2 2.2" />
    </>
  ),
  // 返回标题:出门
  exit: (
    <>
      <path d="M13.5 4.5h-7a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h7" />
      <path d="M10.5 12h10M17.5 9l3 3-3 3" />
    </>
  ),
};

function NavIcon({ name, size }: { name: MenuPage | 'exit' | 'load'; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {NAV_ICON[name]}
    </svg>
  );
}

/** 左边那列分三组,组之间一道细线、不写组名(10-25 用户:「分为 3 个:和角色相关的;历史对话管理;然后设置方面的」)。
 * 插件 / 素材 / 模型 / 开发者和别的页一样是普通的一项,在右边同一块面板里开,不是单独的整屏工具层。 */
const MENU_GROUPS: { key: MenuPage; name: string }[][] = [
  [
    { key: 'card', name: '角色' },
    { key: 'preset', name: '预设' },
    { key: 'plugin', name: '插件' },
  ],
  [
    { key: 'log', name: '历史' },
    { key: 'save', name: '存档' },
    { key: 'album', name: '相册' },
  ],
  [
    { key: 'config', name: '设置' },
    { key: 'model', name: '模型' },
    { key: 'assets', name: '素材' },
    { key: 'dev', name: '开发者' },
  ],
];

/** 页名后面的斜体英文小标(设计稿 .av-title-en;读档另写 Load) */
const PAGE_EN: Record<MenuPage, string> = {
  log: 'Backlog',
  save: 'Save',
  album: 'Album',
  card: 'Heroine',
  plugin: 'Plugins',
  assets: 'Assets',
  preset: 'Preset',
  model: 'Model',
  config: 'Config',
  dev: 'Developer',
};

const PAGE_NAME: Record<MenuPage, string> = {
  log: '历史',
  save: '存档',
  album: '相册',
  card: '角色',
  plugin: '插件',
  assets: '素材',
  preset: '预设',
  model: '模型',
  config: '设置',
  dev: '开发者',
};

/** 从封面点「读档 / 设置」进来:左边只有这两页,「存档」页这时候是读档 */
const COVER_PAGES: { key: MenuPage; name: string }[] = [
  { key: 'save', name: '读档' },
  { key: 'config', name: '设置' },
];

interface Props {
  page: MenuPage;
  onPage: (page: MenuPage) => void;
  /** 从游戏里打开(全部分组 + 「返回标题」),还是从封面「读档 / 设置」打开(只有这两页,盖在封面上,没有「返回标题」—— 关掉就是封面) */
  from?: 'game' | 'cover';
  /** 面板左上一行小字:角色 · 现在的场景 · 日子(menuLabel.ts 把默认的对话名拆成日子) */
  charName: string;
  chatName: string;
  /** 她现在待的场景名(面板左上那行小字);不给就不写 */
  sceneName?: string | null;
  /** 背后糊开的那张(这一幕的背景);没有就只垫纸 */
  bgSrc?: string | null;
  /** logo 下面的小圆头像(她的脸);不给就不画 */
  faceSrc?: string | null;
  /** 页头场景横幅:只有存档 / 读档 / 设置放,其余页不给就不画 */
  bannerSrc?: string | null;
  /** 页头右侧的额外控件(比如历史页的「显示原文」) */
  headExtra?: ReactNode;
  children: ReactNode;
  /** 正在关:淡出 0.18s(外面等淡完才卸),这段时间不接点击和键盘 */
  leaving?: boolean;
  onClose: () => void;
  onTitle: () => void;
  /** 不放进左栏的页:没装生图卡带时的「相册」;手机上的四个工具页(插件 / 素材 / 模型 / 开发者,手机版还没设计,先藏,见 TODO.md) */
  hidden?: readonly MenuPage[];
  /** 纸跟设置里的「主题」(白 / 黑 / 玻璃,10-24 定;白天夜里不变) */
  theme?: PopTheme;
}

export function VNMenu({
  page,
  onPage,
  from = 'game',
  charName,
  chatName,
  sceneName,
  bgSrc,
  faceSrc,
  bannerSrc,
  headExtra,
  children,
  leaving,
  onClose,
  onTitle,
  hidden,
  theme = 'white',
}: Props) {
  const cover = from === 'cover';
  const loading = cover && page === 'save';
  const headName = loading ? '读档' : PAGE_NAME[page];
  const headEn = loading ? 'Load' : PAGE_EN[page];
  // 窄屏时导航是一排横滑的标签,当前页可能在屏幕外 —— 换页时把它滚进来。
  // 不用 scrollIntoView(它会同步强制排版,perf-causes.md 记过):等画完再读位置、只动导航自己的 scrollLeft,电脑上根本不做
  const navRef = useRef<HTMLElement>(null);
  // 电脑上整层照设计稿等比缩放:设计稿是 1440×810 一张画,按画面 min(宽/1440, 高/810) 放大缩小(vn.css .vn-menu 用 --mn-k)。
  // 量的是外面那层(菜单盖住的画面),不量自己 —— 自己的宽高跟着倍数变
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const measure = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w && h) el.style.setProperty('--mn-k', String(Math.min(w / 1440, h / 810)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  const [badFace, setBadFace] = useState<string | null>(null);
  // 手机上往下滑:页头的大图和大标题收成顶上一条细栏(返回 · 小标题 · 返回标题),页签贴在栏下面(设计稿 phone.css 的 .pf-mstuck);
  // 滑回顶上再展开。页里谁在滚都算(历史、设置各有自己的滚动区),电脑上不做
  const pageRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = pageRef.current;
    if (!el || !window.matchMedia('(max-width: 640px)').matches) return;
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!(t instanceof HTMLElement) || t.scrollHeight - t.clientHeight < 120) return;
      if (t.scrollTop > 48) setCollapsed(true);
      else if (t.scrollTop < 8) setCollapsed(false);
    };
    el.addEventListener('scroll', onScroll, true);
    return () => el.removeEventListener('scroll', onScroll, true);
  }, []);
  // 换页时先展开(新的页从顶上开始;历史页一打开就滚到底,会自己再收起)
  useEffect(() => setCollapsed(false), [page]);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    const id = requestAnimationFrame(() => {
      const nav = navRef.current;
      const on = nav?.querySelector<HTMLElement>('.vn-nav.on');
      if (!nav || !on) return;
      const left = on.offsetLeft - nav.offsetLeft;
      if (left < nav.scrollLeft) nav.scrollLeft = left - 12;
      else if (left + on.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left + on.offsetWidth - nav.clientWidth + 12;
    });
    return () => cancelAnimationFrame(id);
  }, [page]);

  const navItem = (p: { key: MenuPage; name: string }, minor = false) => (
    <button
      key={p.key}
      className={`vn-nav${minor ? ' minor' : ''}${page === p.key ? ' on' : ''}`}
      aria-current={page === p.key ? 'page' : undefined}
      onClick={() => onPage(p.key)}
    >
      <span className="vn-nav-ic">
        <NavIcon name={cover && p.key === 'save' ? 'load' : p.key} size={minor ? 18 : 22} />
      </span>
      <span className="vn-nav-zh">{p.name}</span>
      {/* 手机上页签是 字 + 斜体英文(设计稿 phone.css 的 .pf-tabs) */}
      <span className="vn-nav-en">{cover && p.key === 'save' ? 'Load' : PAGE_EN[p.key]}</span>
    </button>
  );
  const onBanner = Boolean(bannerSrc);

  return (
    <div
      ref={rootRef}
      className={`vn-menu ${popThemeClass(theme)}${leaving ? ' leaving' : ''}${cover ? ' from-cover' : ''}${collapsed ? ' is-collapsed' : ''}`}
      role="dialog"
      aria-label="菜单"
      // 淡出的这 .18s 里整层还在、接住点击(不让点穿到底下的游戏),里面的按钮点了也不算
      onClickCapture={leaving ? (e) => e.stopPropagation() : undefined}
      onKeyDownCapture={leaving ? (e) => e.stopPropagation() : undefined}
    >
      {/* 背后是这一幕糊开(整屏只糊这一层,不叠毛玻璃) */}
      {bgSrc && <img className="vn-menu-bg" src={bgSrc} alt="" aria-hidden="true" draggable={false} />}
      <div className="vn-menu-veil" aria-hidden="true" />

      <nav className="vn-menu-nav" ref={navRef}>
        <div className="vn-menu-brand">
          <AnimaLogo size={36} variant="badge" />
        </div>
        {faceSrc && faceSrc !== badFace && (
          <img
            className="vn-menu-who"
            src={faceSrc}
            alt={charName}
            title={charName}
            draggable={false}
            // 没有带图的立绘时后端 404:不画这个圈
            onError={() => setBadFace(faceSrc)}
          />
        )}
        {cover
          ? COVER_PAGES.map((p) => navItem(p))
          : MENU_GROUPS.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <div className="vn-nav-sep" aria-hidden="true" />}
                {group.filter((p) => !hidden?.includes(p.key)).map((p) => navItem(p))}
              </Fragment>
            ))}
        <div className="vn-nav-gap" />
        {!cover && (
          <button className="vn-nav minor" onClick={onTitle}>
            <span className="vn-nav-ic">
              <NavIcon name="exit" size={18} />
            </span>
            <span className="vn-nav-zh">返回标题</span>
          </button>
        )}
      </nav>

      <section className={`vn-menu-page page-${page}`} ref={pageRef}>
        <div className={`vn-menu-crumb${onBanner ? ' on-banner' : ''}`} aria-hidden="true">
          {menuCrumb(charName, chatName, sceneName, cover)}
        </div>
        {/* 关闭键在面板右上角(96 宽的窄栏放不下图标 + 字 + Esc,挪到这边);从封面来的写「返回标题」。
            整合版的返回键前面不带「‹」(设计稿 pages/whole.js 的 buildMenu) */}
        <button type="button" className={`av-btn sm vn-menu-close${onBanner ? ' on-banner' : ''}`} onClick={onClose}>
          {/* 手机上(左上那颗)前面带「‹」,电脑上不带 */}
          <span className="vn-menu-chev" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </span>
          {cover ? '返回标题' : '返回游戏'}
          <kbd className="av-kbd">Esc</kbd>
        </button>
        {/* 换页只有这一块(页头 + 内容)0.16s 淡入,左边的导航不动 */}
        <div className="vn-menu-pagein av-page-in" key={page}>
          {bannerSrc && (
            <div className="vn-menu-banner" aria-hidden="true">
              <img src={bannerSrc} alt="" />
            </div>
          )}
          <header className={`vn-menu-head${onBanner ? ' on-banner' : ''}`}>
            <h2>
              <span className="zh">{headName}</span>
              <span className="en">{headEn}</span>
            </h2>
            {headExtra}
          </header>
          <div className="vn-menu-body">{children}</div>
        </div>
      </section>
    </div>
  );
}
