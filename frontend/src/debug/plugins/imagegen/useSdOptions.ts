/** 本地 SD 连接能选的模型、采样器、调度器、LoRA(GET /options),和「刷新 LoRA」。画面页用(SdParts.tsx) */

import { useCallback, useEffect, useRef, useState } from 'react';
import { imagegenApi, type ConnOptions } from './api';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface SdOptions {
  /** 这条连接能选的;还没读到是 null */
  options: ConnOptions | null;
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** 先让服务重新扫一遍 LoRA 文件夹,再重拉列表 */
  refreshLoras: () => Promise<void>;
}

/** connId 是 null(选的不是本地 SD)时什么都不读 */
export function useSdOptions(connId: string | null): SdOptions {
  const [loaded, setLoaded] = useState<{ connId: string; options: ConnOptions } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 只收最后一次读的结果(换连接、连点刷新时先后会乱)
  const seq = useRef(0);
  const load = useCallback(async () => {
    const me = ++seq.current;
    setError(null);
    if (!connId) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const options = await imagegenApi.connectionOptions(connId);
      if (me === seq.current) setLoaded({ connId, options });
    } catch (e) {
      if (me === seq.current) {
        setLoaded({ connId, options: {} });
        setError(errText(e));
      }
    } finally {
      if (me === seq.current) setBusy(false);
    }
  }, [connId]);
  useEffect(() => {
    void load();
  }, [load]);
  const refreshLoras = useCallback(async () => {
    if (!connId) return;
    setBusy(true);
    setError(null);
    try {
      await imagegenApi.refreshLoras(connId);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
      return;
    }
    await load();
  }, [connId, load]);
  return { options: loaded && loaded.connId === connId ? loaded.options : null, busy, error, reload: load, refreshLoras };
}
