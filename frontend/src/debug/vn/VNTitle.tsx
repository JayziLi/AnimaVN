/**
 * 标题画面(Beta)。纸面 / 明亮两种样式,设置「显示 → 封面样式」里切换(10-26 起去掉了旧的海报 / 电影两种,
 * 入口和旧值迁移是设置页自己的事,这里只留两种现役样式的画法):
 *
 *   纸面:左边一张斜切的纸放 logo 和菜单,右边是上次的场景和她;
 *   明亮:整张场景,左边一层白纱放 logo 和菜单。
 *   菜单里「角色」进选角色界面,封面上不放头像圈、不放卡(10-23 定的 F:「继续」下面一行地点 · 什么时候,
 *   指到「继续」她换成存档那一刻的表情)。游戏外的界面不放角色台词、不标作品名和标签。
 *   纸面跟设置里的「主题」(白 / 黑 / 玻璃,默认白):根元素挂 av-day / av-night / is-glass,
 *   纸、墨、细线都走 --av-* 变量,玻璃时纸换成这张场景糊开 + 玻璃色(--gl-*,按封面这张场景算)。
 *   手机竖屏照设计稿 phone.html#a:场景和她铺满,纸从下面斜着托上来,菜单靠左。
 *
 * 按脸摆立绘(titleArt.ts),鼠标移到菜单上她会换表情,点她一下会害羞。
 * 素材全从卡和场景包里来,不用给封面单独配什么。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { spriteImageUrl, type PackSprite } from '../lib/api';
import { relTime } from '../lib/time';
import type { FaceBox } from '../plugins/spriteLayout';
import { TITLE_DEFAULT_ACCENT } from './fallbacks';
import { accentOf, spriteForMood, titleSpriteStyle, type TitleMood, type TitlePose } from './titleArt';
import type { TitleStyle } from './vnSettings';
import { useSettledView } from './assetGate';
import { usePaperTheme } from './usePaperTheme';
import { popThemeClass } from './ui/logic';
import { useSceneGlass } from './ui/useSceneGlass';
import './theme.css';
import './ui/ui.css';
import './vnTitle.css';

export interface TitleCard {
  id: string;
  name: string;
  avatar: string | null;
  /** 有上次玩到的对话 —— 点头像是接着上次,没有就开一段新的 */
  hasLastChat: boolean;
}

/** 一张背景 */
export interface TitleScene {
  key: string;
  src: string;
  /** 竖屏时对准横图的哪儿(object-position 的横向百分比) */
  focus: number;
  label: string;
}

interface Props {
  variant: TitleStyle;
  /** 从黑场进来(刚打开、刚换角色),不是从游戏里回标题:入场不能透出底下的游戏画面 */
  cold: boolean;
  cardId: string | null;
  charName: string;
  /** 当前对话最后一次改动的时间(后端的 updated_at) */
  lastPlayed: string | null;
  /** 停下的那一刻生效的表情(游戏当前状态,即「存档那一刻」);指到「继续」时换成它,没有就退回默认那几种 */
  lastMood: string | null;
  /** 启用的立绘,排第一的是默认表情 */
  sprites: PackSprite[];
  faces: Map<string, FaceBox>;
  /** 上次停下的地方 */
  home: TitleScene;
  cards: TitleCard[];
  onContinue: () => void;
  /** 给当前角色开一段新对话 */
  onNewStory: () => void;
  onLoad: () => void;
  onSettings: () => void;
  onExit: () => void;
  /** 「角色」:进选角色界面 */
  onPick: () => void;
  /** 局内菜单盖在封面上(从「读档 / 设置」进来的):封面不卸,但被盖住了 —— 不接点击、不能被 Tab 到 */
  covered?: boolean;
}

/** 立绘摆法:脸在右半边,竖屏时居中靠下(竖屏照 phone.html 的封面:脸 0.15、头顶 0.1)。只有纸面 / 明亮两种在役;
 *  设置里还没迁移完的旧值(poster / cinema,迁移是设置页自己的事)一律退回纸面的摆法,不让画面崩 */
const POSE_PORT: TitlePose = { faceSize: 0.15, faceTop: 0.1, cx: 0.5, floor: 0.66 };
const POSE_PAPER: { land: TitlePose; port: TitlePose } = {
  land: { faceSize: 0.22, faceTop: 0.12, cx: 0.69 },
  port: POSE_PORT,
};
const POSES: Partial<Record<TitleStyle, { land: TitlePose; port: TitlePose }>> = {
  paper: POSE_PAPER,
  bright: {
    land: { faceSize: 0.235, faceTop: 0.15, cx: 0.69 },
    port: POSE_PORT,
  },
};
const poseOf = (variant: TitleStyle) => POSES[variant] ?? POSE_PAPER;

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** 异步取色的结果;换图时先留着上一张的颜色,新的算好再换(CSS 里有过渡),不闪默认色 */
function useLoaded<T>(src: string | null, load: (src: string) => Promise<T | null>): T | null {
  const [got, setGot] = useState<T | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void load(src).then((v) => {
      if (alive) setGot(v);
    });
    return () => {
      alive = false;
    };
  }, [src, load]);
  return got;
}

interface Layer {
  key: string;
  src: string;
  style: CSSProperties;
}

const NO_LAYER: Layer = { key: '', src: '', style: {} };

/** 换表情:新图叠上去淡入,旧图淡出后摘掉(和游戏里的 SpriteLayer 同一个做法) */
function SpriteStack({ layer: next, onPoke }: { layer: Layer | null; onPoke: () => void }) {
  // 悬停菜单、点一下换的表情不在等待页必须等的那几张里:新图整张下载完了才换上,没好先留着旧的
  const shown = useSettledView(next ?? NO_LAYER);
  const layer = shown.key ? shown : null;
  const [layers, setLayers] = useState<{ cur: Layer | null; prev: Layer | null }>({ cur: layer, prev: null });
  useEffect(() => {
    if (layer?.key !== layers.cur?.key) setLayers({ cur: layer, prev: layers.cur });
    else if (layer !== layers.cur) setLayers((l) => ({ ...l, cur: layer }));
  }, [layer, layers.cur]);
  useEffect(() => {
    if (!layers.prev) return;
    const t = window.setTimeout(() => setLayers((l) => ({ ...l, prev: null })), 340);
    return () => window.clearTimeout(t);
  }, [layers.prev]);
  const img = (l: Layer, cls: string) => (
    <img
      key={l.key}
      className={`vn-tt-spr ${cls}`}
      src={l.src}
      style={l.style}
      alt=""
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onPoke();
      }}
    />
  );
  return (
    <>
      {layers.prev && img(layers.prev, 'leaving')}
      {layers.cur && img(layers.cur, layers.prev ? 'entering' : '')}
    </>
  );
}

export function VNTitle({
  variant,
  cold,
  cardId,
  charName,
  lastPlayed,
  lastMood,
  sprites,
  faces,
  home,
  cards,
  onContinue,
  onNewStory,
  onLoad,
  onSettings,
  onExit,
  onPick,
  covered,
}: Props) {
  const hasCard = Boolean(cardId);
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const root = useElementSize(rootRef);
  const box = useElementSize(boxRef);
  const portrait = root.w > 0 && root.w < root.h;

  const [mood, setMood] = useState<TitleMood>('idle');
  const hopRef = useRef<HTMLDivElement>(null);
  const moodTimer = useRef(0);
  const [leaving, setLeaving] = useState(false);

  // 换了角色:表情回到默认
  const [shownCard, setShownCard] = useState(cardId);
  if (shownCard !== cardId) {
    setShownCard(cardId);
    setMood('idle');
  }

  const idle = spriteForMood(sprites, 'idle');
  const accent = useLoaded(idle ? spriteImageUrl(idle) : null, accentOf) ?? TITLE_DEFAULT_ACCENT;
  // 主题:白 / 黑 / 玻璃。玻璃的颜色按封面这张场景算(换场景时先留着上一张的,不闪)
  const theme = usePaperTheme();
  const glass = useSceneGlass(theme === 'glass', home.src);
  // 指到「继续」那一项(不是「角色」—— 两个按钮共用 mood:'continue' 换表情,只有真正的「继续」要换成存档那一刻的脸)
  const [contHover, setContHover] = useState(false);

  // ---- 立绘:按场合挑表情,按脸摆 ----
  const pose = poseOf(variant)[portrait ? 'port' : 'land'];
  // 指到「继续」:换成存档那一刻的表情(lastMood);没有这个表情或没传就退回默认那几种(spriteForMood 自己兜底)
  const expr = mood !== 'idle' ? spriteForMood(sprites, mood, contHover ? lastMood : null) : idle;
  const layer: Layer | null = useMemo(() => {
    const src = expr ? spriteImageUrl(expr) : null;
    if (!expr || !src) return null;
    const face = faces.get(expr.id) ?? null;
    const style = titleSpriteStyle(face, expr.face_scan?.height ?? null, pose, box.h);
    return { key: expr.id, src, style };
  }, [expr, faces, pose, box.h]);

  const hover = (m: TitleMood) => () => {
    window.clearTimeout(moodTimer.current);
    setMood(m);
  };
  const unhover = () => {
    window.clearTimeout(moodTimer.current);
    moodTimer.current = window.setTimeout(() => setMood('idle'), 180);
  };
  const poke = () => {
    if (leaving) return;
    window.clearTimeout(moodTimer.current);
    setMood('poke');
    if (!reduceMotion) {
      hopRef.current?.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-1.6%)', offset: 0.35 }, { transform: 'translateY(0)' }],
        { duration: 500, easing: 'cubic-bezier(.3, 1.6, .5, 1)' },
      );
    }
    moodTimer.current = window.setTimeout(() => setMood('idle'), 2200);
  };
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(moodTimer.current);
      window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const cont = () => {
    if (leaving) return;
    window.clearTimeout(moodTimer.current);
    setMood('idle');
    setLeaving(true);
    leaveTimer.current = window.setTimeout(onContinue, reduceMotion ? 0 : 380);
  };
  const disabled = (m: TitleMood) => !hasCard && (m === 'continue' || m === 'load' || m === 'new');
  // 点了「继续」正在退场:别的按钮点了不算,不然动画放到一半又开了新故事 / 读档。
  const unlessLeaving = (fn: () => void) => () => {
    if (!leaving) fn();
  };

  const played = lastPlayed ? relTime(lastPlayed) : '';
  // 「继续」下面那行:地点 · 什么时候(10-22 起不放角色台词、不标作品名)
  const contLine = hasCard ? [home.label, played].filter(Boolean).join(' · ') : '';

  // 封面自己的点缀色(从她的立绘取,不跟设置里的「主题色」):写在根上覆盖 .vn-root 的 --av-acc*,--av-ctl 跟着深色那格
  const vars = {
    '--av-acc': accent.acc,
    '--av-acc-deep': accent.deep,
    ...(theme === 'glass' ? { '--gl-bg': `url("${home.src}")` } : {}),
    ...glass,
  } as CSSProperties;

  const sprite = (
    <div ref={boxRef} className="vn-tt-sprites">
      <div ref={hopRef} className="vn-tt-sprite-in">
        <SpriteStack layer={layer} onPoke={poke} />
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`vn-title ${variant === 'bright' ? 'bright' : 'paper'} ${popThemeClass(theme)}${hasCard ? ' has-card' : ''}${cold ? ' cold' : ''}${leaving ? ' leaving' : ''}${portrait ? ' portrait' : ''}`}
      style={vars}
      // 菜单盖在封面上:封面还在(没卸),但点不到、Tab 也到不了
      inert={covered}
    >
      <img
        key={home.key}
        className="vn-tt-bg vn-tt2-bg"
        src={home.src}
        style={{ objectPosition: `${home.focus}% 50%` }}
        alt=""
        draggable={false}
      />
      {variant === 'bright' ? (
        <>
          <div className="vn-tt2-veil" />
          <div className="vn-tt2-bloom" />
        </>
      ) : (
        <>
          <div className="vn-tt2-paperwrap">
            <div className="vn-tt2-paper">
              <img src="/vn/ui/map-left.svg" alt="" draggable={false} />
            </div>
          </div>
          <div className="vn-tt2-cut" />
        </>
      )}
      {sprite}
      <div className="vn-tt2-topshade" aria-hidden="true" />
      <div className="vn-tt2-frame" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="vn-tt2-ui">
        <div className="vn-tt2-lockup">
          <img className="mark" src="/anima-logo.svg" alt="" draggable={false} />
          <img className="word" src="/vn/ui/wordmark.png" alt="AnimaVN" draggable={false} />
        </div>
        <nav className="vn-tt2-menu">
          {[
            { mood: 'continue' as TitleMood, zh: '继续', en: 'Continue', run: cont, sub: contLine, isCont: true },
            { mood: 'new' as TitleMood, zh: '新的故事', en: 'New Story', run: onNewStory },
            { mood: 'load' as TitleMood, zh: '读档', en: 'Load', run: onLoad },
            { mood: 'continue' as TitleMood, zh: '角色', en: 'Heroine', run: onPick, sub: hasCard ? charName : '' },
            { mood: 'config' as TitleMood, zh: '设置', en: 'Config', run: onSettings },
          ].map((m) => (
            <button
              key={m.zh}
              className={`${m.sub ? 'has-sub' : ''}${m.isCont ? ' has-cont' : ''}`}
              onClick={unlessLeaving(m.run)}
              onPointerEnter={() => {
                hover(m.mood)();
                if (m.isCont) setContHover(true);
              }}
              onPointerLeave={() => {
                unhover();
                if (m.isCont) setContHover(false);
              }}
              onFocus={() => {
                hover(m.mood)();
                if (m.isCont) setContHover(true);
              }}
              onBlur={() => {
                unhover();
                if (m.isCont) setContHover(false);
              }}
              disabled={m.zh !== '角色' && m.zh !== '设置' && disabled(m.mood)}
            >
              <svg className="star" viewBox="-10 -10 20 20" aria-hidden="true">
                <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
              </svg>
              <span className="in">
                <span className="zh">{m.zh}</span>
                <span className="en">{m.en}</span>
                {m.isCont && hasCard ? (
                  <span className="sub cont">
                    <b>{home.label}</b>
                    {played && (
                      <>
                        <span className="sep">·</span>
                        {played}
                      </>
                    )}
                  </span>
                ) : (
                  m.sub && <span className="sub">{m.sub}</span>
                )}
              </span>
            </button>
          ))}
          <hr />
          <button className="minor" onClick={unlessLeaving(onExit)} onPointerEnter={hover('exit')} onPointerLeave={unhover}>
            <svg className="star" viewBox="-10 -10 20 20" aria-hidden="true">
              <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
            </svg>
            <span className="in">
              <span className="zh">调试台</span>
              <span className="en">Console</span>
            </span>
          </button>
        </nav>
        {!hasCard && (
          <button className="vn-tt2-last" onClick={onPick}>
            <span className="ln">{cards.length > 0 ? '先选一个角色,开始你们的故事' : '库里还没有角色卡,先回调试台导入一张'}</span>
            <span className="mt">
              <span />
              <b>选角色</b>
            </span>
          </button>
        )}
        <div className="vn-tt2-foot">AnimaVN · Beta</div>
      </div>
    </div>
  );
}
