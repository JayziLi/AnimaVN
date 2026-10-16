/**
 * 语音的扩展点(素材架构 2.8):装了提供它们的卡带就用,没装就是「没有这一层」——
 * 不换版本、不让 Jev 判档、不拆句拼接。用哪个在第一次用到时定下来、以后不变(cartridges.ts 的 lazyExtension),
 * hook 的调用顺序不随卡带变。
 */

import type { Notify } from '../components/pluginRunner';
import type { VoiceExplain } from '../lib/api';
import { lazyExtension, type SpliceState, type ToneAskContext, type VoiceDetailRow, type VoiceVersion } from './cartridges';

const versionExt = lazyExtension('versionOf');
const asksToneExt = lazyExtension('asksTone');
const spliceExt = lazyExtension('useSplice');
const detailExt = lazyExtension('voiceDetail');

/** 挑好语气行以后换成某个版本(plugins/voice.ts 的 planVoiceLines 用);没有是 null = 不换 */
export const voiceVersion = (): VoiceVersion | null => versionExt() ?? null;

/** 这条回复要不要让 Jev 给角色的台词判档(Jev 请求里的 ask_tone);没有 = 不问 */
export const asksTone = (ctx: ToneAskContext): boolean => asksToneExt()?.(ctx) ?? false;

const NO_SPLICE: SpliceState = { on: false, panel: null };

function useNoSplice(_notify: Notify): SpliceState {
  return NO_SPLICE;
}

/** DebugApp 调:拆句拼接的开关(语音请求的 sfx)和插件页里它那一页 */
export function useSplice(notify: Notify): SpliceState {
  const impl = spliceExt() ?? useNoSplice;
  return impl(notify);
}

/** 语音详情:这句走了卡带的那一层(比如拼接)时换掉「念的文字」那一行;没有是 null */
export const voiceDetail = (x: VoiceExplain): VoiceDetailRow | null => detailExt()?.(x) ?? null;
