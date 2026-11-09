/**
 * 生图的小窗(11-07 效果图 2 的 B、效果图 4):加一条连接、测试出图。
 * 设置页(ImageGenSettings)和游戏里(VnControls:第一次点画笔的「去加」)都开它们;盖住整个画面、居中,Esc / 点外面关。
 * 样子照「画这一幕」那块(.ig-panel),纸面的地方传 paperClass(主题跟设置)
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { Tip } from '../../components/drawer/Tip';
import { ConnectionCards } from '../../vn/ModelWindow';
import type { CheckResult, ConnKind, ImageConn, TrialResult } from './api';
import {
  autoName,
  checkText,
  costPending,
  DRAWABLE_KINDS,
  keyHint,
  KIND_FIELDS,
  KIND_HINTS,
  KIND_NAMES,
  KIND_ORDER,
  LOCAL_SD,
  tidyUrl,
  timingParts,
  trialCost,
} from './connModel';
import { previewBlur, type PreviewFrame } from './preview';
import { IG_TIPS } from './tips';
import type { ImageGenStore } from './useImageGen';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stop = (e: SyntheticEvent) => e.stopPropagation();
/** 现在窗口多大(「跟屏幕走」按它定横竖) */
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/** 小窗外壳:标题(中文 + 英文小字)、右边一行小字、关;底下一排按钮 */
export function IgDialog({
  title,
  en,
  where,
  wide,
  paperClass,
  foot,
  onClose,
  children,
}: {
  title: string;
  en?: string;
  where?: string;
  wide?: boolean;
  paperClass?: string;
  foot?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);
  // 打开时焦点进窗口;键盘都在捕获阶段接住:Esc 关窗(不然游戏里的 Esc 会顺带开菜单、关设置),
  // 别的键不给后面的游戏(焦点在 body 或窗里的按钮上时,空格、回车会把对话翻一句)。输入框自己的按键照常
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      // 焦点不在窗里:别让空格滚动页面、回车点到后面的按钮
      if (!panelRef.current?.contains(el)) e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div
      className="ig-dialog-layer"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={stop}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`ig-panel ig-dialog${wide ? ' wide' : ''}${paperClass ? ` ${paperClass}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="ig-head">
          <span className="ig-title">
            {title}
            {en && <span className="ig-en inline">{en}</span>}
          </span>
          {where && <span className="ig-where">{where}</span>}
          <button type="button" className="vn-pill ig-x" onClick={onClose}>
            关 <span className="ig-kbd">Esc</span>
          </button>
        </div>
        {children}
        {foot && <div className="ig-actions">{foot}</div>}
      </div>
    </div>
  );
}

/**
 * 加一条连接(效果图 2 的 B):先三选一,只填那种要填的,点「连接」= 先建这条连接、再免费查一次;
 * 连上后自动起名(可以改)。没连上也留着这条(列表里能删),改了再点是改这一条,不会多出来。
 * 本地 SD 的「找一找」试本机 7860。中转站连上以后到画面页选模型(接口、可用尺寸、额外参数在连接页展开改)
 */
export function AddConnDialog({
  store,
  paperClass,
  onClose,
  onTrial,
}: {
  store: ImageGenStore;
  paperClass?: string;
  onClose: () => void;
  /** 连上以后「画一张试试」:关掉这个小窗、开测试出图;不给就没有这个按钮 */
  onTrial?: (connId: string) => void;
}) {
  const [kind, setKind] = useState<ConnKind>('openai');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  // 点过「连接」就建好了这一条;再点是改它
  const [made, setMade] = useState<ImageConn | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  // 玩家自己改过名字:连上以后不再自动起名
  const [named, setNamed] = useState(false);
  const fields = KIND_FIELDS[kind];
  const ready = !fields.url || tidyUrl(url) !== null;

  const pickKind = (k: ConnKind) => {
    // 建好以后种类就定了;没建之前换一种,上一种填的地址和 key 不带过去
    if (made) return;
    setKind(k);
    setUrl('');
    setKey('');
    setError(null);
  };
  // 通了以后又改地址、key:「通了」不算数了,「连接」按钮回来
  const edited = () => {
    if (result?.ok) setResult(null);
  };

  const connect = async (address: string = url) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const baseUrl = fields.url ? tidyUrl(address) : null;
      const apiKey = key.trim();
      let c = made
        ? await store.updateConn(made.id, { base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) })
        : await store.addConn({ kind, base_url: baseUrl, api_key: apiKey || null, name: autoName(kind, baseUrl, null) });
      setMade(c);
      setKey('');
      const r = await store.checkConn(c.id);
      setResult(r);
      // NovelAI 连上了:查一下账户,「画一张试试」按钮上的花费才准(不是 Opus 要扣 Anlas)
      if (r.ok && kind === 'novelai') void store.checkAccount(c.id);
      // 连上了:名字照查到的改一下(NovelAI 带上档位);玩家自己改过就不动
      const auto = autoName(kind, c.base_url, r.ok ? r.message : null);
      if (!named && auto !== c.name) {
        c = await store.updateConn(c.id, { name: auto });
        setMade(c);
      }
      if (!named) setName(c.name);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const saveName = async () => {
    const v = name.trim();
    if (!made || !v || v === made.name) return;
    try {
      setMade(await store.updateConn(made.id, { name: v }));
    } catch (e) {
      setError(errText(e));
    }
  };
  // 这张卡还没选画图连接:就用刚加的这条(点「好了」、点「画一张试试」都算)
  const adopt = (c: ImageConn) => {
    if (store.setup && !store.conn) store.setConn(c.id);
  };
  const done = async () => {
    await saveName();
    if (made) adopt(made);
    onClose();
  };
  // 中转站要先在画面页选模型,这里画不了
  const trialFor = made && result?.ok && onTrial && DRAWABLE_KINDS.includes(made.kind) && made.kind !== 'openai' ? made : null;

  return (
    <IgDialog
      title="加一条连接"
      en="New Connection"
      paperClass={paperClass}
      onClose={onClose}
      foot={
        <>
          {trialFor && onTrial && (
            <button
              type="button"
              className="vn-pill"
              disabled={costPending(trialFor, store.accounts, store.accountErrors)}
              onClick={() => {
                adopt(trialFor);
                onTrial(trialFor.id);
              }}
            >
              画一张试试 ·{' '}
              {trialCost(trialFor, store.configFor(trialFor.id), store.prefs, store.accounts[trialFor.id], Boolean(store.cardId), viewport())}
            </button>
          )}
          {!result?.ok && (
            <button type="button" className="vn-pill accent" disabled={busy || !ready} onClick={() => void connect()}>
              {busy ? '连接中…' : made ? '再连一次' : '连接'}
            </button>
          )}
          {made && (
            <button type="button" className="vn-pill accent" disabled={busy} onClick={() => void done()}>
              好了
            </button>
          )}
        </>
      }
    >
      <div className="ig-kinds">
        <ConnectionCards
          connections={KIND_ORDER.map((k) => ({ id: k, name: KIND_NAMES[k], type: '', model: KIND_HINTS[k], active: k === kind }))}
          now="选了"
          onPick={(k) => pickKind(k as ConnKind)}
        />
      </div>
      <div className="ig-fgrid">
        {fields.url && (
          <div className="ig-field">
            <span>
              地址
              {kind === 'sdapi' && <Tip text={IG_TIPS.sd_url} />}
            </span>
            <div className="ig-inline">
              <input
                className="ig-input ig-grow"
                value={url}
                placeholder={fields.urlPlaceholder}
                aria-label="地址"
                onChange={(e) => {
                  setUrl(e.target.value);
                  edited();
                }}
              />
              {kind === 'sdapi' && (
                <button
                  type="button"
                  className="vn-pill"
                  disabled={busy}
                  onClick={() => {
                    setUrl(LOCAL_SD);
                    void connect(LOCAL_SD);
                  }}
                >
                  找一找
                </button>
              )}
            </div>
          </div>
        )}
        <div className={`ig-field${fields.url ? '' : ' ig-span'}`}>
          <span>
            {fields.key}
            {kind === 'novelai' && <Tip text={IG_TIPS.token} />}
          </span>
          <input
            className="ig-input"
            type="password"
            autoComplete="off"
            aria-label={fields.key}
            value={key}
            placeholder={made ? keyHint(made, url) : fields.keyPlaceholder}
            onChange={(e) => {
              setKey(e.target.value);
              edited();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready && !busy) void connect();
            }}
          />
        </div>
      </div>
      {result &&
        (result.ok ? (
          <p className="ig-note ig-good">
            ✓ {checkText(result)}
            {made?.kind === 'openai' && ' · 下一步去「画面」选模型'}
          </p>
        ) : (
          <p className="vn-set-error ig-raw">{result.message}</p>
        ))}
      {error && <p className="vn-set-error ig-raw">{error}</p>}
      {made && (
        <label className="ig-field">
          <span>名字</span>
          <input
            className="ig-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNamed(true);
            }}
            onBlur={() => void saveName()}
          />
        </label>
      )}
    </IgDialog>
  );
}

/**
 * 测试出图(效果图 4):用这张卡的长相画一个固定场景,不经过指导模型、不进相册;显示图、正反提示词(能复制)、三段用时。
 * 只由按钮打开,打开它的按钮上写了花不花钱,点了就是要画:打开时画一张(StrictMode 下也只画一次),之后点「再画一张」。
 * 没画出来给接口回的原文(后端失败时不回提示词,这时只有原文)
 */
export function TrialDialog({
  store,
  connId,
  paperClass,
  onClose,
}: {
  store: ImageGenStore;
  connId: string;
  paperClass?: string;
  onClose: () => void;
}) {
  const conn = store.imageConns?.find((c) => c.id === connId) ?? null;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TrialResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'prompt' | 'negative' | null>(null);
  // 本地 SD 边画边来的预览;这一次画完就不要了
  const [live, setLive] = useState<PreviewFrame | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { testDraw, notify } = store;
  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setLive(null);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await testDraw(connId, setLive, ctl.signal);
      setResult(r);
    } catch (e) {
      setResult(null);
      setError(errText(e));
    } finally {
      setBusy(false);
      setLive(null);
    }
  }, [testDraw, connId]);
  // 关小窗时断开预览。StrictMode 开发时会先假卸载一次,所以等一拍看是不是真的卸载了
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) abort.current?.abort();
      });
    };
  }, []);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);
  const copy = (what: 'prompt' | 'negative', text: string) => {
    // 局域网用 http 打开时浏览器没有剪贴板
    const writing = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
    writing.then(
      () => {
        setCopied(what);
        window.setTimeout(() => setCopied(null), 1500);
      },
      () => notify('error', '复制失败:浏览器不让读写剪贴板,手动选中复制吧'),
    );
  };
  const parts = timingParts(result?.params.timing);
  const total = parts.reduce((n, p) => n + p.ms, 0);
  const join = (xs: string[]) =>
    xs
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');
  const prompt = result ? join([result.prompt, ...result.chars.map((c) => c.prompt)]) : '';
  const negative = result ? join([result.negative, ...result.chars.map((c) => c.negative)]) : '';
  const p = result?.params;
  const where = [store.cardId ? store.cardName : '', conn?.name ?? ''].filter(Boolean).join(' · ');
  const cost = conn
    ? trialCost(conn, store.configFor(conn.id), store.prefs, store.accounts[conn.id], Boolean(store.cardId), viewport())
    : '';
  return (
    <IgDialog
      title="测试出图"
      en="Test"
      wide
      where={where}
      paperClass={paperClass}
      onClose={onClose}
      foot={
        conn && (
          <button type="button" className="vn-pill accent" disabled={busy} onClick={() => void run()}>
            {busy ? '画着呢…' : `${error ? '再试一次' : '再画一张'} · ${cost}`}
          </button>
        )
      }
    >
      {busy && live && <img className="ig-trial-img ig-live" style={{ filter: `blur(${previewBlur(live.progress)}px)` }} src={live.src} alt="正在画" />}
      {busy && !result && !live && <p className="ig-note">画着呢…</p>}
      {error && (
        <div className="ig-trial-err" role="alert">
          <i aria-hidden="true">!</i>
          <div>
            <b>没画出来</b>
            <pre>{error}</pre>
          </div>
        </div>
      )}
      {result && p && (
        <>
          {!(busy && live) && <img className="ig-trial-img" src={`data:${result.mime};base64,${result.b64}`} alt="测试图" />}
          <p className="ig-note">
            {[p.model, p.width && p.height ? `${p.width} × ${p.height}` : '', p.seed !== undefined ? `种子 ${p.seed}` : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
          {parts.length > 0 && (
            <div className="ig-timing">
              <div className="ig-tbar" aria-hidden="true">
                {parts.map((x) => (
                  <i key={x.key} className={x.key} style={{ width: `${total ? (x.ms / total) * 100 : 0}%` }} />
                ))}
              </div>
              <div className="ig-tlabels">
                {parts.map((x) => (
                  <span key={x.key} className={x.key}>
                    {x.label} {(x.ms / 1000).toFixed(1)} 秒
                  </span>
                ))}
                <span className="sum">共 {(total / 1000).toFixed(1)} 秒</span>
              </div>
            </div>
          )}
          <div className="ig-code-label ig-code-head">
            正面提示词
            <button type="button" className="vn-pill ig-x" onClick={() => copy('prompt', prompt)}>
              {copied === 'prompt' ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="ig-code">{prompt || '(没有)'}</pre>
          <div className="ig-code-label ig-code-head">
            反向提示词
            <button type="button" className="vn-pill ig-x" onClick={() => copy('negative', negative)}>
              {copied === 'negative' ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="ig-code">{negative || '(没有)'}</pre>
        </>
      )}
    </IgDialog>
  );
}
