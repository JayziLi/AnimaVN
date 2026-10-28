/** 插件抽屉游戏皮的 context(PluginsDrawer 提供,frame.tsx 和各页读;说明见 skinModel.ts) */

import { createContext, useContext } from 'react';
import type { PagePower } from './skinModel';

export interface DrawerSkinValue {
  game: boolean;
  /** 现在是哪一页(插件总表的 id、全局页、卡带的 key) */
  page: string;
  power: PagePower | null;
}

export const DrawerSkinContext = createContext<DrawerSkinValue>({ game: false, page: '', power: null });
export const useDrawerSkin = () => useContext(DrawerSkinContext);
