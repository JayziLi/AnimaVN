import type { ReactNode } from 'react';
import './ui.css';

/** 键帽,例如「Esc」「Space」 */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="av-kbd">{children}</kbd>;
}
