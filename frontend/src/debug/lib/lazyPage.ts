/**
 * 点开才用的页面、弹窗(卡编辑器、素材页、各个抽屉……)单独打包:打开网页头一屏不用先把它们下完。
 * 10-30 公网实测:国内连美国服务器常常只有每秒几十 KB,整包 500 KB 的程序要下半分钟以上,一半的人没等到画面出来就走了。
 *
 * - lazyPage(() => import('./x'), 'X'):和直接 import 的组件一样用,第一次画到它时才下载;用的地方包一层 <Lazy>
 *   (components/Lazy.tsx:下载中转圈、下载失败只在那一块提示)
 * - preloadPages():开机以后闲下来调一次,把这些包在后台先下好,点的时候基本不用等
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const loaders: (() => Promise<unknown>)[] = [];

/** 下载失败隔一会儿再试两次(网抖一下别直接报错) */
export async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await load();
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

/** ComponentType<any>:各个页面的 props 各不相同,类型由 M[K] 原样带出来 */
export function lazyPage<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> {
  loaders.push(load);
  return lazy(async () => ({ default: (await withRetry(load))[name] }));
}

let preloaded = false;

/** 把 lazyPage 登记过的包都在后台下好;下失败了不管,真点开时还会再下 */
export function preloadPages() {
  if (preloaded) return;
  preloaded = true;
  for (const load of loaders) void load().catch(() => {});
}
