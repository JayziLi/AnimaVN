/** 换页只有右边内容淡入(左栏不动):游戏皮里包一层带淡入动画的 div(按页换 key 重放);别处不包,DOM 照旧 */

import type { ReactNode } from 'react';

export function PageSwap({ game, children }: { game: boolean; children: ReactNode }) {
  return game ? <div className="dw-swap">{children}</div> : <>{children}</>;
}
