import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { frostImgStyle, frostOffset } from './logic';

/** 画面根 = 框往上最近的 [data-stage](缩小的预览舞台自己标上)或 .vn-root */
const STAGE_SELECTOR = '[data-stage], .vn-root';

/**
 * 只糊背景的毛玻璃。对话框用 backdrop-filter 会把框后面的立绘一起糊成一团灰,
 * 改成:框里垫一张对齐好的「模糊过的背景图」+ 一层玻璃色,立绘被框整个挡住。
 *
 * 用法:框(要有 position)加 class「av-frosted」,里面第一个放 <FrostLayer src={背景图} style={useFrost(框的 ref)} />。
 * 框变大小、画面变大小时会自己重新算(ResizeObserver);框挪了位置而大小没变,调用方换一下 key 触发重算。
 */
export function useFrost(box: RefObject<HTMLElement | null>, key?: unknown): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const el = box.current;
    const stage = el?.closest<HTMLElement>(STAGE_SELECTOR);
    if (!el || !stage) return;
    const sync = () => {
      const chain: HTMLElement[] = [];
      // 框在一块整体缩放的层里(电脑上的对话区 .ga-stage,标了 data-frost-scale):层里按层自己的坐标量,
      // 层本身在画面上的位置和倍数用实际矩形算(它自己不做动画),图的大小、位置都换算回层里的坐标
      let scaled: HTMLElement | null = null;
      let n: HTMLElement | null = el;
      while (n && n !== stage) {
        if (n.hasAttribute('data-frost-scale')) {
          scaled = n;
          break;
        }
        chain.push(n);
        const p = n.offsetParent as HTMLElement | null;
        if (!p || (p !== stage && !stage.contains(p))) break;
        n = p;
      }
      const inner = frostOffset(chain);
      const root = stage.getBoundingClientRect();
      const rk = stage.offsetWidth ? root.width / stage.offsetWidth : 1;
      // 预览根也在缩放:这里只取层相对于根的倍数,避免重复计入缩略图缩放。
      const k = scaled && scaled.offsetWidth ? scaled.getBoundingClientRect().width / scaled.offsetWidth / rk : 1;
      if (!scaled || !k) {
        setStyle(frostImgStyle({ w: stage.offsetWidth, h: stage.offsetHeight }, inner));
        return;
      }
      const r = scaled.getBoundingClientRect();
      const at = { x: (r.left - root.left) / rk, y: (r.top - root.top) / rk };
      setStyle(
        frostImgStyle(
          { w: stage.offsetWidth / k, h: stage.offsetHeight / k },
          { x: inner.x + at.x / k, y: inner.y + at.y / k },
        ),
      );
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    ro.observe(stage);
    // 缩放层的倍数变了(窗口变大小)它自己的高度也跟着变,借这个重算
    const layer = el.closest<HTMLElement>('[data-frost-scale]');
    if (layer && stage.contains(layer)) ro.observe(layer);
    return () => ro.disconnect();
  }, [box, key]);
  return style;
}
