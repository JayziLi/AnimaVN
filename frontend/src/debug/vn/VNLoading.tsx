/**
 * 素材等待页:进游戏、换角色、换立绘包时,图还没到齐就先盖着它(什么时候露、等多久见 assetGate.ts)。
 *
 * 照星海的加载页(设计稿 kit/loading.js,U32;电脑和手机竖屏是同一份,手机只是竖着排):
 * 整屏铺要进的那个场景,不放立绘、不放卡、没有纸;底下按场景亮度压一层暗渐变(亮的白天压得多);
 * 右上一道很淡的轨道弧和几颗小星;底部一条贯穿全宽的白细线,走到哪是一颗白色小菱形(不跟角色色);
 * 细线上方正中是 AnimaVN 的标,外面绕一圈细轨道;左下斜体 Tips + 一句小贴士(8 条轮换,只写真有的功能);
 * 右下「正在载入 · 名字 · 场景包」。网络慢(等了 12 秒 must 还没齐)时进度停在六成,左下换成「先进去」按钮。
 * 图还没到时先铺它的平均色(读不到就用上一次的),下完了淡入 —— 不先出一个空拱形。
 * 不放角色台词、不写作品名。
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { loadingWhat, slowHold } from './cover/loadingLogic';
import { skyShapes } from './cover/loadingSky';
import { nextTip } from './cover/loadingTips';
import { isPortrait, useBoxSize } from './pick/useBoxSize';
import { sceneToneOf } from './titleArt';
import './theme.css';
import './ui/ui.css';
import './vnLoading.css';

interface Props {
  charName: string;
  /** 场景包名(没绑场景包、或者只有卡图时是 null);右下角接在名字后面 */
  scenePackName?: string | null;
  /** 已经下好的背景;还没下好是 null */
  backdrop: string | null;
  /** 背景的地址(不管下好没有):有的话先下一张很小的缩略图取平均色铺底,不用等整张下完。不给就用上一次的颜色 */
  backdropSrc?: string | null;
  /** 按种类数的进度条(立绘 9/15 · 背景 3/17……)和整条进度 0–1;网络慢时进度停在六成 */
  fraction: number;
  slow: boolean;
  onSkip: () => void;

}

/** 取不到场景色调(还没下好、读不出像素)时的底色和亮度:偏暗的灰蓝 */
const NEUTRAL_TONE = { avg: [32, 32, 42] as [number, number, number], lum: 0.35 };
/** 上一次读到的色调:这一次的图还没到时先用它铺底,换角色时不闪回灰色 */
let lastTone: { avg: [number, number, number]; lum: number } | null = null;

/** 这张图的平均色和亮度;换图时先留着上一次的,新的算好再换 */
function useSceneTone(src: string | null) {
  const [tone, setTone] = useState(lastTone ?? NEUTRAL_TONE);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void sceneToneOf(src).then((t) => {
      if (!alive || !t) return;
      lastTone = t;
      setTone(t);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  return tone;
}

const STAR_SPARK = 'M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z';

/** 右上角的轨道弧和小星(固定种子,每次一样) */
function Sky({ phone }: { phone: boolean }) {
  const s = skyShapes(phone);
  const { orbit: o } = s;
  return (
    <svg className="av-ld-sky" viewBox={`0 0 ${s.w} ${s.h}`} preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      <circle className="o" cx={o.cx} cy={o.cy} r={o.r} />
      <circle className="o dot" cx={o.cx} cy={o.cy} r={o.r + o.gap} />
      <circle className="pl" cx={o.px} cy={o.py} r={2} />
      {s.dots.map((d, i) => (
        <circle key={i} className="st" cx={d.cx} cy={d.cy} r={d.r} opacity={d.o} />
      ))}
      {s.sparks.map((p, i) => (
        <path key={i} className="sp" d={STAR_SPARK} transform={`translate(${p.x} ${p.y}) scale(${p.s / 10})`} opacity={p.o} />
      ))}
    </svg>
  );
}

export function VNLoading({ charName, scenePackName = null, backdrop, backdropSrc = null, fraction, slow, onSkip }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const portrait = isPortrait(useBoxSize(rootRef));
  // 小贴士:每出一次换下一条,同一次等待里不变(电脑 / 手机各一套,横竖屏转了也留着这一句)
  const [tips] = useState(() => ({ pc: nextTip(false), phone: nextTip(true) }));
  const tip = portrait ? tips.phone : tips.pc;

  const tone = useSceneTone(backdrop ?? backdropSrc);
  const night = tone.lum < 0.3;
  // 场景越亮,底下压得越多(白天的客厅、璃月的白天都很亮)
  const k = Math.max(0.75, Math.min(1.15, 0.62 + tone.lum * 0.7));

  // 进度:网络慢了停在六成,不往回缩
  const peak = useRef(0);
  peak.current = slowHold(peak.current, fraction, slow);
  const shown = peak.current;
  const pct = Math.round(shown * 100);

  // 图下完了才淡入,之前先铺平均色
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setReady(Boolean(imgRef.current?.complete && imgRef.current.naturalWidth > 0));
  }, [backdrop]);

  const what = loadingWhat(charName, scenePackName);
  const vars = { '--ld-k': k.toFixed(2), '--p': shown.toFixed(4) } as CSSProperties;

  return (
    <div ref={rootRef} className="vn-gate vn-ld" role="status" aria-live="polite" aria-label={`正在准备${charName}的素材`}>
      <div className={`av-ld ${night ? 'is-night' : 'is-day'}${portrait ? ' is-phone' : ''} is-rise`} style={vars}>
        <div className="av-ld-ph" style={{ background: `rgb(${tone.avg.join(' ')})` }} />
        {backdrop && (
          <img
            ref={imgRef}
            key={backdrop}
            className={`av-ld-bg${ready ? ' ready' : ''}`}
            src={backdrop}
            alt=""
            draggable={false}
            onLoad={() => setReady(true)}
          />
        )}
        <div className="av-ld-shade" />
        <Sky phone={portrait} />
        <div className="av-ld-ui">
          <div className="av-ld-mark" aria-hidden="true">
            <svg className="ring" viewBox="-40 -40 80 80">
              <g transform="rotate(-18)">
                <path d="M-36 0A36 12 0 0 1 36 0" />
              </g>
            </svg>
            <img src="/anima-logo.svg" alt="" draggable={false} />
            <svg className="ring" viewBox="-40 -40 80 80">
              <g transform="rotate(-18)">
                <path d="M36 0A36 12 0 0 1-36 0" />
                <circle cx="31.2" cy="6" r="1.8" />
              </g>
            </svg>
          </div>
          {slow ? (
            <button type="button" className="av-ld-skip" onClick={onSkip}>
              网络有点慢 · 先进去,剩下的边玩边下
            </button>
          ) : (
            <p className="av-ld-tip">
              <em>Tips</em>
              <span>{tip}</span>
            </p>
          )}
          <p className="av-ld-what">
            {what.map((w, i) => (
              <span key={i}>
                {i > 0 && <i>·</i>}
                {w}
              </span>
            ))}
          </p>
          <div className="av-ld-bar" role="progressbar" aria-label="载入进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i />
            <b />
          </div>
        </div>
      </div>
    </div>
  );
}
