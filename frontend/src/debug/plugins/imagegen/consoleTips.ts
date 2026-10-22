/**
 * 生图设置是不是开在插件抽屉里(place="console"):是的话行下面的说明收进名字旁的「?」,
 * 游戏设置里照旧写在行下面(第 2 步 E2)。ImageGenSettings 给,ui.tsx 的 Row / Group / Para 看
 */

import { createContext } from 'react';

export const ConsoleTips = createContext(false);
