import { useRef } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmRequest } from './confirm';
import type { ConfirmReason, PopTheme } from './logic';
import { MOTION, useFadeLayer } from './motion';
import './ui.css';

/**
 * 把确认请求画成纸卡。放在调试台最外层的固定层里(盖过游戏 90、卡编辑器 92、块编辑弹窗 95),
 * 所以从哪一层弹出来都看得见;请求没了先淡出再卸(useFadeLayer),淡出时还画着最后那一条。
 */
export function ConfirmHost({
  req,
  theme = 'white',
  onSettle,
}: {
  req: ConfirmRequest | null;
  theme?: PopTheme;
  onSettle: (reason: ConfirmReason) => void;
}) {
  const last = useRef<ConfirmRequest | null>(null);
  if (req) last.current = req;
  const layer = useFadeLayer(req !== null, MOTION.popOut);
  const shown = req ?? last.current;
  if (!layer.mounted || !shown) return null;
  const o = shown.options;
  return (
    <div className="av-confirm-host">
      <ConfirmDialog
        key={shown.id}
        title={o.title}
        body={o.body}
        en={o.en}
        del={o.del}
        keep={o.keep}
        theme={theme}
        leaving={layer.leaving}
        onClose={onSettle}
      />
    </div>
  );
}
