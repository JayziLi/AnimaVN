import { describe, expect, it } from 'vitest';
import { FACE_CROP, faceCrop } from './faceCrop';

/** 方框里的 <img> 按 faceCrop 摆,折回原图上看到的是哪一块(像素) */
function visible(c: { width: number; left: number; top: number }, W: number, H: number) {
  const side = (W * 100) / c.width;
  const x0 = (-c.left / 100) * side;
  const y0 = (-c.top / 100) * side;
  return { x0, y0, x1: x0 + side, y1: y0 + side, side, H };
}

describe('faceCrop', () => {
  it('frames the face (a bit below its centre, so the chin shows) in a square', () => {
    const face = { x: 0.4, y: 0.3, w: 0.2, h: 0.1 };
    const W = 1000;
    const H = 2000;
    const c = faceCrop(face, W, H);
    expect(c).not.toBeNull();
    const v = visible(c!, W, H);
    const faceH = face.h * H;
    expect(v.side).toBeCloseTo(faceH * FACE_CROP.scale);
    expect((v.x0 + v.x1) / 2).toBeCloseTo((face.x + face.w / 2) * W);
    expect((v.y0 + v.y1) / 2).toBeCloseTo((face.y + face.h * FACE_CROP.centerY) * H);
  });

  it('keeps the square inside the picture at the edges', () => {
    const W = 800;
    const H = 1600;
    const top = visible(faceCrop({ x: 0.4, y: 0, w: 0.2, h: 0.1 }, W, H)!, W, H);
    expect(top.y0).toBeCloseTo(0);
    const left = visible(faceCrop({ x: 0, y: 0.3, w: 0.2, h: 0.1 }, W, H)!, W, H);
    expect(left.x0).toBeCloseTo(0);
    const right = visible(faceCrop({ x: 0.85, y: 0.3, w: 0.15, h: 0.1 }, W, H)!, W, H);
    expect(right.x1).toBeCloseTo(W);
  });

  it('is never bigger than the short side of the picture', () => {
    const W = 600;
    const H = 900;
    const v = visible(faceCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.6 }, W, H)!, W, H);
    expect(v.side).toBeCloseTo(W);
    expect(v.x0).toBeCloseTo(0);
  });

  it('is null without a face or the picture size', () => {
    expect(faceCrop(null, 100, 100)).toBeNull();
    expect(faceCrop({ x: 0.4, y: 0.3, w: 0.2, h: 0.1 }, null, 100)).toBeNull();
    expect(faceCrop({ x: 0.4, y: 0.3, w: 0.2, h: 0.1 }, 100, 0)).toBeNull();
  });
});
