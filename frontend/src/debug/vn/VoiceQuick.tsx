/**
 * 右上角的语音标签和它的快捷面板。
 *
 * 标签:圆点颜色看语音连没连上(绿 = 通、红 = 断、黄 = 在测、灰 = 关了),合成中圆点会呼吸。
 * 进来、换卡时测一次主声音用的语音服务(只请求 /docs,很轻);测不通每 15 秒再测,
 * 台式机开机、服务起来之后自己变绿。播放器连续失败暂停(paused)也算断。
 * 面板:连接详情 + 重新检测,语音开关和音量;念法等更细的去完整设置或插件页。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type TtsConnection } from '../lib/api';
import { normalizeVoiceConfig, type VoiceCast, type VoicePluginConfig } from '../plugins/voice';
import { PROBE_INTERVAL_MS } from './useVoiceLine';
import { useVoice, voicePlayer } from './voice';
import { Seg } from './VNSettingsPage';

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
  /** 插件页的语音:换声音、试音、调参数 */
  onOpenPlugin: () => void;
}

export function VoiceQuick({
  cast,
  config,
  onChangeConfig,
  paused,
  synthesizing,
  onRetry,
  onOpenSettings,
  onOpenPlugin,
}: Props) {
  const voice = useVoice();
  const [open, setOpen] = useState(false);
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
                ? '语音合成已关闭'
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
            <dt>声音</dt>
            <dd>
              {cast.main ? `「${cast.main.name}」` : '没有主声音'}
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
              <span className="vn-vq-label">语音合成</span>
              <Seg
                options={[
                  { value: true, name: '开' },
                  { value: false, name: '关' },
                ]}
                value={config.enabled}
                onPick={(v) => setVoice('enabled', v)}
              />
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
                onOpenPlugin();
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
