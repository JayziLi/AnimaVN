/**
 * 卡编辑器的「实机预览」舞台:背景 + 立绘 + CG + 对话框,摆法和游戏里一模一样。
 *
 *   背景   vn.css 的 .vn-bg(object-fit: cover,焦点 = object-position 的横向)
 *   立绘   vn.css 的 .vn-sprite-stage / .vn-sprite / .vn-sprite-fx 原样用,位置用 spriteStyle(按脸对齐,单位 cqh);
 *          立绘舞台的上沿 --vn-sprite-top 照游戏:横屏 7%、竖屏 11%
 *   特效   playKey 变了放一次:动作(MOTION_FRAMES)、漫符(SpriteBubble + bubbleStyle)、音效(playFxSound);
 *          有 CG 盖着立绘时不放(和游戏里 fxStep 的规则一样)
 *   CG     cover = 导入的 CG(裁满,焦点);above / screen = 生成的插图整张显示(对话框上面那块 / 铺满),
 *          垫一层模糊放大的同一张(照 vn.css 的 .vn-cg、.vn-cg.whole、.vn-cg-backdrop);有 CG 时立绘层透明
 *   对话框 照画布第四版的样子(半透明、名字、台词),按舞台宽度缩放
 *
 * 可以改的东西(editable):
 *   sprite  画虚线框和四角把手:拖动 = 改偏移、拖四角 = 缩放(换算见 stageGeometry.ts,和插件页的位置预览一样)
 *   focus   画竖屏会裁出来的那一条、两边压暗:左右拖 = 改焦点(CG 在就改 CG 的,否则改背景的)
 * 拖动时 onLayout / onFocus 一直报(commit = false),松手再报一次 commit = true;方向键也能挪(每下都是 commit)。
 *
 * 舞台撑满所在那一栏的宽、16:9,高最多 --st-stage-max-h(默认给下面的网格留出地方)。
 * 左上角「实机预览」小牌子;badges 放右上角(背景下拉、开关这类),overlays 是随便摆的一层(比如左下角的 BGM 播放条)。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import type { SpriteEffect, SpriteLayout } from '../../lib/api';
import { FX_BUBBLES, FX_MOTIONS, FX_SOUNDS, MOTION_FRAMES, normalizeEffect, playFxSound } from '../../plugins/spriteFx';
import { bubbleStyle, spriteStyle, type FaceBox, type SpriteStage } from '../../plugins/spriteLayout';
import { SpriteBubble } from '../../vn/SpriteBubble';
import { loadVNSettings } from '../../vn/vnSettings';
import { Icon } from '../icons';
import { studioSoundName } from '../terms';
import {
  PHONE_ASPECT,
  SPRITE_TOP,
  focusFromDrag,
  layoutFromDrag,
  phoneCropBox,
  spriteBox,
  zoomAnchor,
  zoomFromCorner,
} from './stageGeometry';
// 立绘舞台、漫符的样式和动画在 vn.css 里(视觉小说一直挂着它;这里再引一次,免得以后它改成按需加载)
import '../../vn/vn.css';
import './stagePreview.css';

export type StageCgMode = 'cover' | 'above' | 'screen';

export interface StagePreviewSprite {
  src: string;
  /** 这张图的脸框(facesByCanvas 给的,同一张画布的差分共用);null = 没认出脸,按撑满高度摆 */
  face: FaceBox | null;
  /** 这套立绘的摆法(缩放、偏移、按脸对齐开关) */
  layout: SpriteLayout;
  /** 所有角色共用的构图(脸多大、头多高) */
  stage: SpriteStage;
  /** 入场动效;playKey 变了放一次 */
  effect?: SpriteEffect | null;
  playKey?: number;
}

export interface StagePreviewProps {
  /** wide = 电脑横屏 16:9;tall = 手机竖屏 */
  aspect?: 'wide' | 'tall';
  /** focus:竖屏时对准横图的哪儿(0 最左、100 最右) */
  background: { src: string; focus: number } | null;
  sprite?: StagePreviewSprite | null;
  /** cover = 导入的 CG;above = 生成的插图放在对话框上面那块;screen = 生成的插图铺满屏幕 */
  cg?: { src: string; focus: number; mode: StageCgMode } | null;
  /** 对话框;narration = 旁白(名字那行淡一点) */
  line?: { speaker: string; text: string; narration?: boolean } | null;
  editable?: 'sprite' | 'focus' | null;
  onLayout?: (next: SpriteLayout, commit: boolean) => void;
  onFocus?: (next: number, commit: boolean) => void;
  /** 随便摆的一层(子元素自己 position: absolute) */
  overlays?: ReactNode;
  /** 右上角那一排(背景下拉、开关) */
  badges?: ReactNode;
  className?: string;
}

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 竖长的 CG 上下来回移一趟几秒(和游戏里一样) */
const CG_PAN_MS = 20000;
/** 漫符停多久(和游戏里一样) */
const FX_SHOW_MS = 1500;
/** 提示条离选中框、竖屏框多远;离舞台边至少多远 */
const HINT_GAP = 12;
const EDGE = 14;
/** 提示条放在框旁边时离舞台边至少多远、实在放不下时离框多近(画布上竖屏框在正中间时,右边那条几乎贴着舞台边) */
const HINT_EDGE = 6;
const HINT_GAP_TIGHT = 6;
/** 舞台比这窄就不出提示条(会挡住脸;虚线框和把手自己看得懂) */
const HINT_STAGE_MIN = 480;
/** 提示条大概多宽:12px 的汉字一个约 12px、空格和点约 4.5px,加上图标和内边距 */
const hintWidth = (text: string) => [...text].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 12 : 4.5), 44);

/** 量出来的舞台尺寸(像素):整块、立绘舞台(cqh 那个盒子)、对话框上沿 */
interface Geo {
  w: number;
  h: number;
  boxTop: number;
  boxH: number;
  /** 对话框上沿;没有对话框 = h */
  lineTop: number;
}

type Drag =
  | { kind: 'move'; x: number; y: number; start: SpriteLayout; last: SpriteLayout | null }
  | { kind: 'zoom'; ax: number; ay: number; dist: number; start: SpriteLayout; last: SpriteLayout | null }
  | { kind: 'focus'; x: number; start: number; last: number | null };

const nameOf = (list: { id: string; name: string }[], id: string | null) => list.find((o) => o.id === id)?.name ?? null;

/** 「预览中:跳一下 · ！？ · 漫符音 · ！？」 */
function fxLabel(fx: SpriteEffect): string {
  const sound = nameOf(FX_SOUNDS, fx.sound);
  return [nameOf(FX_MOTIONS, fx.motion), nameOf(FX_BUBBLES, fx.bubble), sound && studioSoundName(sound)]
    .filter(Boolean)
    .join(' · ');
}

const ratioOf = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  return img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null;
};

export function StagePreview({
  aspect = 'wide',
  background,
  sprite,
  cg,
  line,
  editable,
  onLayout,
  onFocus,
  overlays,
  badges,
  className,
}: StagePreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  // 图读进来以后才知道宽高比(选中框、竖屏框要用);按地址记
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const keepRatio = (src: string) => (e: SyntheticEvent<HTMLImageElement>) => {
    const r = ratioOf(e);
    if (r !== null) setRatios((m) => (m[src] === r ? m : { ...m, [src]: r }));
  };

  // ---- 量尺寸:舞台跟着栏宽缩放,对话框有没有也会变 ----
  const measure = useCallback(() => {
    const root = rootRef.current;
    const box = boxRef.current;
    if (!root || !box) return;
    const r = root.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const l = lineRef.current?.getBoundingClientRect();
    const next: Geo = { w: r.width, h: r.height, boxTop: b.top - r.top, boxH: b.height, lineTop: l ? l.top - r.top : r.height };
    setGeo((g) =>
      g && g.w === next.w && g.h === next.h && g.boxTop === next.boxTop && g.boxH === next.boxH && g.lineTop === next.lineTop
        ? g
        : next,
    );
  }, []);
  // 对话框是定高的,只看有没有(拖动时台词对象每次都是新的,别跟着它每帧重量)
  const hasLine = Boolean(line);
  useLayoutEffect(() => {
    measure();
  }, [measure, aspect, hasLine]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  // ---- 入场动效:playKey 变了放一次(第一次挂上不放) ----
  const covered = Boolean(cg);
  const [playing, setPlaying] = useState<{ key: number; effect: SpriteEffect; bubbleAt: CSSProperties } | null>(null);
  const lastKey = useRef(sprite?.playKey);
  const playKey = sprite?.playKey;
  // 放的时候用最新的那张(位置、脸框);不让它进下面 effect 的依赖,免得拖动时也重跑
  const fxSource = useRef(sprite);
  useEffect(() => {
    fxSource.current = sprite;
  });
  useEffect(() => {
    if (playKey === undefined || playKey === lastKey.current) return;
    lastKey.current = playKey;
    const s = fxSource.current;
    const fx = normalizeEffect(s?.effect);
    // 有 CG 盖着立绘时看不见,游戏里也不放
    if (!s || !fx || covered) return;
    setPlaying({ key: playKey, effect: fx, bubbleAt: bubbleStyle(s.face, s.layout, s.stage) });
    playFxSound(fx.sound, loadVNSettings().spriteFxVolume);
    const motion = fx.motion ? MOTION_FRAMES[fx.motion] : undefined;
    if (motion && !reduceMotion) fxRef.current?.animate(motion.frames, motion.timing);
  }, [playKey, covered]);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setPlaying(null), FX_SHOW_MS);
    return () => window.clearTimeout(t);
  }, [playing]);

  // ---- 能改什么 ----
  const editSprite = editable === 'sprite' && sprite ? sprite : null;
  // 改焦点改的是 CG(在的话)还是背景;整张显示的 CG 不裁,没有竖屏框
  const focusTarget = editable === 'focus' ? (cg ? (cg.mode === 'cover' ? cg : null) : background) : null;
  const spriteRatio = editSprite ? ratios[editSprite.src] : undefined;
  const focusRatio = focusTarget ? ratios[focusTarget.src] : undefined;

  const selection =
    geo && editSprite && spriteRatio
      ? (() => {
          const s = spriteBox(editSprite.face, editSprite.layout, editSprite.stage, geo.w, geo.boxH, spriteRatio);
          // 换到整块舞台的坐标;上下裁到看得见的地方(底下到对话框为止,四角把手才点得到),左右留一点余量
          const top = geo.boxTop + s.top;
          const x0 = Math.max(2, s.left - 6);
          const x1 = Math.min(geo.w - 2, s.left + s.width + 6);
          const y0 = Math.max(top, 0) + 6;
          const y1 = Math.min(top + s.height, geo.lineTop) - 2;
          return x1 - x0 > 8 && y1 - y0 > 8 ? { x0, x1, y0, y1 } : null;
        })()
      : null;
  const band =
    geo && focusTarget ? phoneCropBox(geo.w, geo.h, focusTarget.focus, PHONE_ASPECT, focusRatio) : null;

  // ---- 拖动 ----
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  // 把手按下时抓的是把手本身,移动、松手照样冒泡到下面那层的处理函数(只挂一份)
  const startDrag = (e: PointerEvent<HTMLElement>, d: Drag) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // 拦掉了默认动作,焦点得自己挪过来(之后能接着用方向键)
    surfaceRef.current?.focus({ preventScroll: true });
    drag.current = d;
    setDragging(true);
  };

  const onSurfaceDown = (e: PointerEvent<HTMLDivElement>) => {
    if (editSprite && onLayout && geo) {
      startDrag(e, { kind: 'move', x: e.clientX, y: e.clientY, start: editSprite.layout, last: null });
    } else if (focusTarget && onFocus && geo) {
      startDrag(e, { kind: 'focus', x: e.clientX, start: focusTarget.focus, last: null });
    }
  };

  const onCornerDown = (e: PointerEvent<HTMLSpanElement>) => {
    const root = rootRef.current;
    if (!editSprite || !onLayout || !geo || !root) return;
    const r = root.getBoundingClientRect();
    const a = zoomAnchor(editSprite.face, editSprite.layout, editSprite.stage, geo.w, geo.boxH);
    const ax = r.left + a.x;
    const ay = r.top + geo.boxTop + a.y;
    startDrag(e, {
      kind: 'zoom',
      ax,
      ay,
      dist: Math.hypot(e.clientX - ax, e.clientY - ay),
      start: editSprite.layout,
      last: null,
    });
  };

  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !geo) return;
    if (d.kind === 'move') {
      d.last = layoutFromDrag(d.start, e.clientX - d.x, e.clientY - d.y, geo.boxH);
      onLayout?.(d.last, false);
    } else if (d.kind === 'zoom') {
      d.last = zoomFromCorner(d.start, d.dist, Math.hypot(e.clientX - d.ax, e.clientY - d.ay));
      onLayout?.(d.last, false);
    } else {
      d.last = focusFromDrag(d.start, e.clientX - d.x, geo.w, focusRatio ?? geo.w / geo.h, geo.w / geo.h);
      onFocus?.(d.last, false);
    }
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d || d.last === null) return;
    if (d.kind === 'focus') onFocus?.(d.last, true);
    else onLayout?.(d.last, true);
  };

  // 方向键:立绘每下挪 1%(按住 Shift 5%),+ / − 缩放;竖屏框每下 1(Shift 5)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (editSprite && onLayout) {
      const l = editSprite.layout;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        onLayout(layoutFromDrag(l, m[0] * step, m[1] * step, 100), true);
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        e.preventDefault();
        const k = e.key === '-' ? 1 / 1.05 : 1.05;
        onLayout(zoomFromCorner(l, 1, k), true);
      }
    } else if (focusTarget && onFocus && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const next = Math.min(100, Math.max(0, focusTarget.focus + (e.key === 'ArrowLeft' ? -step : step)));
      onFocus(next, true);
    }
  };

  // ---- 提示条摆在框的哪一边 ----
  // 宽度先按字数估,画出来以后按真实宽度再摆一次(估的偏宽几个像素,竖屏框在正中间时右边会差一点放不下)
  const hintRef = useRef<HTMLDivElement>(null);
  const [hintSizes, setHintSizes] = useState<Record<string, number>>({});
  const hint = (() => {
    if (!geo || dragging || playing || geo.w < HINT_STAGE_MIN) return null;
    const box = selection
      ? { x0: selection.x0, x1: selection.x1, top: Math.max(selection.y0 + 2, 56) }
      : band
        ? { x0: band.left, x1: band.left + band.width, top: 60 }
        : null;
    if (!box) return null;
    const text = selection ? '拖动调整站位 · 拖动四角缩放' : '手机竖屏只显示虚线里这块 · 左右拖动改焦点';
    // 先放框的右边(和画布一样),放不下就左边,再不行贴近一点框试一次;两边都放不下(框很宽)就放在对话框上面居中,
    // 别挡脸;没有对话框(背景栏)时放在上面居中:左下角常有播放条(overlays),放底下会挤在一起
    const need = hintSizes[text] ?? hintWidth(text);
    const beside = (gap: number): CSSProperties | null =>
      geo.w - box.x1 - gap - HINT_EDGE >= need
        ? { left: box.x1 + gap, top: box.top }
        : box.x0 - gap - HINT_EDGE >= need
          ? { right: geo.w - box.x0 + gap, top: box.top }
          : null;
    const style: CSSProperties =
      beside(HINT_GAP) ??
      beside(HINT_GAP_TIGHT) ??
      (hasLine
        ? {
            left: '50%',
            bottom: geo.h - Math.min(geo.lineTop, geo.h - EDGE) + HINT_GAP,
            transform: 'translateX(-50%)',
            maxWidth: geo.w - 2 * EDGE,
          }
        : { left: '50%', top: box.top, transform: 'translateX(-50%)', maxWidth: geo.w - 2 * EDGE });
    return { style, text };
  })();
  // 宽度和摆在哪无关,换了字(第一次出现)量一次就够
  const hintText = hint?.text;
  useLayoutEffect(() => {
    const w = hintRef.current?.offsetWidth;
    if (hintText && w && hintSizes[hintText] !== w) setHintSizes((m) => ({ ...m, [hintText]: w }));
  }, [hintText, hintSizes]);

  const surfaceActive = Boolean((editSprite && onLayout) || (focusTarget && onFocus));
  const classes = ['st-stage', aspect, cg ? 'cg-on' : '', line ? 'has-line' : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={classes}
      style={{ '--vn-sprite-top': `${SPRITE_TOP[aspect] * 100}%` } as CSSProperties}
      role="region"
      aria-label="实机预览"
    >
      {background && (
        <img
          className="vn-bg"
          src={background.src}
          alt=""
          draggable={false}
          style={{ objectPosition: `${background.focus}% 50%` }}
          onLoad={keepRatio(background.src)}
        />
      )}

      {/* 和游戏里同一套:立绘舞台(cqh 的盒子)→ 动作层 → 立绘 + 漫符 */}
      <div ref={boxRef} className="vn-sprite-stage" aria-hidden="true">
        {sprite && (
          <div ref={fxRef} className="vn-sprite-fx">
            <img
              className="vn-sprite"
              src={sprite.src}
              alt=""
              draggable={false}
              style={spriteStyle(sprite.face, sprite.layout, sprite.stage)}
              onLoad={keepRatio(sprite.src)}
            />
            {playing?.effect.bubble && <SpriteBubble key={playing.key} kind={playing.effect.bubble} style={playing.bubbleAt} />}
          </div>
        )}
      </div>

      {cg && <CgLayer cg={cg} onRatio={keepRatio(cg.src)} ratio={ratios[cg.src]} />}

      {line && (
        <div ref={lineRef} className="st-stage-line">
          <div className={`st-stage-speaker${line.narration ? ' narration' : ''}`}>{line.speaker}</div>
          <div className="st-stage-text">{line.text}</div>
        </div>
      )}

      {band && geo && (
        <div className="st-stage-crop" aria-hidden="true">
          <div className="st-stage-dim" style={{ left: 0, width: band.left }} />
          <div className="st-stage-dim" style={{ left: band.left + band.width, right: 0 }} />
          <div className="st-stage-band" style={{ left: band.left, width: band.width }} />
        </div>
      )}

      {surfaceActive && (
        <div
          ref={surfaceRef}
          className={`st-stage-surface ${editSprite ? 'sprite' : 'focus'}${dragging ? ' dragging' : ''}`}
          tabIndex={0}
          role="group"
          aria-label={
            editSprite ? '立绘站位:拖动或用方向键挪,拖四角或按 + / − 缩放' : '竖屏焦点:左右拖动或用方向键改'
          }
          onPointerDown={onSurfaceDown}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKey}
        >
          {selection && !playing && (
            <>
              <div
                className="st-stage-select"
                style={{ left: selection.x0, top: selection.y0, width: selection.x1 - selection.x0, height: selection.y1 - selection.y0 }}
              />
              {(
                [
                  ['nw', selection.x0, selection.y0],
                  ['ne', selection.x1, selection.y0],
                  ['sw', selection.x0, selection.y1],
                  ['se', selection.x1, selection.y1],
                ] as const
              ).map(([corner, x, y]) => (
                <span
                  key={corner}
                  className={`st-stage-handle ${corner}`}
                  style={{ left: x, top: y }}
                  onPointerDown={onCornerDown}
                />
              ))}
            </>
          )}
        </div>
      )}

      {hint && (
        <div ref={hintRef} className="st-stage-pill hint" style={hint.style}>
          <Icon name="move" size={14} />
          <span>{hint.text}</span>
        </div>
      )}
      {playing && (
        <div className="st-stage-pill playing">
          <Icon name="play" size={11} />
          <span>预览中:{fxLabel(playing.effect)}</span>
        </div>
      )}

      <div className="st-stage-pill live">
        <Icon name="eye" size={14} />
        <span>实机预览</span>
      </div>
      {badges && <div className="st-stage-badges">{badges}</div>}
      {overlays && <div className="st-stage-overlays">{overlays}</div>}
    </div>
  );
}

/** CG 层(照视觉小说的 CgImage):导入的 CG 裁满(竖长的上下来回移),生成的插图整张显示、底下垫模糊的同一张 */
function CgLayer({
  cg,
  ratio,
  onRatio,
}: {
  cg: { src: string; focus: number; mode: StageCgMode };
  ratio: number | undefined;
  onRatio: (e: SyntheticEvent<HTMLImageElement>) => void;
}) {
  if (cg.mode !== 'cover') {
    return (
      <>
        <img className="st-stage-cg backdrop" src={cg.src} alt="" draggable={false} />
        <img
          className={`st-stage-cg whole${cg.mode === 'above' ? ' above' : ''}`}
          src={cg.src}
          alt=""
          draggable={false}
          onLoad={onRatio}
        />
      </>
    );
  }
  // 高比宽大(原作里卷动着看的全身图):上下来回慢慢移,焦点用不上
  const tall = ratio !== undefined && ratio < 1;
  const style: CSSProperties = tall
    ? ({ '--cg-pan-delay': '0ms', '--cg-pan-ms': `${CG_PAN_MS}ms` } as CSSProperties)
    : { objectPosition: `${cg.focus}% 50%` };
  return <img className={`st-stage-cg${tall ? ' tall' : ''}`} src={cg.src} alt="" draggable={false} style={style} onLoad={onRatio} />;
}
