/**
 * 表情差分的小头像:整张立绘按脸框裁成方块(faceCrop.ts),网格(56)、右栏头(52)、包页签(32)、
 * 「从素材库选」(40)都用它,大小由外面的类名定。没认出脸的对着图的上半截;没图画个人形图标。
 */

import { spriteImageUrl, type PackSprite } from '../lib/api';
import type { FaceBox } from '../plugins/spriteLayout';
import { faceCrop } from './faceCrop';
import { Icon } from './icons';

export function FaceThumb({
  sprite,
  face,
  className,
  src,
}: {
  sprite: PackSprite | null;
  /** facesByCanvas 给的脸框(同一张画布的差分共用);null = 没认出 */
  face: FaceBox | null;
  className?: string;
  /** 换个地址(上传中的本地预览);不给用 sprite 的图 */
  src?: string | null;
}) {
  const url = src ?? (sprite ? spriteImageUrl(sprite) : null);
  const crop = faceCrop(face, sprite?.face_scan?.width ?? null, sprite?.face_scan?.height ?? null);
  const cls = `st-face${className ? ` ${className}` : ''}`;
  if (!url) {
    return (
      <span className={`${cls} blank`} aria-hidden="true">
        <Icon name="person" size={18} />
      </span>
    );
  }
  return (
    <span className={cls} aria-hidden="true">
      <img
        src={url}
        alt=""
        draggable={false}
        loading="lazy"
        className={crop ? 'cropped' : 'top'}
        style={crop ? { width: `${crop.width}%`, left: `${crop.left}%`, top: `${crop.top}%` } : undefined}
      />
    </span>
  );
}
