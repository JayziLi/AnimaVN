/**
 * 游戏窗口(启动器开的游戏本体 packaging/windows/payload/launcher/game.py)给页面的接口:窗口模式、画面大小。
 * 和启动器设置页是同一份设置,改了游戏窗口马上套上。在浏览器里打开时没有这个接口,设置页就不显示这两行。
 */

export type GameDisplayMode = 'fullscreen' | 'borderless' | 'window';

export interface GameDisplay {
  display: GameDisplayMode;
  /** 「1920x1080」这样 */
  size: string;
  /** 这块屏幕放得下的那几档 */
  sizes: string[];
}

export interface GameWindowApi {
  get_display(): Promise<GameDisplay>;
  set_display(key: 'game_display' | 'game_size', value: string): Promise<GameDisplay>;
}

export const DISPLAY_MODES: { value: GameDisplayMode; name: string }[] = [
  { value: 'fullscreen', name: '全屏' },
  { value: 'borderless', name: '无边框窗口' },
  { value: 'window', name: '窗口' },
];

export function gameWindowApi(scope: unknown = globalThis): GameWindowApi | null {
  const api = (scope as { pywebview?: { api?: Partial<GameWindowApi> } }).pywebview?.api;
  return api && typeof api.get_display === 'function' && typeof api.set_display === 'function'
    ? (api as GameWindowApi)
    : null;
}

export const sizeName = (size: string) => size.replace('x', ' × ');
