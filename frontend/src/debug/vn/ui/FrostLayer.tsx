import type { CSSProperties } from 'react';
import './ui.css';

/** 垫在框里的那一层:模糊过的背景图 + 玻璃色 */
export function FrostLayer({ src, style }: { src?: string; style?: CSSProperties }) {
  return (
    <div className="av-frost-layer" aria-hidden="true">
      <img src={src} alt="" style={style} />
    </div>
  );
}
