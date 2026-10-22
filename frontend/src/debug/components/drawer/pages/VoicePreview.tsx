/**
 * 语音页的快速预览(第 2 步 D6,画布 V6Voice):输一句(默认是内置例句)、挑一行语气(主声音的情绪行)→「念一下」,
 * 用这张卡的主声音合成;下面一行是播放键、波形、用的哪段参考音频和播到哪了。只放在这里,不写进对话。
 */

import { useEffect, useRef, useState } from 'react';
import { debugApi, type VoiceProfile } from '../../../lib/api';
import { DEFAULT_VOICE_SAMPLE, sampleIn, sampleLangOf } from '../../../plugins/voice';
import { audioBus } from '../../../vn/audioBus';
import { voicePlayer } from '../../../vn/voice';
import { errText } from '../../pluginRunner';
import { peaks } from '../previewModel';

const BARS = 46;

interface Take {
  audio: ArrayBuffer;
  bars: number[];
  duration: number;
  label: string;
}

/** 波形:播过的那段亮一点 */
function Wave({ bars, played }: { bars: readonly number[]; played: number }) {
  const w = bars.length * 5;
  return (
    <svg className="dw-wave" viewBox={`0 0 ${w} 20`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((v, i) => {
        const h = Math.max(3, v * 18);
        return (
          <rect
            key={i}
            x={i * 5}
            y={(20 - h) / 2}
            width="3"
            height={h}
            rx="1.5"
            className={i / bars.length < played ? 'on' : ''}
          />
        );
      })}
    </svg>
  );
}

export function VoicePreview({ main }: { main: VoiceProfile }) {
  const [text, setText] = useState(() => sampleIn(DEFAULT_VOICE_SAMPLE, sampleLangOf(main.text_lang)));
  const [rowId, setRowId] = useState(main.emotions[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  const stopClock = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  // 离开这一页:别让试听一直响
  useEffect(
    () => () => {
      stopClock();
      voicePlayer.stop();
    },
    [],
  );

  const play = async (t: Take) => {
    stopClock();
    await voicePlayer.playBuffer(t.audio);
    const start = performance.now();
    setPlaying(true);
    const tick = () => {
      const s = (performance.now() - start) / 1000;
      if (s >= t.duration) {
        setElapsed(t.duration);
        setPlaying(false);
        raf.current = null;
        return;
      }
      setElapsed(s);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const speak = async () => {
    const row = main.emotions.find((e) => e.id === rowId) ?? main.emotions[0];
    const line = text.trim();
    if (!line) return;
    // 在点击里解锁:合成要几秒,回来以后就不算用户手势了
    audioBus.unlock();
    setBusy(true);
    setError(null);
    try {
      const r = await debugApi.speak({
        profile_id: main.id,
        emotion: row?.label ?? null,
        ...(row ? { emotion_id: row.id } : {}),
        text: line,
      });
      const ctx = audioBus.context;
      if (!ctx) throw new Error('浏览器还没允许出声,先点一下页面再试');
      const buffer = await ctx.decodeAudioData(r.audio.slice(0));
      const t: Take = {
        audio: r.audio,
        bars: peaks(buffer.getChannelData(0), BARS),
        duration: buffer.duration,
        label: row?.label ?? r.emotion,
      };
      setTake(t);
      setElapsed(0);
      await play(t);
    } catch (e) {
      setError(`念不了:${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (!take) return;
    if (playing) {
      stopClock();
      voicePlayer.stop();
      setPlaying(false);
      return;
    }
    audioBus.unlock();
    setElapsed(0);
    void play(take).catch((e: unknown) => setError(`放不了:${errText(e)}`));
  };

  return (
    <div className="dw-preview">
      <div className="dw-try">
        <input
          className="text-input dw-try-input"
          value={text}
          aria-label="试念的句子"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) void speak();
          }}
        />
        {main.emotions.length > 0 && (
          <select className="text-input" aria-label="语气" value={rowId} onChange={(e) => setRowId(e.target.value)}>
            {main.emotions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn small" disabled={busy || !text.trim()} onClick={() => void speak()}>
          {busy ? '合成中…' : '念一下'}
        </button>
      </div>
      {error && <div className="dw-bad">{error}</div>}
      {take && (
        <div className="dw-result dw-take">
          <button type="button" className="dw-play" aria-label={playing ? '停' : '播放'} onClick={toggle}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24">
              {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5.5v13l10.5-6.5z" />}
            </svg>
          </button>
          <Wave bars={take.bars} played={take.duration ? elapsed / take.duration : 0} />
          <span className="dw-chip">{take.label} · 参考音频</span>
          <span className="dw-mono">
            {elapsed.toFixed(1)} / {take.duration.toFixed(1)} 秒
          </span>
        </div>
      )}
    </div>
  );
}
