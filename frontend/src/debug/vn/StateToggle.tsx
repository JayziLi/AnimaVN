/**
 * 视觉小说顶栏的状态按钮(素材架构设计 3.5.5):状态组里只有两个状态时点一下切到另一个,按钮上写对方的名字;
 * 三个以上时点开列出各状态,点哪个切哪个。切换落在正在看的这一句(调用方决定位置)。
 */

import { useState } from 'react';

export function StateToggle({
  names,
  current,
  onPick,
}: {
  /** 各状态的名字,按顺序(第一个是主状态) */
  names: readonly string[];
  /** 正在看的这句是哪个状态 */
  current: string;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = names.filter((n) => n !== current);
  if (others.length === 0) return null;
  if (names.length === 2) {
    const next = others[0];
    return (
      <button
        className="vn-chip vn-state"
        onClick={(e) => {
          e.stopPropagation();
          onPick(next);
        }}
        title={`现在是「${current}」· 点一下切到「${next}」`}
      >
        {next}
      </button>
    );
  }
  return (
    <span className="vn-state-menu">
      <button
        className="vn-chip vn-state"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="切换状态"
      >
        {current}
      </button>
      {open && (
        <span className="vn-state-list">
          {others.map((n) => (
            <button
              key={n}
              className="vn-chip vn-state"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onPick(n);
              }}
            >
              {n}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
