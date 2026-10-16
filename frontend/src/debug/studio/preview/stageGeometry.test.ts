import { describe, expect, it } from 'vitest';
import type { SpriteLayout } from '../../lib/api';
import { DEFAULT_SPRITE_LAYOUT, ZOOM_RANGE, type FaceBox, type SpriteStage } from '../../plugins/spriteLayout';
import {
  OFFSET_MAX,
  PHONE_ASPECT,
  focusFromDrag,
  layoutFromDrag,
  phoneCropBox,
  spriteBox,
  zoomAnchor,
  zoomFromCorner,
} from './stageGeometry';

const W = 1600;
const H = 900;

/**
 * 照 CSS 的 object-fit: cover + object-position: fx% 50% 算图摆在框里的哪儿(图的左上角和缩放后的宽高),
 * 用来对照:横屏舞台上那条竖屏框,就是手机上看得到的那段图在舞台上的位置
 */
function cover(boxW: number, boxH: number, aspect: number, fx: number) {
  const scale = Math.max(boxW / aspect, boxH); // 缩放后图的高
  const w = scale * aspect;
  const h = scale;
  return { left: (boxW - w) * (fx / 100), top: (boxH - h) / 2, w, h };
}

/** 手机竖屏(高 = 舞台高)上看得到的那段图,换算到横屏舞台上 */
function simulatedBand(aspect: number, focus: number) {
  const phoneH = 1000;
  const phoneW = phoneH * PHONE_ASPECT;
  const phone = cover(phoneW, phoneH, aspect, focus);
  // 图上的横向比例:手机框左右两边落在图的哪儿
  const u0 = -phone.left / phone.w;
  const u1 = (phoneW - phone.left) / phone.w;
  const stage = cover(W, H, aspect, focus);
  const a = Math.max(0, stage.left + u0 * stage.w);
  const b = Math.min(W, stage.left + u1 * stage.w);
  return { left: a, width: b - a };
}

describe('phoneCropBox', () => {
  it('focus 0 / 50 / 100 sits the band at the left edge / centre / right edge', () => {
    const width = H * PHONE_ASPECT;
    expect(phoneCropBox(W, H, 0).left).toBeCloseTo(0);
    expect(phoneCropBox(W, H, 0).width).toBeCloseTo(width);
    const mid = phoneCropBox(W, H, 50);
    expect(mid.left + mid.width / 2).toBeCloseTo(W / 2);
    const right = phoneCropBox(W, H, 100);
    expect(right.left + right.width).toBeCloseTo(W);
  });

  it('matches object-fit: cover on both screens for images wider and narrower than the stage', () => {
    for (const aspect of [16 / 9, 21 / 9, 3, 4 / 3, 1, 0.6]) {
      for (const focus of [0, 17, 50, 83, 100]) {
        const got = phoneCropBox(W, H, focus, PHONE_ASPECT, aspect);
        const want = simulatedBand(aspect, focus);
        expect(got.left).toBeCloseTo(want.left, 6);
        expect(got.width).toBeCloseTo(want.width, 6);
      }
    }
  });

  it('an image at least as wide as the stage gives the same band whatever its aspect', () => {
    expect(phoneCropBox(W, H, 30, PHONE_ASPECT, 3)).toEqual(phoneCropBox(W, H, 30));
  });

  it('an image narrower than the phone shows whole on the phone: the band is the whole stage', () => {
    expect(phoneCropBox(W, H, 30, PHONE_ASPECT, 0.4)).toEqual({ left: 0, width: W });
  });

  it('clamps the focus into 0–100', () => {
    expect(phoneCropBox(W, H, -20)).toEqual(phoneCropBox(W, H, 0));
    expect(phoneCropBox(W, H, 140)).toEqual(phoneCropBox(W, H, 100));
  });
});

describe('focusFromDrag', () => {
  it('dragging the band by some pixels moves it by exactly those pixels', () => {
    for (const aspect of [16 / 9, 2.4, 4 / 3]) {
      const start = 40;
      const next = focusFromDrag(start, 120, W, aspect, W / H);
      const moved = phoneCropBox(W, H, next, PHONE_ASPECT, aspect).left - phoneCropBox(W, H, start, PHONE_ASPECT, aspect).left;
      expect(moved).toBeCloseTo(120, 6);
    }
  });

  it('dragging there and back lands on the start', () => {
    const there = focusFromDrag(35, 90, W, 16 / 9, W / H);
    expect(focusFromDrag(there, -90, W, 16 / 9, W / H)).toBeCloseTo(35, 9);
  });

  it('clamps into 0–100', () => {
    expect(focusFromDrag(50, 5000, W, 16 / 9, W / H)).toBe(100);
    expect(focusFromDrag(50, -5000, W, 16 / 9, W / H)).toBe(0);
  });

  it('an image the phone shows whole has nothing to move', () => {
    expect(focusFromDrag(42, 300, W, 0.4, W / H)).toBe(42);
  });
});

describe('layoutFromDrag', () => {
  const start: SpriteLayout = { auto: true, zoom: 1.2, dx: 0.1, dy: -0.05 };

  it('converts pixels to stage heights like the plugin page does (SpritePosition)', () => {
    expect(layoutFromDrag(start, 90, -45, 900)).toEqual({ auto: true, zoom: 1.2, dx: 0.2, dy: -0.1 });
  });

  it('dragging there and back lands on the start', () => {
    const there = layoutFromDrag(start, 137, 59, 720);
    expect(layoutFromDrag(there, -137, -59, 720)).toEqual(start);
  });

  it('clamps the offsets to what the backend keeps (±2 stage heights)', () => {
    const far = layoutFromDrag(DEFAULT_SPRITE_LAYOUT, 99999, -99999, 500);
    expect(far.dx).toBe(OFFSET_MAX);
    expect(far.dy).toBe(-OFFSET_MAX);
  });

  it('a stage without height changes nothing', () => {
    expect(layoutFromDrag(start, 50, 50, 0)).toEqual(start);
  });
});

describe('zoomFromCorner', () => {
  it('scales the zoom by how much farther the pointer is from the anchor', () => {
    expect(zoomFromCorner({ ...DEFAULT_SPRITE_LAYOUT, zoom: 1.2 }, 100, 125).zoom).toBeCloseTo(1.5);
    expect(zoomFromCorner(DEFAULT_SPRITE_LAYOUT, 200, 150)).toEqual({ ...DEFAULT_SPRITE_LAYOUT, zoom: 0.75 });
  });

  it('clamps into ZOOM_RANGE', () => {
    expect(zoomFromCorner(DEFAULT_SPRITE_LAYOUT, 100, 1000).zoom).toBe(ZOOM_RANGE.max);
    expect(zoomFromCorner(DEFAULT_SPRITE_LAYOUT, 100, 1).zoom).toBe(ZOOM_RANGE.min);
  });

  it('a start right on the anchor changes nothing', () => {
    expect(zoomFromCorner(DEFAULT_SPRITE_LAYOUT, 0, 50)).toEqual(DEFAULT_SPRITE_LAYOUT);
  });
});

describe('spriteBox / zoomAnchor (same placement as spriteStyle)', () => {
  const stage: SpriteStage = { faceSize: 0.2, faceTop: 0.12 };
  const face: FaceBox = { x: 0.2674, y: 0.1104, w: 0.3671, h: 0.2373 };
  const boxW = 800;
  const boxH = 420;
  const aspect = 711 / 1100;

  it('face-aligned: the face is faceSize × zoom tall, its top edge at faceTop + dy, centred on the midline + dx', () => {
    const layout: SpriteLayout = { auto: true, zoom: 1.3, dx: 0.2, dy: 0.05 };
    const b = spriteBox(face, layout, stage, boxW, boxH, aspect);
    expect(b.height * face.h).toBeCloseTo(stage.faceSize * layout.zoom * boxH, 6);
    expect(b.width).toBeCloseTo(b.height * aspect, 6);
    expect(b.top + face.y * b.height).toBeCloseTo((stage.faceTop + layout.dy) * boxH, 6);
    expect(b.left + (face.x + face.w / 2) * b.width).toBeCloseTo(boxW / 2 + layout.dx * boxH, 6);
    expect(zoomAnchor(face, layout, stage, boxW, boxH)).toEqual({
      x: boxW / 2 + layout.dx * boxH,
      y: (stage.faceTop + layout.dy) * boxH,
    });
  });

  it('zooming keeps the anchor (top centre of the face) where it is', () => {
    const a: SpriteLayout = { auto: true, zoom: 1, dx: -0.1, dy: 0 };
    const b: SpriteLayout = { ...a, zoom: 1.6 };
    const pa = spriteBox(face, a, stage, boxW, boxH, aspect);
    const pb = spriteBox(face, b, stage, boxW, boxH, aspect);
    expect(pa.top + face.y * pa.height).toBeCloseTo(pb.top + face.y * pb.height, 6);
    expect(pa.left + (face.x + face.w / 2) * pa.width).toBeCloseTo(pb.left + (face.x + face.w / 2) * pb.width, 6);
  });

  it('no face, or auto off: full height × zoom, bottom on the floor (moved by dy), centred on the midline + dx', () => {
    const layout: SpriteLayout = { auto: false, zoom: 0.8, dx: 0.1, dy: -0.2 };
    for (const f of [null, face]) {
      const b = spriteBox(f, layout, stage, boxW, boxH, aspect);
      expect(b.height).toBeCloseTo(layout.zoom * boxH, 6);
      expect(b.top + b.height).toBeCloseTo(boxH + layout.dy * boxH, 6);
      expect(b.left + b.width / 2).toBeCloseTo(boxW / 2 + layout.dx * boxH, 6);
      expect(zoomAnchor(f, layout, stage, boxW, boxH)).toEqual({
        x: boxW / 2 + layout.dx * boxH,
        y: boxH + layout.dy * boxH,
      });
    }
  });
});
