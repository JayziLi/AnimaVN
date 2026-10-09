/**
 * 立绘在视觉小说舞台上怎么摆 —— 按脸对齐:每个角色的脸一样大、脸的上沿在同一高度、
 * 脸对准舞台中线。不同来源的立绘画布、留白、裁到哪儿都不一样,撑满高度摆的话,
 * 只画到大腿的角色脸会比全身像大一倍。
 *
 * 三层叠起来:
 *   全局(所有角色共用,存在 app_settings 的 plugin.sprite_stage):脸多大、头多高
 *   自动:后端找到的脸(PackSprite.face_scan,见 AnimaBackend/app/sprite_faces.py)
 *   每张卡的微调(CardSpriteLayout):再放大缩小、挪一挪,或者关掉自动
 * 找不到脸或关了自动的,按老办法摆:撑满舞台高度、底边对齐、居中,微调照样生效。
 *
 * 单位都是舞台高度 —— 舞台上设了 container-type: size,样式里用 cqh。所以电脑横屏和
 * 手机竖屏的构图一样,只是竖屏两边裁得多。
 */

import type { CSSProperties } from 'react';
import type { PackSprite, SpriteLayout } from '../lib/api';

export const SPRITE_STAGE_KEY = 'plugin.sprite_stage';

/** 所有角色共用的构图,都以舞台高度为单位 */
export interface SpriteStage {
  /** 脸的高度 */
  faceSize: number;
  /** 脸的上沿离舞台顶多远 */
  faceTop: number;
}

export const DEFAULT_SPRITE_STAGE: SpriteStage = { faceSize: 0.21, faceTop: 0.12 };
export const FACE_SIZE_RANGE = { min: 0.1, max: 0.4 };
export const FACE_TOP_RANGE = { min: 0, max: 0.35 };

export const DEFAULT_SPRITE_LAYOUT: SpriteLayout = { auto: true, zoom: 1, dx: 0, dy: 0 };
export const ZOOM_RANGE = { min: 0.5, max: 2 };

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function normalizeSpriteStage(raw: unknown): SpriteStage {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SPRITE_STAGE;
  return {
    faceSize: clamp(r.faceSize, FACE_SIZE_RANGE.min, FACE_SIZE_RANGE.max, d.faceSize),
    faceTop: clamp(r.faceTop, FACE_TOP_RANGE.min, FACE_TOP_RANGE.max, d.faceTop),
  };
}

/** 脸框,占整张图的比例 */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const median = (xs: number[]) => {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * 每张立绘用哪个脸框。同一张画布(宽 × 高一样)的表情共用一个:各张的识别结果取中位数。
 * 每张用自己的框的话,识别差几个像素,换表情时人就会抖一下;个别没认出脸的表情也能跟着用。
 */
export function facesByCanvas(sprites: readonly PackSprite[]): Map<string, FaceBox> {
  const canvasOf = (s: PackSprite) =>
    s.face_scan?.width && s.face_scan.height ? `${s.face_scan.width}x${s.face_scan.height}` : null;
  const found = new Map<string, FaceBox[]>();
  for (const s of sprites) {
    const canvas = canvasOf(s);
    const face = s.face_scan?.face;
    if (canvas && face) found.set(canvas, [...(found.get(canvas) ?? []), face]);
  }
  const shared = new Map<string, FaceBox>();
  for (const [canvas, faces] of found) {
    shared.set(canvas, {
      x: median(faces.map((f) => f.x)),
      y: median(faces.map((f) => f.y)),
      w: median(faces.map((f) => f.w)),
      h: median(faces.map((f) => f.h)),
    });
  }
  const out = new Map<string, FaceBox>();
  for (const s of sprites) {
    const canvas = canvasOf(s);
    const face = canvas ? shared.get(canvas) : undefined;
    if (face) out.set(s.id, face);
  }
  return out;
}

/**
 * 立绘 <img> 的行内样式(盖掉 CSS 里撑满高度、居中的默认摆法)。
 * 百分比的 translate 是相对图自己的尺寸,所以不用知道图的宽高比就能把脸对到指定位置。
 */
export function spriteStyle(
  face: FaceBox | null,
  layout: SpriteLayout,
  stage: SpriteStage,
): CSSProperties {
  const left = `calc(50% + ${layout.dx * 100}cqh)`;
  if (face && layout.auto) {
    const height = (stage.faceSize / face.h) * layout.zoom;
    return {
      height: `${height * 100}cqh`,
      left,
      top: `${(stage.faceTop + layout.dy) * 100}cqh`,
      bottom: 'auto',
      transform: `translate(${-(face.x + face.w / 2) * 100}%, ${-face.y * 100}%)`,
    };
  }
  // 老办法:底边对齐、居中,放大缩小以底边中点为准
  return {
    height: `${layout.zoom * 100}cqh`,
    left,
    bottom: `${-layout.dy * 100}cqh`,
    transform: 'translateX(-50%)',
  };
}

/**
 * 立绘切换特效的头顶气泡摆在哪:脸的右上方,大小跟着脸走。和 spriteStyle 同一套单位(cqh)。
 * 没认出脸的立绘按「撑满高度的全身像、头在上面 12% 左右」估一个位置
 */
export function bubbleStyle(face: FaceBox | null, layout: SpriteLayout, stage: SpriteStage): CSSProperties {
  const cx = 50; // 舞台中线(%),dx 另外按 cqh 加
  if (face && layout.auto) {
    const faceH = stage.faceSize * layout.zoom;
    const size = faceH * 0.62;
    return {
      left: `calc(${cx}% + ${(layout.dx + faceH * 0.42) * 100}cqh)`,
      top: `${(stage.faceTop + layout.dy - faceH * 0.38) * 100}cqh`,
      width: `${size * 100}cqh`,
      height: `${size * 100}cqh`,
    };
  }
  const size = 0.13 * layout.zoom;
  return {
    left: `calc(${cx}% + ${(layout.dx + 0.08 * layout.zoom) * 100}cqh)`,
    top: `${(1 - layout.zoom + layout.dy + 0.02) * 100}cqh`,
    width: `${size * 100}cqh`,
    height: `${size * 100}cqh`,
  };
}
