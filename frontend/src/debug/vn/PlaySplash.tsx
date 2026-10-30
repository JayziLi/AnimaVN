/**
 * 从启动器打开游戏时的开屏(debug.html?play=1,DebugApp 里管什么时候出、什么时候撤)。
 *
 * 用户 10-21:「启动后黑屏显示 AnimaVN 的 logo,等必要素材加载完(角色卡载入等,这样用户不会进去看见
 * 角色卡一个个出来),下面显示点击进入游戏,点击后动画进入无角色的封面界面」。
 * 第二轮:logo 跟屏幕放大;挑了「光注入」—— 加载时一道光从左往右把 logo 点亮,进入时白光炸开;
 * 「星要对上」,把 logo 里的彗星轨拆出来做入场:光灌满以后彗星沿彗星轨划过,从 a、V、N 后面钻过去,落到星上闪一下。
 * 字和彗星轨是从定稿图拆的两层(lockup-text.png / lockup-trail.png,叠起来和原 logo 逐像素一样),轨迹见 splashTrail.ts。
 * 和游戏窗口的等待页(launcher/ui/boot.html)同一个位置、同一个暗 logo,换页时接得上。
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { along, behindLetters, TRAIL } from './splashTrail';
import './playSplash.css';

interface Props {
  /** 0–1;null = 还在等角色卡列表 */
  progress: number | null;
  /** 素材都下好了(或者等够了) */
  ready: boolean;
  /** 点过了:白光铺满,盖着等封面画出来 */
  leaving: boolean;
  /** 封面画出来了:白光散开 */
  fading: boolean;
  onEnter: () => void;
}

/** load 光往里灌 → intro 高光扫过、彗星划过 → flown 落到星上闪一下 → tap 等点 */
type Stage = 'load' | 'intro' | 'flown' | 'tap';
const COMET_MS = 650;
const STAR = 'M0-50C4-14 14-4 50 0C14 4 4 14 0 50C-4 14-14 4-50 0C-14-4-4-14 0-50Z';

export function PlaySplash({ progress, ready, leaving, fading, onEnter }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const [stage, setStage] = useState<Stage>('load');
  const goal = useRef({ progress: 0, ready: false });
  goal.current = { progress: progress ?? 0, ready };

  // 一出来就拿到焦点:回车、空格也能进
  useEffect(() => root.current?.focus(), []);

  // 显示的进度慢慢追上真实进度(没到齐别灌满);到齐又灌满了就开始入场
  useEffect(() => {
    let shown = 0;
    let raf = 0;
    const tick = () => {
      const want = goal.current.ready ? 1 : Math.min(goal.current.progress, 0.97);
      shown = goal.current.ready ? 1 : shown + (want - shown) * 0.18;
      if (want - shown < 0.002) shown = want;
      root.current?.style.setProperty('--p', shown.toFixed(4));
      if (shown >= 1) setStage('intro');
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 彗星:高光扫到一半时出发,按弧长走(两头缓),划过的地方彗星轨显出来,走到字母后面时彗星头藏起来
  useEffect(() => {
    const el = root.current;
    if (stage !== 'intro' || !el) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--c', '1');
      const t = window.setTimeout(() => setStage('tap'), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const start = window.setTimeout(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - t0) / COMET_MS);
        const [x, y] = along(0.5 - Math.cos(Math.PI * u) / 2);
        el.style.setProperty('--c', (x + 0.002).toFixed(4));
        el.style.setProperty('--hx', x.toFixed(4));
        el.style.setProperty('--hy', y.toFixed(4));
        if (head.current) head.current.style.opacity = u < 1 && !behindLetters(x) ? '1' : '0';
        if (u < 1) {
          raf = requestAnimationFrame(step);
        } else {
          el.style.setProperty('--c', '1');
          setStage('flown');
        }
      };
      raf = requestAnimationFrame(step);
    }, 100);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
    };
  }, [stage]);

  // 收尾只负责装饰状态;资源就绪后提示和点击已独立放行。
  useEffect(() => {
    if (stage !== 'flown') return;
    const t = window.setTimeout(() => setStage('tap'), 180);
    return () => clearTimeout(t);
  }, [stage]);

  const enter = () => {
    if (ready && !leaving && !entered.current) {
      entered.current = true;
      onEnter();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enter();
    }
  };
  const [sx, sy] = TRAIL.star;
  const [sw, sh] = TRAIL.star_size;
  return (
    <div
      ref={root}
      className={`vn-splash ${stage}${ready ? ' ready' : ''}${leaving ? ' leaving' : ''}${fading ? ' fading' : ''}`}
      onClick={enter}
      onKeyDown={onKey}
      role="button"
      tabIndex={0}
      aria-disabled={!ready || leaving}
      aria-label={ready ? '点击进入游戏' : '正在准备'}
    >
      <div className="vn-splash-lock">
        <img className="ghost" src="/vn/ui/lockup-text.png" alt="AnimaVN" draggable={false} />
        <img className="fill" src="/vn/ui/lockup-text.png" alt="" draggable={false} />
        <div className="glow edge-wrap">
          <div className="t edge" />
        </div>
        <div className="t sheen" />
        <img className="trail" src="/vn/ui/lockup-trail.png" alt="" draggable={false} />
        <div className="glow tglow-wrap">
          <div className="r tglow" />
        </div>
        <div className="head" ref={head}>
          <i />
          <svg viewBox="-50 -50 100 100" aria-hidden>
            <path d={STAR} />
          </svg>
        </div>
        {/* 闪光正好叠在 logo 的星上:中心、大小都是从拆出来的图量的 */}
        <div className="glint" style={{ left: `${sx * 100}%`, top: `${sy * 100}%`, width: `${sw * 100}%`, height: `${sh * 100}%` }}>
          <svg viewBox="-50 -50 100 100" preserveAspectRatio="none" aria-hidden>
            <path d={STAR} />
          </svg>
        </div>
      </div>
      <div className="vn-splash-bloom" />
      <div className="vn-splash-foot">{ready && <span className="tap">点击进入游戏</span>}</div>
    </div>
  );
}
