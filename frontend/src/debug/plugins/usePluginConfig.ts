/**
 * 插件设置的统一读写:开机从库里读一次(库里没有就用默认值),改的时候先改内存,
 * 停手半秒再写库,免得每敲一个字发一次请求。立绘、背景、音乐、CG、外语、玩家台词、Jev、
 * 语音、立绘构图、卡带的全局配置都走这一份。
 *
 * 读、写、防抖在 pluginConfig.ts(纯逻辑,有测试);这里只把它们接到 state 上。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi } from '../lib/api';
import { createDebounce, loadPluginConfig, savePluginConfig, type ConfigMessages } from './pluginConfig';

type Notify = (kind: 'ok' | 'error', message: string) => void;

export interface PluginConfigState<T> {
  config: T;
  /** 先改内存,停手半秒再写库 */
  change: (next: T) => void;
  /** 开机那次读完了(读到、库里没有、读失败都算) */
  loaded: boolean;
}

/**
 * `key` 是设置的键(plugin.sprite 这类);`normalize` 把库里读到的整理成完整配置;
 * `defaults` 是还没读到、库里没有时用的;`messages` 只在提示文字和默认不一样时传
 */
export function usePluginConfig<T>(
  key: string,
  normalize: (raw: unknown) => T,
  defaults: T,
  notify: Notify,
  messages?: Partial<ConfigMessages>,
): PluginConfigState<T> {
  const [config, setConfig] = useState<T>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [debounce] = useState(() => createDebounce());

  // normalize 和提示文字常是调用方当场写的(每次渲染都是新的):放进 ref,
  // 不让它们一变就重读一遍库。开机那次读只跟着 key 和 notify 走
  const latest = useRef({ normalize, messages });
  useEffect(() => {
    latest.current = { normalize, messages };
  });

  // 开机读一次配置。StrictMode 双跑也没关系:两次读到的是同一份
  useEffect(() => {
    const { normalize: norm, messages: msg } = latest.current;
    void loadPluginConfig(debugApi, key, norm, (m) => notify('error', m), msg?.load).then((v) => {
      if (v !== null) setConfig(v);
      setLoaded(true);
    });
    // 卸载时清掉挂着的计时器,免得组件没了还在跑
    return () => debounce.cancel();
  }, [key, notify, debounce]);

  const change = useCallback(
    (next: T) => {
      setConfig(next);
      const label = latest.current.messages?.save;
      debounce.run(() => {
        void savePluginConfig(debugApi, key, next, (m) => notify('error', m), label);
      });
    },
    [key, notify, debounce],
  );

  return { config, change, loaded };
}
