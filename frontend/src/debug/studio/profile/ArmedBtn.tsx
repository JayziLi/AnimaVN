import { useEffect, useState } from 'react';
import { Btn } from '../ui';

/**
 * 点两下才算的红字按钮:第一下变成「再点一次删除」(红底),再点才动手;
 * 点别处(失焦)或过 4 秒还原。删角色卡、删人设、删开场白用 —— 删了 0.6 秒后就自动存进库,没有撤销
 */
export function ArmedBtn({
  label,
  armedLabel = '再点一次删除',
  small,
  disabled,
  onConfirm,
}: {
  label: string;
  armedLabel?: string;
  small?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <Btn
      kind="danger"
      small={small}
      disabled={disabled}
      className={armed ? 'st-btn-danger-solid' : undefined}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? armedLabel : label}
    </Btn>
  );
}
