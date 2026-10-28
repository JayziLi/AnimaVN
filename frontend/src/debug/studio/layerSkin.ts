import { createContext } from 'react';

/**
 * 挂到 body 上的浮层(说明、「⋯」菜单、弹窗)在调试台里用 debug.css 的颜色;游戏菜单里的素材页(library/AssetLibrary 的 embedded)
 * 给一串类(「st-paper av-night」这类,纸面主题),浮层跟着换成纸,不再是一块深色压在纸上。不给 = 原样。
 */
export const LayerSkin = createContext('');
