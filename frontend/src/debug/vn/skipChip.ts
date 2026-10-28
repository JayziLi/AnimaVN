/** 右上角「跳过中」小签上的字:按住 Ctrl 跳过的,说松开 Ctrl 就停;点「跳过」按钮跳过的,说点一下停 */
export function skipChipLabel(ctrlHeld: boolean): string {
  return ctrlHeld ? '跳过中 · 松开 Ctrl 停' : '跳过中 · 点一下停';
}
