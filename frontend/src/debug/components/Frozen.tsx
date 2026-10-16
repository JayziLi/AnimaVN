import { memo, type ReactNode } from 'react';

/**
 * 冻住一块界面:frozen 期间父组件怎么重画,这块都原样不动 —— 不重新渲染,DOM、滚动位置、
 * 里面组件自己的状态(输入框草稿、展开的块)都留着;解冻那一次按最新的属性画一遍。
 *
 * 视觉小说盖在调试台上面时用它冻住底下看不见的三栏:流式时每来一段字整个调试台都要重画,
 * 三栏(预设面板逐块数 token、聊天区重排全部消息)跟着重画是白忙。2026-10-15 实测
 * 开发模式下这部分占了 AI 写字时一大半的 CPU,视觉小说画面本身只占一小块。
 *
 * 只挡住「父组件带来的」重画:里面的组件自己 setState、或者 context 变了,照样会更新。
 */
export const Frozen = memo(
  function Frozen({ children }: { frozen: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  // 返回 true = 不用重画。冻上的那一次(false → true)照常画,之后一直跳过,直到解冻
  (prev, next) => prev.frozen && next.frozen,
);
