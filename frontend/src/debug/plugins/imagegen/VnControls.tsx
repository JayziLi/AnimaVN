/**
 * 视觉小说里生图的几样东西:
 * - 发送右边的画笔(IgButton):点一下直接画这一句,右键 / 长按开「画这一幕」的设置,正在画时角上一个小点;
 * - 舞台上那一层(IgStage):右下角细条上方一条同样的细条 —— 正在画时写进度(构思画面 › Drawing · 几秒 | 等待 N),
 *   这句有图时放操作(标题 · 换一张 / 收藏 / 收起 / 这张图),只用图标、悬停有说明;
 *   「画这一幕」小面板(对话框正上方靠右:尺寸、想看什么、先看提示词)、提示词详情。
 * 点这些东西不能让对话往下走:外层都拦掉点击。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VnImageMark } from '../../lib/chatEntry';
import type { VnIllustrationContext } from '../cartridges';
import { imagegenApi, type GeneratedImage, type Picture, type PlanResult } from './api';
import {
  CAMERAS,
  orientsOf,
  SIZE_NAMES,
  type Camera,
  type SizeKey,
} from './config';
import './imagegen.css';
import { Seg } from './ui';
import type { DrawTarget, ImageGenStore } from './useImageGen';

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 画笔:笔杆斜着、笔头一团(实心,和旁边发送的纸飞机一样) */
function BrushIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.2 2.8a1.9 1.9 0 0 0-2.7 0l-7.6 7.7 2.7 2.7 7.6-7.7a1.9 1.9 0 0 0 0-2.7z" />
      <path d="M10.3 11.1l2.7 2.7c.4 2.9-1.6 6.6-6 7.4-1.6.3-3.3.1-4.6-.6 1.4-.8 2-1.9 2.1-3.4.2-3.4 2.9-6.3 5.8-6.1z" />
    </svg>
  );
}

/** 点一下直接画这一句(默认尺寸、不看提示词);右键 / 手机长按才开「画这一幕」的设置。设置开着时点它是关上 */
export function IgButton({ store, ctx }: { store: ImageGenStore; ctx: VnIllustrationContext }) {
  const busy = store.jobs.length > 0;
  const classes = ['ig-btn'];
  if (store.panelOpen) classes.push('on');
  if (busy) classes.push('busy');
  // 点一下画的是什么(悬停提示里写)
  const what = ['画这一幕'];
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const unpress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const click = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (store.panelOpen) {
      store.setPanelOpen(false);
      return;
    }
    const target = store.targetOf(ctx);
    // 没填 token、还没有回复:开设置,里面写着为什么画不了
    if (!store.status?.has_token || !target) {
      store.setPanelOpen(true);
      return;
    }
    void store.drawNow(target, '', store.config.size);
  };
  return (
    <button
      ref={store.setAnchor}
      type="button"
      className={classes.join(' ')}
      onClick={click}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.setPanelOpen(true);
      }}
      // iOS 长按不发 contextmenu:自己数 0.5 秒
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        unpress();
        pressTimer.current = window.setTimeout(() => {
          longPressed.current = true;
          store.setPanelOpen(true);
        }, 500);
      }}
      onPointerUp={unpress}
      onPointerLeave={unpress}
      onPointerCancel={unpress}
      aria-pressed={store.panelOpen}
      aria-label="画这一幕(AI 生图 BETA)"
      title={
        busy
          ? `正在画:${store.jobs[0].label}(点一下再排一张)`
          : `点一下:${what.join('')} · 右键 / 长按:先设置再画(AI 生图 BETA)`
      }
    >
      <BrushIcon />
    </button>
  );
}

/** 小面板放在对话框正上方、右边和对话框对齐(画笔在框的右下):不压台词;框变高、窗口变大小时跟着挪。
 *  量不到(按钮不在)就用 CSS 里的左上角 */
function usePopAt(anchor: HTMLElement | null): React.CSSProperties | undefined {
  const [at, setAt] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    const box = anchor?.closest('.vn-box');
    const root = anchor?.closest('.vn-root');
    if (!anchor || !box || !root) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      // 框上沿还压着名牌,多让 22;上面留 60:右上角是语音和模型标签
      setAt({ top: 'auto', left: 'auto', bottom: r.bottom - b.top + 22, right: r.right - b.right, maxHeight: Math.max(160, b.top - r.top - 82) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);
  return at;
}

/** 每秒刷新一次的「过了几秒」 */
function useSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, (now - since) / 1000);
}

/** 状态的下一步(写在当前这步后面、淡一点):第一次先记住她的样子,然后构思画面,然后画 */
const NEXT_STEP: Record<string, string> = { 记住她的样子: '构思画面', 构思画面: 'Drawing' };

/** 插图那条细条上的线条图标(和四角细条同一套:24 格、1.5 线宽、圆头) */
function BarIcon({ name, filled }: { name: 'reroll' | 'star' | 'stow' | 'info' | 'picture'; filled?: boolean }) {
  return (
    <svg
      className="av-ic"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'reroll' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M15.6 10.2a3.8 3.8 0 1 0 .3 3.2" />
          <path d="M15.9 7.8v2.6h-2.6" />
        </>
      )}
      {name === 'star' && <path d="M12 4.2l2.3 4.7 5.2.8-3.75 3.65.9 5.15L12 16.07 7.35 18.5l.9-5.15L4.5 9.7l5.2-.8z" />}
      {name === 'stow' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="11" rx="2" />
          <path d="M9 12.5l3 2.5 3-2.5M12 8v7" />
          <path d="M5.5 19.5h13" />
        </>
      )}
      {name === 'picture' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M3.5 16l4.6-4.6 3.4 3.4 2.6-2.6 6.4 6.3" />
          <circle cx="15.5" cy="9" r="1.5" />
        </>
      )}
      {name === 'info' && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5.5" />
          <path d="M12 7.6v.2" />
        </>
      )}
    </svg>
  );
}

/** 正在画:一条和四角一样的细条,写现在这步(白)› 下一步(淡)· 几秒 | 等待 N */
function Status({ store }: { store: ImageGenStore }) {
  const first = store.jobs[0] ?? null;
  const secs = useSeconds(first?.started ?? null);
  if (!first) return null;
  const next = NEXT_STEP[first.label];
  return (
    <div className="vn-strip ig-bar ig-status" role="status" title="AI 生图">
      <span className="ig-step">
        <span className="ig-dot" aria-hidden="true" />
        <b>{first.label}</b>
        {next && (
          <>
            <svg className="ig-next" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span className="ig-later">{next}</span>
          </>
        )}
        <span className="ig-secs">{secs.toFixed(0)} 秒</span>
      </span>
      {store.jobs.length > 1 && <span className="ig-queue">等待 {store.jobs.length - 1}</span>}
    </div>
  );
}

const TRIGGER_NAME: Record<GeneratedImage['trigger'], string> = { manual: '手动', auto: '自动', reroll: '换一张' };

/** 这张插图的操作:标题 · 换一张 · 收藏 · 收起 · 这张图(说明和提示词),照四角细条的样子,只放图标 */
function Tools({
  store,
  ctx,
  mark,
  onInfo,
  open,
  toggle,
}: {
  store: ImageGenStore;
  ctx: VnIllustrationContext;
  mark: VnImageMark | null;
  onInfo: () => void;
  /** 收着时只有最后那颗小按钮 */
  open: boolean;
  toggle: React.ReactNode;
}) {
  const entry = ctx.entry;
  if (!open || !entry || !mark) {
    return (
      <nav className="vn-strip ig-bar ig-tools" aria-label="这张插图" onClick={stop}>
        {toggle}
      </nav>
    );
  }
  const img = store.album?.find((x) => x.id === mark.id) ?? null;
  const kept = Boolean(img?.kept_asset_id);
  return (
    <nav className="vn-strip ig-bar ig-tools is-open" aria-label="这张插图" onClick={stop}>
      {img?.title && (
        <span className="ig-cap">
          <b>{img.title}</b>
          <small>{TRIGGER_NAME[img.trigger]}</small>
        </span>
      )}
      <button type="button" onClick={() => void store.reroll(entry, mark)} aria-label="换一张" data-tip={"换一张\n同一幅画面再画一张,画好了换上;这张留在相册里"}>
        <BarIcon name="reroll" />
      </button>
      <button
        type="button"
        className={kept ? 'on' : undefined}
        onClick={() => !kept && void store.keep(mark.id)}
        aria-label={kept ? '已收藏' : '收藏'}
        aria-pressed={kept}
        data-tip={kept ? '已收藏\n在这张卡的「AI 生图」CG 包里' : '收藏\n放进这张卡的「AI 生图」CG 包,以后 AI 能直接选它'}
      >
        <BarIcon name="star" filled={kept} />
      </button>
      <button type="button" onClick={() => store.hide(entry, mark)} aria-label="收起这张图" data-tip={"收起\n这张先不看,相册里还有"}>
        <BarIcon name="stow" />
      </button>
      <button type="button" onClick={onInfo} aria-label="这张图的说明和提示词" data-tip={"这张图\n标题、说明和提示词"}>
        <BarIcon name="info" />
      </button>
      {toggle}
    </nav>
  );
}

interface Preview {
  target: DrawTarget;
  plan: PlanResult;
  title: string;
  description: string;
  picture: Picture;
}

/** 对话框里显示的这句:去掉台词外层的引号 */
const unquote = (s: string) => s.replace(/^\s*[「『“"]/, '').replace(/[」』”"]\s*$/, '');

function DrawPanel({ store, ctx }: { store: ImageGenStore; ctx: VnIllustrationContext }) {
  const [want, setWant] = useState('');
  const [size, setSize] = useState<SizeKey>(store.config.size);
  const [camera, setCamera] = useState<Camera>(store.config.camera);
  const [look, setLook] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [thinking, setThinking] = useState(false);
  const target = store.targetOf(ctx);
  const here = ctx.lines[ctx.line];
  const close = () => store.setPanelOpen(false);
  const at = usePopAt(store.anchor);

  const go = async () => {
    if (!target) return;
    if (!look) {
      close();
      await store.drawNow(target, want, size, camera);
      return;
    }
    setThinking(true);
    const plan = await store.plan(target, want, camera);
    setThinking(false);
    if (plan) setPreview({ target, plan, title: plan.title, description: plan.description, picture: plan.picture });
  };

  const drawPreview = async () => {
    if (!preview) return;
    close();
    await store.draw(preview.target, {
      picture: preview.picture,
      title: preview.title,
      description: preview.description,
      size,
      until: preview.plan.until,
    });
  };

  const setPerson = (i: number, patch: { tags?: string; clothes?: string; look?: string }) =>
    preview &&
    setPreview({
      ...preview,
      picture: { ...preview.picture, people: preview.picture.people.map((p, k) => (k === i ? { ...p, ...patch } : p)) },
    });

  return (
    <div className={`ig-panel${at ? ' ig-pop' : ''}${ctx.paperClass ? ` ${ctx.paperClass}` : ''}`} style={at} role="dialog" aria-label="画这一幕" onClick={stop}>
      <div className="ig-head">
        <span className="ig-title">
          画这一幕 <span className="ig-beta">BETA</span>
        </span>
        <button
          className="vn-pill ig-x"
          onClick={() => {
            close();
            ctx.openSettings();
          }}
          title="菜单 → 设置 → AI 生图"
        >
          全部设置
        </button>
        <button className="vn-pill ig-x" onClick={close}>
          关
        </button>
      </div>
      {!store.status?.has_token ? (
        <p className="ig-note">还没填 NovelAI token:点上面「全部设置」→ 服务。</p>
      ) : !target ? (
        <p className="ig-note">还没有回复可以画。</p>
      ) : preview ? (
        <>
          <p className="ig-note">
            指导模型({preview.plan.connection},{(preview.plan.ms / 1000).toFixed(1)} 秒)写的画面,可以改了再画。
            画风和角色名自动加,长相、衣服照这里写的画。
          </p>
          <div className="ig-pair">
            <label className="ig-field">
              <span>名字</span>
              <input className="ig-input" value={preview.title} onChange={(e) => setPreview({ ...preview, title: e.target.value })} />
            </label>
          </div>
          <label className="ig-field">
            <span>分镜</span>
            <textarea
              className="ig-input"
              rows={2}
              value={preview.description}
              onChange={(e) => setPreview({ ...preview, description: e.target.value })}
            />
          </label>
          <label className="ig-check">
            <input
              type="checkbox"
              checked={Boolean(preview.picture.pov)}
              onChange={(e) => setPreview({ ...preview, picture: { ...preview.picture, pov: e.target.checked } })}
            />
            第一人称(玩家是镜头,不画玩家)
          </label>
          <label className="ig-field">
            <span>场景 · 镜头</span>
            <textarea
              className="ig-input"
              rows={2}
              value={preview.picture.scene}
              onChange={(e) => setPreview({ ...preview, picture: { ...preview.picture, scene: e.target.value } })}
            />
          </label>
          <label className="ig-field">
            <span>构图(一句英文)</span>
            <textarea
              className="ig-input"
              rows={2}
              value={preview.picture.composition ?? ''}
              onChange={(e) => setPreview({ ...preview, picture: { ...preview.picture, composition: e.target.value } })}
            />
          </label>
          {preview.picture.people.map((p, i) => (
            <div className="ig-field" key={`${p.who}-${i}`}>
              <span>{p.who}</span>
              <input
                className="ig-input"
                value={p.look ?? ''}
                placeholder="这一刻的长相(发型、发色、瞳色……)"
                onChange={(e) => setPerson(i, { look: e.target.value })}
              />
              <input
                className="ig-input"
                value={p.clothes ?? ''}
                placeholder="这一刻穿的(全部写上,光脚也写)"
                onChange={(e) => setPerson(i, { clothes: e.target.value })}
              />
              <textarea className="ig-input" rows={2} value={p.tags} onChange={(e) => setPerson(i, { tags: e.target.value })} />
            </div>
          ))}
          <div className="ig-actions">
            <button className="vn-pill" onClick={() => setPreview(null)}>
              重写
            </button>
            <button className="vn-pill accent" onClick={() => void drawPreview()}>
              照这个画
            </button>
          </div>
        </>
      ) : (
        <>
          {here && (
            <p className="ig-line">
              {here.speaker ? `${here.speaker}:` : ''}
              {unquote(here.text).slice(0, 60)}
            </p>
          )}
          <div className="ig-row">
            <span className="ig-label">方向</span>
            <Seg
              options={orientsOf(store.config.res).map((k) => ({ value: k, name: SIZE_NAMES[k] }))}
              value={size}
              onPick={(v) => setSize(v)}
            />
          </div>
          <div className="ig-row">
            <span className="ig-label">镜头</span>
            <Seg
              options={CAMERAS.map((c) => ({ value: c.value, name: c.value === 'auto' ? '指导模型挑' : c.name }))}
              value={camera}
              onPick={(v) => setCamera(v)}
            />
          </div>
          <input
            className="ig-input"
            value={want}
            onChange={(e) => setWant(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void go();
            }}
            placeholder="想看什么(可不填),比如:她换上泳装"
          />
          <label className="ig-check">
            <input type="checkbox" checked={look} onChange={(e) => setLook(e.target.checked)} />
            先看提示词再画
          </label>
          <div className="ig-actions">
            <button className="vn-pill accent" onClick={() => void go()} disabled={thinking}>
              {thinking ? '指导模型在想…' : '画'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Info({ id, store, onClose, paperClass }: { id: string; store: ImageGenStore; onClose: () => void; paperClass?: string }) {
  const [img, setImg] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    imagegenApi.image(id).then(setImg, (e: unknown) => setError(errText(e)));
  }, [id]);
  return (
    <div className={`ig-panel ig-info${paperClass ? ` ${paperClass}` : ''}`} role="dialog" aria-label="这张图的说明和提示词" onClick={stop}>
      <div className="ig-head">
        <span className="ig-title">这张图</span>
        <button className="vn-pill ig-x" onClick={onClose}>
          关
        </button>
      </div>
      {error && <p className="ig-note">{error}</p>}
      {img && (
        <>
          {(img.title || img.description) && (
            <p className="ig-line">
              {img.title && <b>{img.title} · </b>}
              {img.description}
            </p>
          )}
          <p className="ig-note">
            {img.params.model} · {img.params.width}×{img.params.height} · {img.params.steps} 步 · 种子 {img.params.seed} ·{' '}
            {(img.ms / 1000).toFixed(1)} 秒 · {img.trigger === 'auto' ? '自动' : img.trigger === 'reroll' ? '换一张' : '手动'}
            {img.picture.pov ? ' · 第一人称' : ''}
            {img.params.reference ? ' · 带参考图' : ''}
          </p>
          <div className="ig-code-label">提示词</div>
          <pre className="ig-code">{img.prompt}</pre>
          {img.chars.map((c, i) => (
            <div key={i}>
              <div className="ig-code-label">第 {i + 1} 个人</div>
              <pre className="ig-code">{c.prompt}</pre>
            </div>
          ))}
          <div className="ig-code-label">反向</div>
          <pre className="ig-code">{img.negative}</pre>
          <div className="ig-actions">
            <button className="vn-pill" onClick={() => void store.keep(img.id)} disabled={Boolean(img.kept_asset_id)}>
              {img.kept_asset_id ? '已收藏' : '收藏进 CG 包'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function IgStage({ store, ctx }: { store: ImageGenStore; ctx: VnIllustrationContext }) {
  const [info, setInfo] = useState<string | null>(null);
  const mark = ctx.entry ? store.shownAt(ctx.entry, ctx.line) : null;
  // 平时只有一颗小按钮(插图 / 正在画时带个小点);鼠标指上去、或点一下才展开那一条
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const busy = store.jobs.length > 0;
  const markId = mark?.id ?? null;
  // 换到别的图(翻到下一句)就收起来
  useEffect(() => setPinned(false), [markId]);
  useEffect(() => () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
  }, []);
  const show = (mark || busy) && !store.panelOpen && !info;
  if (!show) {
    return (
      <>
        {store.panelOpen && <DrawPanel store={store} ctx={ctx} />}
        {info && !store.panelOpen && <Info id={info} store={store} paperClass={ctx.paperClass} onClose={() => setInfo(null)} />}
      </>
    );
  }
  const open = pinned || hover;
  const label = mark ? '这张插图' : 'AI 生图进度';
  const toggle = (
    <button
      type="button"
      className={`ig-toggle${busy ? ' busy' : ''}${open ? ' on' : ''}`}
      onClick={() => setPinned((v) => !v)}
      aria-expanded={open}
      aria-label={open ? `收起${label}的按钮` : label}
      title={open ? '收起' : mark ? '这张插图:换一张、收藏、收起、看说明' : '正在画'}
    >
      <BarIcon name="picture" />
    </button>
  );
  return (
    <div
      className={`ig-corner${open ? ' is-open' : ''}`}
      onClick={stop}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
        setHover(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        leaveTimer.current = window.setTimeout(() => setHover(false), 220);
      }}
    >
      {open && <Status store={store} />}
      <Tools store={store} ctx={ctx} mark={mark} open={open} toggle={toggle} onInfo={() => mark && setInfo(mark.id)} />
    </div>
  );
}
