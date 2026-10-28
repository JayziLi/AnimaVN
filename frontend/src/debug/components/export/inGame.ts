/**
 * 游戏开着没有:画面上有 .vn-root(VNScreen 的根)。导入导出这几个框游戏里是纸卡(设计稿 kit/transfer.js),
 * 调试台里还是原来那套深色的。打开框的那一刻看一次就够(框开着时游戏不会被关掉)。
 */
export const inGame = (): boolean => typeof document !== 'undefined' && document.querySelector('.vn-root') !== null;
