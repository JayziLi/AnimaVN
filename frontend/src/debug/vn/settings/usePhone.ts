import { useSyncExternalStore } from 'react';

/** 手机竖屏的宽度门槛:和 vn.css 的局内菜单(升起来的纸)、settingRow.css / vnSettingsPage.css 的手机段是同一个 640px */
export const PHONE_QUERY = '(max-width: 640px)';

function subscribe(onChange: () => void) {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(PHONE_QUERY) : undefined;
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

function snapshot() {
  return typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;
}

/**
 * 现在是不是手机宽度:手机上没有悬停,「?」要点一下展开(Help 的 tap 模式);
 * 实机预览收成页签下面一条;「这页恢复默认」放到页尾。服务端渲染 / 测试里一律当电脑
 */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
