/**
 * 设置页右边的实机预览(U16,设置 A「双栏 + 实机预览」,设计稿 pages/settings.js 的 renderA / miniGame):
 * 按玩家当前画面尺寸渲染背景、立绘和对话区,完整等比缩到栏宽;没有游戏根时用 1440×810。
 * 用的是游戏画面同一套 class(.vn-root.ga / .ga-say / .ga-name …,老样子的经典框是 .vn-window / .vn-box),所以对话框样式、
 * 压暗、字体、字号、主题色改了这里马上变;文字速度看得到打字。四角按钮不画(和对话区无关),最下面那行淡字画(设计稿 AV.say)。
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { VNSettings } from '../vnSettings';
import { FaceCrop } from '../ui/FaceCrop';
import { GameIcon } from '../ui/GameIcon';
import { PaperButton } from '../ui/PaperButton';
import { FrostLayer } from '../ui/FrostLayer';
import { useFrost } from '../ui/useFrost';

export interface PreviewLine {
  /** 说话人;旁白是 null */
  who: string | null;
  text: string;
  ja?: string | null;
}

export interface LivePreviewData {
  bg: string;
  /** 她现在的立绘;没有就不画 */
  sprite: string | null;
  /** 当前这一幕的几句(没有对话时用开场白);至少一句 */
  lines: readonly PreviewLine[];
  /** 主题色变量(和游戏根上同一份) */
  accentStyle: Record<string, string>;
  spriteStyle?: CSSProperties;
  bgFocus?: number;
}

const W = 1440;
const H = 810;

/** 手机上收成一条的预览:展开 / 收起记在模块里(换页签、关掉再开菜单都不变,刷新就忘) */
const stripMemory = { open: false };

/** 立绘的宽高比(圆头像按脸裁要用);还没量到 / 没有立绘时是 null */
function useAspect(src: string | null): number | null {
  const [got, setGot] = useState<{ src: string; aspect: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live && img.naturalHeight > 0) setGot({ src, aspect: img.naturalWidth / img.naturalHeight });
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return src && got?.src === src ? got.aspect : null;
}

/**
 * strip = 手机版(设计稿 renderPhoneA 的 .ph-pv):页签下面一条 —— 她的圆头像 + 「实机预览」+ 正在播的那句 + 「展开」,
 * 点开是一小块游戏画面(同一块 1440×810,缩到条宽)。电脑版是右边一栏(不给 strip)
 */
export function LivePreview({
  data,
  settings,
  strip: asStrip = false,
}: {
  data: LivePreviewData;
  settings: VNSettings;
  strip?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  // 经典玻璃框里垫的模糊背景按框对齐
  const say = useRef<HTMLDivElement>(null);
  const frost = useFrost(say, `${settings.dlgStyle}:${settings.boxSkin}:${settings.dialogueOffset}:${settings.dialogueHeight}`);
  const [view, setView] = useState({ width: W, height: H, scale: 0.3 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // 按玩家当前画面的真实尺寸渲染后整体缩小,保留宽高比、换行和舞台缩放。
    const root = el.closest<HTMLElement>('.vn-root');
    const fit = () => {
      const width = root?.clientWidth || W;
      const height = root?.clientHeight || H;
      setView({ width, height, scale: el.clientWidth / width });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (root) ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const [i, setI] = useState(0);
  const [run, setRun] = useState(0);
  const line = data.lines[i % data.lines.length];
  const [n, setN] = useState(0);
  // 打字:按设置的文字速度一个字一个字出;0 = 整句直接出。打完停一会儿接下一句(自动播放的间隔 / 倍速)
  useEffect(() => {
    const len = [...line.text].length;
    if (settings.textSpeed <= 0) {
      setN(len);
    } else {
      setN(0);
    }
    let k = settings.textSpeed <= 0 ? len : 0;
    const tick = settings.textSpeed > 0 ? window.setInterval(() => {
      k++;
      setN(k);
      if (k >= len) window.clearInterval(tick);
    }, settings.textSpeed) : 0;
    const typeMs = settings.textSpeed > 0 ? len * settings.textSpeed : 0;
    const next = window.setTimeout(() => setI((x) => x + 1), typeMs + settings.autoDelay / settings.autoSpeed + 600);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(next);
    };
  }, [line, run, settings.textSpeed, settings.autoDelay, settings.autoSpeed]);

  const chars = [...line.text];
  const shown = chars.slice(0, n).join('');
  const rest = chars.slice(n).join('');
  const dlgLine = settings.dlgStyle === 'line';
  // 对话区 A / 经典玻璃框(和游戏画面一样):老样子的经典框(玻璃框底色 = 经典)还是 .vn-window
  const glass = dlgLine || settings.boxSkin !== 'classic';

  const [open, setOpenState] = useState(stripMemory.open);
  const setOpen = (v: boolean) => {
    stripMemory.open = v;
    setOpenState(v);
  };
  const aspect = useAspect(asStrip ? data.sprite : null);

  const game = (
    <div className="vn-sp-pvbox" ref={box} style={{ aspectRatio: `${view.width} / ${view.height}`, '--vn-preview-aspect': view.width / view.height } as CSSProperties}>
      <div
        className={`vn-root vn-live-root${glass ? ` ga is-night${dlgLine ? '' : ' dlg-classic'}${line.who ? '' : ' narr'}` : ''}`}
        data-dlg={dlgLine ? 'line' : 'classic'}
        data-skin={dlgLine ? 'glass-dark' : settings.boxSkin}
        data-font={settings.textFont}
        aria-hidden="true"
        style={
          {
            width: view.width,
            height: view.height,
            transform: `scale(${view.scale})`,
            '--ga-k': Math.min(view.width / W, view.height / H),
            '--vn-box-alpha': settings.boxOpacity,
            '--vn-text-scale': settings.textScale,
            '--vn-dialogue-offset': `${settings.dialogueOffset}px`,
            '--vn-dialogue-height': `${settings.dialogueHeight}px`,
            ...data.accentStyle,
          } as CSSProperties
        }
      >
        <div className="vn-stage">
          <img className="vn-live-bg" style={{ objectPosition: `${data.bgFocus ?? 50}% 50%` }} src={data.bg} alt="" draggable={false} />
          {data.sprite && <div className="vn-sprite-stage"><div className="vn-sprite-fx"><img className="vn-sprite" style={data.spriteStyle} src={data.sprite} alt="" draggable={false} /></div></div>}
        </div>
        {dlgLine && <div className="ga-shade" />}
        {glass ? (
          <div className="ga-stage" data-frost-scale="">
            <div className="ga-zone">
              <div className="ga-say" ref={say}>
                {!dlgLine && <FrostLayer src={data.bg} style={frost} />}
                <div className="ga-head">
                  <span className="ga-name">
                    <GameIcon name="voice-wave" size={22} className="ga-wave" />
                    <span className="nm">{line.who ?? ''}</span>
                  </span>
                </div>
                <div className="ga-rule" />
                <div className="ga-body">
                  {line.ja && <p className={`ga-ja${line.ja.startsWith('「') ? ' say' : ''}`}>{line.ja}</p>}
                  <p className={`ga-zh${line.text.startsWith('「') ? ' say' : ''}`}>
                    {shown}
                    <span className="vn-type-rest">{rest}</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="ga-input">
              <span className="ga-ghost">说点什么 · 随时可以插话</span>
            </div>
          </div>
        ) : (
          <div className="vn-window">
            <div className="vn-box">
              {line.who && (
                <div className="vn-name">
                  <span className="vn-name-nm">{line.who}</span>
                </div>
              )}
              {line.ja && <div className="vn-ja">{line.ja}</div>}
              <div className={`vn-text${line.who ? '' : ' narration'}`}>
                {shown}
                <span className="vn-type-rest">{rest}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (asStrip) {
    return (
      <div className={`vn-sp-pvm${open ? ' open' : ''}`}>
        <button type="button" className="vn-sp-pvm-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <FaceCrop src={aspect ? data.sprite : null} aspect={aspect ?? 1} size={30} />
          <span className="lb">实机预览</span>
          <span className="ln">{line.text}</span>
          <span className="tg">{open ? '收起' : '展开'}</span>
        </button>
        <div className="vn-sp-pvm-body" inert={!open}>
          <div className="vn-sp-pvm-in">{game}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="vn-sp-pv">
      <div className="vn-sp-pvh">
        <span className="zh">实机预览</span>
        <span className="en">Preview</span>
      </div>
      {game}
      <div className="vn-sp-pvbtns">
        <PaperButton sm onClick={() => setRun((r) => r + 1)}>
          重播这句
        </PaperButton>
        <PaperButton sm kind="ghost" onClick={() => setI((x) => x + 1)} disabled={data.lines.length < 2}>
          下一句
        </PaperButton>
      </div>
      <p className="vn-sp-pvcap">文字、显示、外观里影响画面的项,改了这里马上变。</p>
    </div>
  );
}
