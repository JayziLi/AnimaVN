/**
 * 插图的扩展点(生图卡带):装了提供它的卡带就用,没装就是「没有插图」——插件页少一页、视觉小说不多按钮、
 * CG 层照旧只放 CG 包里的图。用哪个在第一次用到时定下来、以后不变(cartridges.ts 的 lazyExtension),
 * hook 的调用顺序不随卡带变。
 */

import { lazyExtension, type IllustrationsInput, type IllustrationsState } from './cartridges';

const ext = lazyExtension('useIllustrations');

const NONE: IllustrationsState = { panel: null, vn: null };

function useNone(_o: IllustrationsInput): IllustrationsState {
  return NONE;
}

/** DebugApp 调:插件页里那一页、给视觉小说的几样 */
export function useIllustrations(o: IllustrationsInput): IllustrationsState {
  const impl = ext() ?? useNone;
  return impl(o);
}
