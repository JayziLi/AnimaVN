/**
 * 包在 lazyPage(lib/lazyPage.ts)做的组件外面:还在下载 = 一个小转圈(veil = 盖住全屏的「正在打开…」);
 * 下载失败(网断了、网站刚更新过旧包没了)只在这一块说没加载出来、给「刷新页面」,不让整个界面白掉
 */

import { Component, Suspense, type ReactNode } from 'react';
import './lazy.css';

interface Props {
  children: ReactNode;
  /** 全屏的页面:下载时盖一层「正在打开…」;不给 = 原地一个小转圈 */
  veil?: boolean;
  /** 下载时什么都不画(调试台聊天区上的抽屉:别把聊天区顶下去一下) */
  quiet?: boolean;
}

export function Lazy({ children, veil, quiet }: Props) {
  const pending = quiet ? null : veil ? (
    <div className="lazy-veil">
      <div className="lazy-card">
        <span className="spinner" />
        正在打开…
      </div>
    </div>
  ) : (
    <div className="lazy-pending">
      <span className="spinner bare" />
    </div>
  );
  return (
    <LazyBoundary veil={veil}>
      <Suspense fallback={pending}>{children}</Suspense>
    </LazyBoundary>
  );
}

class LazyBoundary extends Component<{ children: ReactNode; veil?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const card = (
      <div className="lazy-card lazy-failed">
        <span>这一页没加载出来</span>
        <span className="lazy-error">{error.message}</span>
        <button className="btn small" onClick={() => location.reload()}>
          刷新页面
        </button>
      </div>
    );
    return this.props.veil ? <div className="lazy-veil">{card}</div> : <div className="lazy-pending">{card}</div>;
  }
}
