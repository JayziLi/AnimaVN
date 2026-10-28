import { useCallback, useRef, useState } from 'react';
import type { ToastItem } from './PaperToast';

/** 提示条的数据:push 加一条(返回 id),set 就地改成另一种(「正在重连…」→「连上了」),remove 摘掉,clear 全清 */
export function useToaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextId.current++;
    setToasts((l) => [...l, { ...t, id }]);
    return id;
  }, []);
  const remove = useCallback((id: number) => setToasts((l) => l.filter((x) => x.id !== id)), []);
  const set = useCallback(
    (id: number, patch: Partial<Omit<ToastItem, 'id'>>) => setToasts((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    [],
  );
  const clear = useCallback(() => setToasts([]), []);
  return { toasts, push, remove, set, clear };
}
