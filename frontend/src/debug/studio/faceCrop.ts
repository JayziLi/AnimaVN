/**
 * 表情差分的小头像:从整张立绘里裁出脸那一块(方的),网格、页签、右栏头都用它。
 * 后端只存了整张图和脸框(PackSprite.face_scan),小头像在前端用 CSS 摆出来:
 * 一个方框、overflow: hidden,里面的 <img> 按这里算的百分比放大、挪位。
 */

import type { FaceBox } from '../plugins/spriteLayout';

export const FACE_CROP = {
  /** 方框边长 = 脸高的几倍(连头发和一点肩膀) */
  scale: 2.1,
  /** 方框中心在脸框里的高度:比脸的中线低一点,下巴和脖子露出来 */
  centerY: 0.62,
};

/** <img> 在方框里的位置,都是方框边长的百分比(方框是正方形,top 的百分比也按边长算) */
export interface FaceCropBox {
  width: number;
  left: number;
  top: number;
}

/**
 * 脸框(占整张图的比例)+ 原图宽高 → <img> 的摆法。方框不出图的边;脸太大时边长不超过图的短边。
 * 没认出脸、不知道原图多大时是 null(用的地方退回「对着图的上半截」)
 */
export function faceCrop(face: FaceBox | null, width: number | null, height: number | null): FaceCropBox | null {
  if (!face || !width || !height || width <= 0 || height <= 0) return null;
  const side = Math.min(face.h * height * FACE_CROP.scale, width, height);
  const cx = (face.x + face.w / 2) * width;
  const cy = (face.y + face.h * FACE_CROP.centerY) * height;
  const x0 = Math.min(Math.max(cx - side / 2, 0), width - side);
  const y0 = Math.min(Math.max(cy - side / 2, 0), height - side);
  return {
    width: (width / side) * 100,
    left: (-x0 / side) * 100,
    top: (-y0 / side) * 100,
  };
}
