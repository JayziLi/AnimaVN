/**
 * 卡编辑器「实机预览」舞台上的几何换算:手机竖屏会裁到背景的哪一段、拖动立绘 / 拖四角 / 拖竖屏框换成多少。
 *
 * 全部照游戏里的算法(不另起一套):
 *   背景、CG 是 object-fit: cover + object-position: 焦点% 50%(vn.css 的 .vn-bg、.vn-cg)
 *   立绘按脸对齐,单位是立绘舞台的高度(plugins/spriteLayout.ts 的 spriteStyle;舞台 = vn.css 的 .vn-sprite-stage)
 *   拖动的换算和插件页的位置预览一样(components/SpritePosition.tsx):挪的像素 ÷ 立绘舞台的高
 */

import type { SpriteLayout } from '../../lib/api';
import { ZOOM_RANGE, type FaceBox, type SpriteStage } from '../../plugins/spriteLayout';

/** 手机竖屏的宽高比(和画布、插件页的竖屏预览一样按 9 : 19.5 算) */
export const PHONE_ASPECT = 9 / 19.5;

/** 横屏舞台的宽高比 */
export const WIDE_ASPECT = 16 / 9;

/** 和 vn.css 的 --vn-sprite-top 一致:立绘舞台从屏幕多高的地方开始(电脑横屏 7%、手机竖屏 11%) */
export const SPRITE_TOP = { wide: 0.07, tall: 0.11 } as const;

/** 和后端 SpriteLayoutUpdate 的范围一致:偏移最多挪两个舞台高 */
export const OFFSET_MAX = 2;

const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const clampOffset = (v: number) => round(clamp(v, -OFFSET_MAX, OFFSET_MAX));

/** 竖屏框能左右挪多远(焦点 0 → 100 走过的像素);0 = 手机上整张图都看得到,没得挪 */
function cropTravel(stageW: number, stageH: number, phoneAspect: number, imageAspect?: number): number {
  const stageAspect = stageW / stageH;
  // 图至少和舞台一样宽:舞台和手机都是图的高撑满,竖屏框宽 = 舞台高 × 手机宽高比,和图多宽无关
  if (imageAspect === undefined || imageAspect >= stageAspect) return Math.max(0, stageW - stageH * phoneAspect);
  // 图比舞台窄(上下被裁)、比手机宽:舞台上图的宽撑满,手机上看到图的 phoneAspect / imageAspect 那么宽
  if (imageAspect > phoneAspect) return stageW * (1 - phoneAspect / imageAspect);
  return 0;
}

/**
 * 手机竖屏只看得到背景的哪一段,画在横屏舞台上是从 left 起、宽 width 的一条(像素)。
 * 和两边都按 object-fit: cover、object-position: 焦点% 50% 摆出来的一致。
 * imageAspect 不给 = 图至少和舞台一样宽(常见的横图);图比舞台窄时按图的真实比例算
 */
export function phoneCropBox(
  stageW: number,
  stageH: number,
  focusX: number,
  phoneAspect = PHONE_ASPECT,
  imageAspect?: number,
): { left: number; width: number } {
  const travel = cropTravel(stageW, stageH, phoneAspect, imageAspect);
  const stageAspect = stageW / stageH;
  const width =
    imageAspect === undefined || imageAspect >= stageAspect
      ? stageH * phoneAspect
      : imageAspect > phoneAspect
        ? stageW * (phoneAspect / imageAspect)
        : stageW;
  return { left: travel * (clamp(focusX, 0, 100) / 100), width };
}

/** 拖竖屏框:框跟着手走 dxPx 像素,换算成新的焦点(0–100) */
export function focusFromDrag(
  startFocus: number,
  dxPx: number,
  stageW: number,
  imageAspect: number,
  stageAspect: number,
  phoneAspect = PHONE_ASPECT,
): number {
  const travel = cropTravel(stageW, stageW / stageAspect, phoneAspect, imageAspect);
  if (travel <= 0) return startFocus;
  return clamp(startFocus + (dxPx / travel) * 100, 0, 100);
}

/** 拖立绘:挪的像素按立绘舞台(.vn-sprite-stage,cqh 的那个盒子)的高折算成偏移,和插件页一样,夹在 ±2 */
export function layoutFromDrag(start: SpriteLayout, dxPx: number, dyPx: number, stageH: number): SpriteLayout {
  if (!(stageH > 0)) return start;
  return { ...start, dx: clampOffset(start.dx + dxPx / stageH), dy: clampOffset(start.dy + dyPx / stageH) };
}

/** 拖四角缩放:手离缩放中心(zoomAnchor)远了几倍,缩放就乘几倍,夹在 ZOOM_RANGE */
export function zoomFromCorner(start: SpriteLayout, distStart: number, distNow: number): SpriteLayout {
  if (!(distStart > 0)) return start;
  return { ...start, zoom: round(clamp(start.zoom * (distNow / distStart), ZOOM_RANGE.min, ZOOM_RANGE.max)) };
}

/**
 * 立绘整张图在立绘舞台里的位置(像素,相对舞台左上角),和 spriteStyle 摆出来的一样。
 * 选中框、四角把手画在这上面。imageAspect = 图的宽 / 高
 */
export function spriteBox(
  face: FaceBox | null,
  layout: SpriteLayout,
  stage: SpriteStage,
  boxW: number,
  boxH: number,
  imageAspect: number,
): { left: number; top: number; width: number; height: number } {
  const cx = boxW / 2 + layout.dx * boxH;
  if (face && layout.auto) {
    // 脸高 = faceSize × zoom 个舞台高;脸的上沿对到 faceTop + dy,脸的中线对到舞台中线 + dx
    const height = (stage.faceSize / face.h) * layout.zoom * boxH;
    const width = height * imageAspect;
    return {
      left: cx - (face.x + face.w / 2) * width,
      top: (stage.faceTop + layout.dy) * boxH - face.y * height,
      width,
      height,
    };
  }
  // 老办法:撑满舞台高 × zoom、底边对齐(dy 往下挪)、居中
  const height = layout.zoom * boxH;
  const width = height * imageAspect;
  return { left: cx - width / 2, top: boxH + layout.dy * boxH - height, width, height };
}

/** 放大缩小时不动的那个点:按脸对齐时是脸的上沿中点,老办法是底边中点 */
export function zoomAnchor(
  face: FaceBox | null,
  layout: SpriteLayout,
  stage: SpriteStage,
  boxW: number,
  boxH: number,
): { x: number; y: number } {
  const x = boxW / 2 + layout.dx * boxH;
  return face && layout.auto ? { x, y: (stage.faceTop + layout.dy) * boxH } : { x, y: boxH + layout.dy * boxH };
}
