import type { ButtonHTMLAttributes, Ref } from 'react';
import { paperButtonClass, type PaperButtonKind } from './logic';
import './ui.css';

export type { PaperButtonKind };

export function PaperButton({
  kind = 'normal',
  sm,
  armed,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: PaperButtonKind;
  sm?: boolean;
  armed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const cls = paperButtonClass(kind, sm, armed);
  return <button type={type} className={className ? `${cls} ${className}` : cls} {...rest} />;
}
