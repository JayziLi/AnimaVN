/**
 * 确认框怎么问:游戏开着时弹纸卡确认(ConfirmHost 画),没开时照旧用浏览器自带的 window.confirm(调试台先不改)。
 * 调用的地方 `await confirm({ ... })` 拿到 true / false,和原来同步的 window.confirm 一样意思:true = 往下做。
 * 不碰 DOM:控制器 createConfirmer 好单独测,React 这边只是一个 context + hook。
 */
import { createContext, useContext } from 'react';
import type { ConfirmReason } from './logic';

export interface ConfirmOptions {
  /** 纸卡上的标题(短一句) */
  title: string;
  /** 标题下面的小字 */
  body?: string;
  /** 标题右边斜体英文小标,不写是 Delete */
  en?: string;
  /** 红字那个按钮(做下去),不写是「删除」 */
  del?: string;
  /** 默认焦点那个按钮(不做),不写是「留着」 */
  keep?: string;
  /** 游戏没开(调试台里)时用 window.confirm 问的原话 */
  message: string;
}

export type Confirm = (o: ConfirmOptions) => Promise<boolean>;

export interface ConfirmRequest {
  id: number;
  options: ConfirmOptions;
}

export function createConfirmer(deps: {
  /** 游戏开着吗 */
  gameOpen: () => boolean;
  /** 游戏没开时用的同步确认(window.confirm) */
  system: (message: string) => boolean;
  /** 把要画的那条请求交给界面;null = 收起 */
  show: (req: ConfirmRequest | null) => void;
}) {
  let pending: { req: ConfirmRequest; resolve: (ok: boolean) => void } | null = null;
  let seq = 0;
  return {
    ask(options: ConfirmOptions): Promise<boolean> {
      if (!deps.gameOpen()) return Promise.resolve(deps.system(options.message));
      // 已经有一个在问了(比如 Esc 同时触发了弹窗自己的「要关吗」):这一个当作不做,别叠第二层
      if (pending) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const req = { id: ++seq, options };
        pending = { req, resolve };
        deps.show(req);
      });
    },
    /** 界面上点了哪个:只有「删除」(做下去)是 true;Esc / 点外面 / 留着都是不做 */
    settle(reason: ConfirmReason) {
      if (!pending) return;
      const p = pending;
      pending = null;
      deps.show(null);
      p.resolve(reason === 'delete');
    },
    get open() {
      return pending !== null;
    },
  };
}

/** 没有 Provider 时(单测、调试台单独跑的组件)直接用浏览器自带的 */
const ConfirmContext = createContext<Confirm>((o) => Promise.resolve(window.confirm(o.message)));
export const ConfirmProvider = ConfirmContext.Provider;
export const useConfirm = (): Confirm => useContext(ConfirmContext);
