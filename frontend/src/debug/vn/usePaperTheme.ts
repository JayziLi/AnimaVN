import { useSyncExternalStore } from 'react';
import { currentPaperTheme, subscribePaperTheme, type PaperTheme } from './vnSettings';

/**
 * 设置 · 外观 · 主题(白 / 黑 / 玻璃)。游戏里的 VNScreen 自己有设置对象直接读;
 * 游戏外面的(DebugApp 里的确认框)用这个跟着变:存设置时通知,别的标签页改了走 storage 事件。
 */
export function usePaperTheme(): PaperTheme {
  return useSyncExternalStore(subscribePaperTheme, currentPaperTheme, () => 'white');
}
