/**
 * 语音页的快速预览(第 2 步 D6,画布 V6Voice):输一句(默认是内置例句)、挑一行语气(音色的情绪行)→「念一下」,
 * 用这张卡的音色合成;下面一行是播放键、波形、用的哪段参考音频和播到哪了。只放在这里,不写进对话。
 *
 * 两种画法,念的逻辑是同一份(useVoiceTry):
 *   VoicePreview       调试台 / 卡编辑器里「快速预览」那一块
 *   VoiceStagePreview  游戏菜单里(U25):实机预览舞台(她站在场景里,念的那句在对话区)→ 一排语气(点一个换一个)→ 试念 → 播放条
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { debugApi, sceneImageUrl, spriteImageUrl, type PackSprite, type SceneAsset, type VoiceProfile } from '../../../lib/api';
import { facesByCanvas, type SpriteStage } from '../../../plugins/spriteLayout';
import { DEFAULT_VOICE_SAMPLE, sampleIn, sampleLangOf } from '../../../plugins/voice';
import { FaceThumb } from '../../../studio/FaceThumb';
import { audioBus } from '../../../vn/audioBus';
import { Stage } from '../../../vn/ui/Stage';
import { voicePlayer } from '../../../vn/voice';
import { Icon } from '../../../studio/icons';
import { errText } from '../../pluginRunner';
import { Tip } from '../Tip';
import { peaks } from '../previewModel';
import { spriteForRow, usePackLayout } from './stageData';

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
        return <rect key={i} x={i * 5} y={(20 - h) / 2} width="3" height={h} rx="1.5" className={i / bars.length < played ? 'on' : ''} />;
      })}
    </svg>
  );
}

/** 念一句的状态和动作(两种画法共用) */
function useVoiceTry(main: VoiceProfile) {
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

  return { text, setText, rowId, setRowId, busy, error, take, elapsed, playing, speak, toggle };
}

type Tried = ReturnType<typeof useVoiceTry>;

/** 播放键 + 波形 + 用的哪段参考音频 + 播到哪了 */
function TakeBar({ v, className = 'dw-result dw-take' }: { v: Tried; className?: string }) {
  const { take, playing, elapsed } = v;
  if (!take) return null;
  return (
    <div className={className}>
      <button type="button" className="dw-play" aria-label={playing ? '停' : '播放'} onClick={v.toggle}>
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
  );
}

export function VoicePreview({ main }: { main: VoiceProfile }) {
  const v = useVoiceTry(main);
  return (
    <div className="dw-preview">
      <div className="dw-try">
        <input
          className="text-input dw-try-input"
          value={v.text}
          aria-label="试念的句子"
          onChange={(e) => v.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !v.busy) void v.speak();
          }}
        />
        {main.emotions.length > 0 && (
          <select className="text-input" aria-label="语气" value={v.rowId} onChange={(e) => v.setRowId(e.target.value)}>
            {main.emotions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn small" disabled={v.busy || !v.text.trim()} onClick={() => void v.speak()}>
          {v.busy ? '合成中…' : '念一下'}
        </button>
      </div>
      {v.error && <div className="dw-bad">{v.error}</div>}
      <TakeBar v={v} />
    </div>
  );
}

export function VoiceStagePreview({
  main,
  card,
  sprites,
  packId,
  stage,
  background,
  recentLines,
}: {
  main: VoiceProfile;
  card: { id: string; name: string };
  /** 这张卡启用的立绘:一行语气配哪张,名字对上的;对不上用默认表情 */
  sprites: readonly PackSprite[];
  packId: string | null;
  stage: SpriteStage;
  background: SceneAsset | null;
  /** 最近几句台词(只有看的是当前卡才有):点一句填进输入框 */
  recentLines: readonly string[];
}) {
  const v = useVoiceTry(main);
  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  const layout = usePackLayout(packId);
  const row = main.emotions.find((e) => e.id === v.rowId) ?? main.emotions[0] ?? null;
  const shown = (row ? spriteForRow(sprites, row) : null) ?? sprites[0] ?? null;
  const src = shown ? spriteImageUrl(shown) : null;
  const bgSrc = background ? sceneImageUrl(background) : null;
  // 换语气换立绘时放一次入场动效(第一次不放);用语气的编号当钥匙
  const [key, setKey] = useState(0);
  const pickRow = (id: string) => {
    if (id !== v.rowId) setKey((k) => k + 1);
    v.setRowId(id);
  };
  return (
    <div className="dw-stagebox">
      <Stage
        background={bgSrc ? { src: bgSrc, focus: background?.focus_x ?? 50 } : null}
        sprite={src && shown ? { src, face: faces.get(shown.id) ?? null, layout, stage, effect: shown.effect, playKey: key } : null}
        line={v.text.trim() ? { speaker: card.name, text: `「${v.text.trim()}」` } : null}
        label={
          <>
            试音台 · {main.name}
            {row ? (
              <>
                {' · '}
                <em>{row.label}</em>
              </>
            ) : null}
          </>
        }
      />
      {main.emotions.length > 0 && (
        <div
          className="dw-strip"
          role="group"
          aria-label={`语气 · ${main.emotions.length} 种`}
          style={{ '--n': main.emotions.length } as CSSProperties}
        >
          {main.emotions.map((e) => {
            const s = spriteForRow(sprites, e) ?? sprites[0] ?? null;
            return (
              <button
                key={e.id}
                type="button"
                className={e.id === row?.id ? 'cur' : ''}
                aria-pressed={e.id === row?.id}
                onClick={() => pickRow(e.id)}
              >
                <FaceThumb sprite={s} face={s ? (faces.get(s.id) ?? null) : null} className="dw-face-round" />
                <span className="lb">{e.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="dw-stage-try">
        <div className="dw-try">
          {/* 设计稿 .pl-try.voice:放大镜 + 输入框一体,长一点(440) */}
          <label className="dw-try-field wide">
            <Icon name="search" size={16} />
            <input
              className="text-input dw-try-input"
              value={v.text}
              aria-label="试念的句子"
              onChange={(e) => v.setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !v.busy) void v.speak();
              }}
            />
          </label>
          <button type="button" className="btn small" disabled={v.busy || !v.text.trim()} onClick={() => void v.speak()}>
            {v.busy ? '合成中…' : '念一下'}
          </button>
          <Tip k="preview_voice" />
        </div>
        {v.error && <div className="dw-bad">{v.error}</div>}
        {/* 试音条:还没念过时也摆着(设计稿 .pl-take.empty),念过换成波形 + 参考音频 */}
        {v.take ? (
          <TakeBar v={v} />
        ) : (
          <div className="dw-result dw-take empty" aria-hidden="true">
            <span className="dw-play">
              <svg width="12" height="12" viewBox="0 0 24 24">
                <path d="M8 5.5v13l10.5-6.5z" />
              </svg>
            </span>
            <span className="dw-take-dash" />
            <span className="dw-mono">还没念过</span>
          </div>
        )}
        {recentLines.length > 0 && (
          <div className="dw-recent" aria-label="最近的">
            {recentLines.slice(0, 3).map((t) => (
              <button key={t} type="button" className="dw-recent-chip" title={t} onClick={() => v.setText(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
