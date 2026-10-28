/**
 * 语音按钮和它的快捷面板。经典样子是右上角一枚标签(chip);第 5 段起游戏画面用 icon:右下那条细条里的「语音」图标,
 * 念的时候声波跳、合成中呼吸、关了变暗、断了变红(不弹提示,原因和「重新检测」写在面板顶上),面板往上弹。
 *
 * 标签:圆点颜色看语音连没连上(绿 = 通、红 = 断、黄 = 在测、灰 = 关了),合成中圆点会呼吸。
 * 进来、换卡时测一次主声音用的语音服务(只请求 /docs,很轻);测不通每 15 秒再测,
 * 台式机开机、服务起来之后自己变绿。播放器连续失败暂停(paused)也算断。
 * 面板:连接详情 + 重新检测,语音开关和音量;念法等更细的去完整设置,换声音、试音去插件页的语音。
 *
 * icon 的面板照设计稿 kit/scene.js 的 .ga-vq(10-25):纸卡跟主题,右下「语音」上方弹出;顶上「语音 Voice」+ 状态
 * (断了多一颗「重连」、下面一行出错原文),「音色」一行就地选(全部声音一列,不分她的 / 别人的,点一行马上换),
 * 「这一句」重播 / 重新生成,服务 / 模型,语音开关,音量,完整语音设置。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type TtsConnection } from '../lib/api';
import { normalizeVoiceConfig, type VoiceCast, type VoicePluginConfig } from '../plugins/voice';
import { PROBE_INTERVAL_MS } from './useVoiceLine';
import { MAX_FAILURES, useVoice, voicePlayer } from './voice';
import { VnSwitch } from './VnSwitch';
import { GameIcon } from './ui/GameIcon';
import { Range } from './ui/Range';
import { Switch } from './ui/Switch';
import { popThemeClass, type PopTheme } from './ui/logic';
import { voiceKey } from '../plugins/voice';
import type { SpeakRequest, VoiceProfile } from '../lib/api';

type Probe =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; ms: number; at: number }
  | { state: 'fail'; error: string };

/** 打开面板时,上次测通还不到这么久就不重测(刚测出的延迟别一闪变成「检测中」) */
const FRESH_MS = 10_000;

const API_NAMES: Record<TtsConnection['api_type'], string> = {
  gpt_sovits: 'GPT-SoVITS',
  indextts: 'IndexTTS',
};

interface Props {
  cast: VoiceCast;
  config: VoicePluginConfig;
  onChangeConfig: (next: VoicePluginConfig) => void;
  /** 播放器连续失败、暂停了 */
  paused: boolean;
  /** 当前这句的语音还在合成 */
  synthesizing: boolean;
  /** 清掉失败记录、重新预热(测通了顺手调) */
  onRetry: () => void;
  /** 菜单设置页的「声音」一栏 */
  onOpenSettings: () => void;
  /** 去插件页的语音:换主声音、试音 */
  onOpenVoice: () => void;
  /** chip = 右上角标签(旧);icon = 四角细条里的图标按钮,面板往上弹 */
  variant?: 'chip' | 'icon';
  /** 这句的语音正在念(icon 时声波跳) */
  speaking?: boolean;
  /** icon:面板是哪种纸卡(设置里的主题) */
  theme?: PopTheme;
  /** icon:「这一句」重播 / 重新生成念的是哪句;没有 = 这句不念 */
  request?: SpeakRequest | null;
  /** icon:点了「这一句」的两颗之后(对话框用它放开「等语音」的闸门) */
  onLineAction?: () => void;
  /** icon:「音色」那张短列表里的全部声音;不给 = 只显示现在用的,不能就地换 */
  profiles?: readonly VoiceProfile[];
  /** icon:点了列表里的一个声音(下一句起用它) */
  onPickVoice?: (id: string) => void;
  /** icon:面板里「模型」那一行 */
  modelLabel?: string | null;
}

/** 声音的语言小签:GPT-SoVITS 的 text_lang(ja / all_ja / zh / en …)写成中文 */
function langName(lang: string | null | undefined): string {
  const l = (lang ?? '').toLowerCase();
  if (l.includes('ja')) return '日语';
  if (l.includes('yue')) return '粤语';
  if (l.includes('zh')) return '中文';
  if (l.includes('en')) return '英语';
  if (l.includes('ko')) return '韩语';
  return l ? lang! : '';
}

export function VoiceQuick({
  cast,
  config,
  onChangeConfig,
  paused,
  synthesizing,
  onRetry,
  onOpenSettings,
  onOpenVoice,
  variant = 'chip',
  speaking = false,
  theme,
  request = null,
  onLineAction,
  profiles,
  onPickVoice,
  modelLabel,
}: Props) {
  const voice = useVoice();
  const [open, setOpen] = useState(false);
  // 「音色」那张短列表展开着没有;面板关上时一起收起
  const [listOpen, setListOpen] = useState(false);
  const pickRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) setListOpen(false);
  }, [open]);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const [conns, setConns] = useState<TtsConnection[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 测的时候换了卡 / 又点了一次,旧结果不要
  const probeSeq = useRef(0);

  const profile = cast.main ?? cast.extras[0] ?? null;
  const connId = profile?.connection_id ?? null;
  const conn = conns?.find((c) => c.id === connId) ?? null;

  const runProbe = (thenRetry: boolean) => {
    if (!connId) return;
    const seq = ++probeSeq.current;
    setProbe({ state: 'testing' });
    debugApi.testTtsConnection(connId).then(
      (r) => {
        if (seq !== probeSeq.current) return;
        setProbe({ state: 'ok', ms: r.ms, at: Date.now() });
        if (thenRetry) onRetry();
      },
      (err: unknown) => {
        if (seq !== probeSeq.current) return;
        setProbe({ state: 'fail', error: err instanceof Error ? err.message : String(err) });
      },
    );
  };

  // 进来、换了服务、重新打开语音时测一次
  useEffect(() => {
    if (config.enabled && connId) runProbe(false);
    else {
      probeSeq.current++;
      setProbe({ state: 'idle' });
    }
    // runProbe 每次渲染都是新的,只看这两个
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, connId]);

  // 测不通就隔一会儿再测;通了且播放器还暂停着,顺手恢复
  useEffect(() => {
    if (probe.state !== 'fail' || !config.enabled) return;
    const t = window.setTimeout(() => runProbe(paused), PROBE_INTERVAL_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, config.enabled, paused]);

  // 播放器从暂停里恢复了(它自己的探测测通了):标签跟着变回去
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (wasPaused.current && !paused && config.enabled) runProbe(false);
    wasPaused.current = paused;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // 打开面板:拿连接详情(名字、地址),再测一次
  useEffect(() => {
    if (!open) return;
    debugApi.listTtsConnections().then(setConns, () => setConns([]));
    const fresh = probe.state === 'ok' && Date.now() - probe.at < FRESH_MS;
    if (config.enabled && !fresh) runProbe(paused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 点外面、按 Esc 收起。Esc 在捕获阶段拦下,不然画面上的 Esc 会顺带打开菜单
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const status: 'off' | 'fail' | 'testing' | 'ok' | 'idle' = !config.enabled
    ? 'off'
    : paused || probe.state === 'fail'
      ? 'fail'
      : probe.state;
  const chipText =
    status === 'off'
      ? '语音关'
      : status === 'fail'
        ? '语音断了'
        : status === 'testing'
          ? '语音 · 检测中'
          : probe.state === 'ok'
            ? `语音 ${probe.ms}ms`
            : '语音';
  const failError = probe.state === 'fail' ? probe.error : voice.lastError;

  const setVoice = <K extends keyof VoicePluginConfig>(k: K, v: VoicePluginConfig[K]) =>
    onChangeConfig(normalizeVoiceConfig({ ...config, [k]: v }));

  if (variant === 'icon') {
    // 「这一句」那两颗:这句的语音在合成时「重新生成」先等着;播放器连续失败暂停了两颗都点不了(先「重连」)
    const clip = request ? voice.clips.get(voiceKey(request)) : undefined;
    const stalled = voice.failures >= MAX_FAILURES || status === 'fail';
    const lineOff = !request || stalled || !config.enabled;
    const main = cast.main;
    const list = profiles ?? (main ? [main] : []);
    const vol = Math.round(voice.volume * 100);
    const stateText =
      status === 'off'
        ? '语音已关闭'
        : status === 'fail'
          ? '连不上了'
          : status === 'testing'
            ? '正在检测…'
            : probe.state === 'ok'
              ? `已连接 · ${probe.ms} ms`
              : '还没检测';
    const dot = status === 'ok' ? ' good' : status === 'fail' ? ' bad' : status === 'testing' ? ' warn' : '';
    const pick = (id: string) => {
      setListOpen(false);
      if (id !== main?.id) onPickVoice?.(id);
      window.setTimeout(() => pickRef.current?.focus({ preventScroll: true }), 30);
    };
    return (
      <div className="vn-vq as-icon" ref={rootRef} onClick={(e) => e.stopPropagation()}>
        <button
          className={`vn-vq-btn ${status}${open ? ' on' : ''}${speaking && status !== 'off' ? ' speaking' : ''}${synthesizing && status !== 'fail' ? ' busy' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={status === 'fail' ? '语音(断了)' : '语音'}
          title={status === 'fail' ? '语音断了:点开看原因、重连' : '语音:音色、重播这句、开关、音量'}
        >
          <GameIcon name="voice" size={22} />
        </button>
        <div
          className={`ga-vq av-pcard ${popThemeClass(theme)}${open ? ' on' : ''}${listOpen ? ' vlist-on' : ''}${status === 'fail' ? ' verr' : ''}${config.enabled ? '' : ' voice-off'}`}
          role="dialog"
          aria-label="语音"
          inert={!open}
        >
          <div className="ga-vq-h">
            <span className="zh">语音</span>
            <span className="en">Voice</span>
            <span className="st">
              <i className={`av-dot${dot}`} aria-hidden="true" />
              <span className="stt">{stateText}</span>
            </span>
            {status === 'fail' && (
              <button type="button" className="av-btn sm ga-vq-re" onClick={() => runProbe(true)} disabled={!connId}>
                重连
              </button>
            )}
          </div>
          {status === 'fail' && failError && <p className="ga-vq-err">{failError}</p>}
          <div className="ga-vq-tone">
            <button
              ref={pickRef}
              type="button"
              className="ga-vq-pick"
              onClick={() => (onPickVoice && list.length > 0 ? setListOpen((v) => !v) : onOpenVoice())}
              aria-haspopup="listbox"
              aria-expanded={listOpen}
              aria-label={main ? `音色:${main.name}(点开换)` : '音色:还没有(点开选一个)'}
            >
              <span className="k">音色</span>
              <span className="nm">{main ? main.name : '还没有音色'}</span>
              {main && langName(main.text_lang) && <span className="av-chip ga-vq-lg">{langName(main.text_lang)}</span>}
              <GameIcon name="down" size={16} />
            </button>
            <div className="ga-vq-list" role="listbox" aria-label="音色">
              {list.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="option"
                  aria-selected={v.id === main?.id}
                  className={`ga-vq-opt${v.id === main?.id ? ' on' : ''}`}
                  onClick={() => pick(v.id)}
                >
                  <span className="nm">{v.name}</span>
                  {langName(v.text_lang) && <span className="av-chip ga-vq-lg">{langName(v.text_lang)}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="ga-vq-line">
            <span className="k">这一句</span>
            <button
              type="button"
              className="av-btn sm"
              disabled={lineOff}
              onClick={() => {
                if (!request) return;
                onLineAction?.();
                voicePlayer.replay(request);
              }}
            >
              <GameIcon name="voice" size={15} />
              重播
            </button>
            <button
              type="button"
              className="av-btn sm"
              disabled={lineOff || clip?.state === 'loading'}
              title="再合成一遍,每次念法都不一样;新的替换掉旧的"
              onClick={() => {
                if (!request) return;
                onLineAction?.();
                voicePlayer.regenerate(request);
              }}
            >
              <GameIcon name="retry" size={15} />
              重新生成
            </button>
          </div>
          <dl className="ga-vq-dl">
            <dt>服务</dt>
            <dd title={conn?.base_url}>
              {conn ? (
                <>
                  {conn.name}
                  {/* 名字里已经写了引擎(「5090 · GPT-SoVITS」)就不再重复 */}
                  {!conn.name.toLowerCase().includes(API_NAMES[conn.api_type].toLowerCase()) && ` · ${API_NAMES[conn.api_type]}`}
                </>
              ) : conns === null ? (
                '读取中…'
              ) : connId ? (
                '找不到这个声音用的服务'
              ) : (
                '—'
              )}
            </dd>
            {modelLabel && (
              <>
                <dt>模型</dt>
                <dd>{modelLabel}</dd>
              </>
            )}
          </dl>
          <div className="ga-vq-row">
            <span className="k">语音</span>
            <Switch label="语音开关" checked={config.enabled} onChange={(v) => setVoice('enabled', v)} />
          </div>
          <div className="ga-vq-row ga-vq-vol">
            <span className="k">音量</span>
            <Range
              label="语音音量"
              min={0}
              max={100}
              value={vol}
              onChange={(v) => {
                voicePlayer.setVolume(v / 100);
                if (voice.muted) voicePlayer.setMuted(false);
              }}
            />
            {/* 百分比点一下 = 静音 / 取消静音(原来那颗「静音」按钮) */}
            <button
              type="button"
              className={`av-num ga-vq-mute${voice.muted ? ' on' : ''}`}
              onClick={() => voicePlayer.setMuted(!voice.muted)}
              aria-pressed={voice.muted}
              title={voice.muted ? '取消静音' : '静音'}
            >
              {voice.muted ? '静音' : `${vol}%`}
            </button>
          </div>
          <div className="ga-vq-foot">
            <button
              type="button"
              className="av-btn sm"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              完整语音设置
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vn-vq" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button
        className={`vn-chip vn-vq-chip ${status}${synthesizing && status !== 'fail' ? ' busy' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={status === 'fail' && failError ? `语音连不上:${failError}` : '语音状态和快捷设置'}
      >
        <span className="vn-vq-dot" aria-hidden="true" />
        {chipText}
      </button>

      {open && (
        <div className="vn-vq-panel" role="dialog" aria-label="语音快捷设置">
          <div className="vn-vq-status">
            <span className={`vn-vq-dot ${status}`} aria-hidden="true" />
            <span className="vn-vq-state">
              {status === 'off'
                ? '语音已关闭'
                : status === 'fail'
                  ? paused
                    ? '连续失败,暂停中'
                    : '连不上语音服务'
                  : status === 'testing'
                    ? '正在检测…'
                    : probe.state === 'ok'
                      ? `已连接 · ${probe.ms} ms`
                      : '还没检测'}
            </span>
            <button
              className="vn-pill vn-vq-test"
              onClick={() => runProbe(true)}
              disabled={!connId || status === 'testing'}
            >
              重新检测
            </button>
          </div>
          {status === 'fail' && failError && <p className="vn-vq-error">{failError}</p>}
          <dl className="vn-vq-info">
            <dt>音色</dt>
            <dd>
              {cast.main ? `「${cast.main.name}」` : '没有音色'}
              {cast.extras.length > 0 && <span className="vn-vq-dim"> · 另有 {cast.extras.length} 个配角声音</span>}
            </dd>
            <dt>服务</dt>
            <dd>
              {conn ? (
                <>
                  {conn.name}
                  {/* 名字里已经写了引擎(「5090 · GPT-SoVITS」)就不再重复 */}
                  {!conn.name.toLowerCase().includes(API_NAMES[conn.api_type].toLowerCase()) && (
                    <span className="vn-vq-dim"> · {API_NAMES[conn.api_type]}</span>
                  )}
                  <span className="vn-vq-url">{conn.base_url}</span>
                </>
              ) : conns === null ? (
                <span className="vn-vq-dim">读取中…</span>
              ) : (
                <span className="vn-vq-dim">找不到这个声音用的服务</span>
              )}
            </dd>
          </dl>

          <div className="vn-vq-rows">
            <div className="vn-vq-row">
              <span className="vn-vq-label">语音</span>
              <VnSwitch label="语音" checked={config.enabled} onChange={(v) => setVoice('enabled', v)} />
            </div>
            {config.enabled && (
              <div className="vn-vq-row">
                <span className="vn-vq-label">音量</span>
                <div className="vn-vq-volume">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(voice.volume * 100)}
                    aria-label="语音音量"
                    onChange={(e) => {
                      voicePlayer.setVolume(Number(e.target.value) / 100);
                      if (voice.muted) voicePlayer.setMuted(false);
                    }}
                  />
                  <button
                    className={`vn-pill vn-vq-mute${voice.muted ? ' on' : ''}`}
                    onClick={() => voicePlayer.setMuted(!voice.muted)}
                    aria-pressed={voice.muted}
                  >
                    {voice.muted ? '静音' : `${Math.round(voice.volume * 100)}%`}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="vn-vq-foot">
            <button
              className="vn-pill"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              完整语音设置
            </button>
            <button
              className="vn-pill"
              onClick={() => {
                setOpen(false);
                onOpenVoice();
              }}
            >
              换声音 · 试音
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
