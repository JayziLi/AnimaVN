/**
 * 内核几段默认文字(CG 的默认提示词块、示例名、说明):装了给出另一个版本的卡带就用它的(私有的说法),
 * 没装用这里的中性说法(公开版)。第一次用到时才去要(cartridges.ts 的 lazyExtension)。
 */

import { lazyExtension, type TextKey } from './cartridges';

const textsExt = lazyExtension('texts');

export const text = (key: TextKey, fallback: string): string => textsExt()?.[key] ?? fallback;
