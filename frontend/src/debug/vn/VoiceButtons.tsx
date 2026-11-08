/**
 * 一句语音的两颗小按钮:重播、重新生成。对话框和「历史」里共用。
 * 状态直接从播放器订阅,调用方只要给这句怎么念(SpeakRequest)。
 */

import type { SpeakRequest } from '../lib/api';
import { voiceKey } from '../plugins/voice';
import { GameIcon } from './ui/GameIcon';
import { MAX_FAILURES, useVoice, voicePlayer, type ClipState } from './voice';

function replayTitle(st: ClipState | undefined, wanted: string | null, paused: boolean): string {
  if (paused) return '语音暂停中 —— 点画面顶上的提示重试';
  if (!st) return '播放这句的语音';
  switch (st.state) {
    case 'queued':
      return '排队等合成…(好了就放)';
    case 'loading':
      return '合成中…(好了就放)';
    case 'error':
      return `✗ ${st.message} · 点一下重试`;
    case 'ready': {
      // 情绪表里没有立绘这个表情时,后端用的是默认情绪 —— 念出来就没那个味道
      const fallback = wanted && wanted !== st.emotion ? `(立绘是「${wanted}」,这个声音还没有这个情绪的参考)` : '';
      return `重播 · 用「${st.emotion}」的参考念的${fallback}`;
    }
  }
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path className="w1" d="M15.5 9.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path className="w2" d="M18 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M19.5 4.5v4.3h-4.3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 手机输入框上面那两颗的样子:只放图标,放在语音细条里 */
export function VoiceLineIconsView({
  paused,
  loading,
  busy,
  replayTitle: replayHint,
  onReplay,
  onRegenerate,
}: {
  /** 播放器连续失败、暂停了:两颗都点不了,先去喇叭面板里重连 */
  paused: boolean;
  /** 这句正在合成:重新生成先等着 */
  loading: boolean;
  /** 排队或合成中:重新生成那颗呼吸,点完有反应 */
  busy: boolean;
  replayTitle: string;
  onReplay: () => void;
  onRegenerate: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onReplay} disabled={paused} title={replayHint} aria-label="重听这一句">
        <GameIcon name="play" size={22} />
      </button>
      <button
        type="button"
        className={busy ? 'busy' : undefined}
        onClick={onRegenerate}
        disabled={paused || loading}
        title="重新生成这句语音:每次念法都不一样,新的替换掉旧的"
        aria-label="重新生成这句语音"
      >
        <GameIcon name="voice-regen" size={22} />
      </button>
    </>
  );
}

/** 手机输入框上面那两颗:重听、重新生成这句语音。状态直接从播放器订阅,和 VoiceButtons 同一个判断 */
export function VoiceLineIcons({ req, onAction }: { req: SpeakRequest; onAction?: () => void }) {
  const snap = useVoice();
  const st = snap.clips.get(voiceKey(req));
  const paused = snap.failures >= MAX_FAILURES;
  return (
    <VoiceLineIconsView
      paused={paused}
      loading={st?.state === 'loading'}
      busy={st?.state === 'queued' || st?.state === 'loading'}
      replayTitle={replayTitle(st, req.emotion, paused)}
      onReplay={() => {
        onAction?.();
        voicePlayer.replay(req);
      }}
      onRegenerate={() => {
        onAction?.();
        voicePlayer.regenerate(req);
      }}
    />
  );
}

export function VoiceButtons({
  req,
  onAction,
  className = '',
}: {
  req: SpeakRequest;
  /** 点了任何一颗之后(对话框用它放开「等语音」的闸门) */
  onAction?: () => void;
  className?: string;
}) {
  const snap = useVoice();
  const key = voiceKey(req);
  const st = snap.clips.get(key);
  const paused = snap.failures >= MAX_FAILURES;
  const busy = st?.state === 'queued' || st?.state === 'loading';
  const state = paused
    ? ''
    : snap.speaking === key
      ? ' speaking'
      : busy
        ? ' busy'
        : st?.state === 'error'
          ? ' error'
          : '';

  return (
    <span className={`vn-voice-ctl${state}${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          onAction?.();
          voicePlayer.replay(req);
        }}
        disabled={paused}
        title={replayTitle(st, req.emotion, paused)}
        aria-label="重播语音"
      >
        <SpeakerIcon />
      </button>
      <button
        type="button"
        onClick={() => {
          onAction?.();
          voicePlayer.regenerate(req);
        }}
        disabled={paused || st?.state === 'loading'}
        title="重新生成 —— 再合成一遍,每次念法都不一样;新的替换掉旧的"
        aria-label="重新生成语音"
      >
        <RedoIcon />
      </button>
    </span>
  );
}
