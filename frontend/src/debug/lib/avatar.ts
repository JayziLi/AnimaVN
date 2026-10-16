import type { DebugPersona } from './api';
import { DEFAULT_AVATAR } from '../vn/fallbacks';

/** 没设头像时的兜底:定义在 vn/fallbacks.ts,这里照原名转出去,原来的调用方不用改 */
export { DEFAULT_AVATAR };

export const avatarOf = (p: DebugPersona | null | undefined) => p?.avatar || DEFAULT_AVATAR;
