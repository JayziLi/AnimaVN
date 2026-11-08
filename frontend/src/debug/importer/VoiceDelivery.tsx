/**
 * 导完页 / 提示条里「送到语音机」的进度:每个新声音一行,送好前写「正在送到语音机…」,失败写后端原文和「重试」。
 * 状态在 useVoiceDelivery,每行写什么在 deliveryModel。
 */

import { deliveryText, type DeliveryItem } from './deliveryModel';

interface Props {
  items: readonly DeliveryItem[];
  onRetry: (id: string) => void;
}

/** 提示条里的一小段:「声音「X」正在送到语音机…」,失败时后面一个「重试」 */
export function DeliveryInline({ items, onRetry }: Props) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((i) => (
        <span key={i.id} className={`imp-deliver${i.step === 'fail' ? ' fail' : ''}`} role="status">
          声音「{i.name}」{deliveryText(i)}
          {i.step === 'fail' && (
            <button type="button" className="st-link" onClick={() => onRetry(i.id)}>
              重试
            </button>
          )}
        </span>
      ))}
    </>
  );
}

/** 导完纸卡里的几行(和别的几行同一个样子:名目 | 值 | 右边放按钮) */
export function DeliveryRows({ items, onRetry }: Props) {
  return (
    <>
      {items.map((i) => (
        <li key={i.id} className={`imp-deliver-row${i.step === 'fail' ? ' fail' : ''}`}>
          <span className="k">
            <b>送文件</b>
            <i>Sending</i>
          </span>
          <span className="v">
            <span>{i.name}</span>
            <small role="status">{deliveryText(i)}</small>
          </span>
          <span className="pv">
            {i.step === 'fail' && (
              <button type="button" className="av-btn" onClick={() => onRetry(i.id)}>
                重试
              </button>
            )}
          </span>
        </li>
      ))}
    </>
  );
}
