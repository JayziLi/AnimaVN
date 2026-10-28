/**
 * 立绘页的快速预览(第 2 步 D6,画布 V6Sprite):
 *   AI 写  输一个表情词 →「试一下」:名字 / 别名对上、认词记录里记过就直接给;都没有时可以「让小模型猜」(只看结果,不记下)
 *   Jev 标 输一句台词 →「问 Jev」:只问谁说的和表情(带这张卡的表情名单和改过的问法);点一次问一次
 * 试的结果只放在这里:不写进对话、不改设置、不写认词记录。
 *
 * 两种画法,试的逻辑是同一份(useSpriteTry):
 *   SpritePreview       调试台 / 卡编辑器里「快速预览」那一块:输入框 + 结果一行
 *   SpriteStagePreview  游戏菜单里(U25):一块实机预览舞台 → 一排表情差分(点一张舞台换一张,播入场动效)→ 试一下;
 *                       试出来的表情也摆到舞台上
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { debugApi, sceneImageUrl, spriteImageUrl, type PackSprite, type SceneAsset, type WordRecordOut } from '../../../lib/api';
import type { TagMode } from '../../../plugins/common';
import { emotionCandidates, toRequestCandidate } from '../../../plugins/emotionMatch';
import { facesByCanvas, type SpriteStage } from '../../../plugins/spriteLayout';
import { FaceThumb } from '../../../studio/FaceThumb';
import { Stage } from '../../../vn/ui/Stage';
import type { JevControls } from '../../JevSettings';
import { errText } from '../../pluginRunner';
import { askRequest } from '../jevAsk';
import { resolveWordLocally } from '../previewModel';
import { Tip } from '../Tip';
import { usePackLayout } from './stageData';
import { TryLine } from './shared';

type AiResult =
  | { kind: 'hit'; word: string; sprite: PackSprite; how: 'name' | 'record' }
  | { kind: 'miss'; word: string }
  | { kind: 'guess'; word: string; sprite: PackSprite | null; name: string; score: number };

type JevResult = { line: string; emotion: string | null; sprite: PackSprite | null; conf: number | null; speaker: string | null };

const SPEAKER_TEXT: Record<string, string> = { user: '玩家说的', other: '别的角色说的', none: '不是在说话' };

interface TryProps {
  mode: TagMode;
  card: { id: string; name: string };
  /** 启用的立绘 */
  sprites: readonly PackSprite[];
  /** 认词记录的名单 */
  listRef: string;
  /** 最近几句角色的台词 / AI 写过的表情词(只在看的是当前卡时有) */
  recentLines: readonly string[];
  recentWords: readonly string[];
  jev: JevControls;
  /** 发给 Jev 的改过的问法(没改的不带) */
  prompt: Record<string, string>;
  userName: string;
  speakerThreshold: number;
  /** 「改这条记录」:打开高级 · 认词记录,选中这个词 */
  onEditRecord: (word: string) => void;
}

/** 试一下的状态和动作(两种画法共用) */
function useSpriteTry(p: TryProps) {
  const { mode, card, sprites, listRef, recentLines, recentWords, jev, prompt, userName, speakerThreshold } = p;
  const [word, setWord] = useState(recentWords[0] ?? '');
  const [line, setLine] = useState(recentLines[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiResult | null>(null);
  const [jevResult, setJevResult] = useState<JevResult | null>(null);
  // 认词记录按名单读一次就留着(只读,GET 不会记下什么)
  const [records, setRecords] = useState<{ listRef: string; list: WordRecordOut[] } | null>(null);
  const noKey = jev.keyStatus !== null && !jev.keyStatus.has_key;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const tryWord = () =>
    run(async () => {
      const w = word.trim();
      if (!w) return;
      let list = records?.listRef === listRef ? records.list : null;
      if (!list) {
        list = (await debugApi.emotionRecords(listRef)).records;
        setRecords({ listRef, list });
      }
      const hit = resolveWordLocally(w, sprites, list);
      setAi(hit ? { kind: 'hit', word: w, ...hit } : { kind: 'miss', word: w });
    });

  const guess = (w: string) =>
    run(async () => {
      const r = await debugApi.emotionMatch({ tags: [w], candidates: emotionCandidates(sprites).map(toRequestCandidate) });
      const top = r.results[0];
      if (!top) throw new Error('小模型没给结果');
      setAi({ kind: 'guess', word: w, sprite: sprites.find((s) => s.id === top.key) ?? null, name: top.name, score: top.score });
    });

  const askJev = () =>
    run(async () => {
      const text = line.trim();
      if (!text) return;
      const req = askRequest({
        kind: 'emotion',
        char: card.name,
        user: userName,
        line: text,
        sprites,
        bgs: [],
        bgms: [],
        cgs: [],
        thresholds: { speaker: speakerThreshold, bg: 0.6, bgm: 0.6, cg: 0.6 },
        prompts: prompt,
      });
      if (!req) return;
      const d = (await debugApi.annotateLines(req)).lines[0];
      setJevResult({
        line: text,
        emotion: d?.emotion ?? null,
        sprite: d?.emotion ? (sprites.find((s) => s.label === d.emotion) ?? null) : null,
        conf: d?.confidence.emotion ?? null,
        speaker: d?.speaker ?? null,
      });
    });

  /** 这次试出来的那张立绘(游戏皮把它摆到舞台上) */
  const found: PackSprite | null = mode === 'ai' ? (ai && ai.kind !== 'miss' ? ai.sprite : null) : (jevResult?.sprite ?? null);

  return { word, setWord, line, setLine, busy, error, ai, jevResult, noKey, tryWord, guess, askJev, found };
}

type Tried = ReturnType<typeof useSpriteTry>;

/** 输入框 + 试一下 + 结果一行(两种画法共用;face 画结果旁的小头像) */
function TryPanel({ p, t, face }: { p: TryProps; t: Tried; face: (s: PackSprite | null) => ReactNode }) {
  const { mode, jev, recentLines, recentWords, onEditRecord } = p;
  const { ai, jevResult, busy, error, noKey } = t;
  if (mode === 'ai') {
    return (
      <>
        <TryLine
          value={t.word}
          onChange={t.setWord}
          placeholder="AI 可能写的表情词,比如 才不是"
          button={busy ? '查找中…' : '试一下'}
          disabled={busy || !t.word.trim()}
          onTry={() => void t.tryWord()}
          recent={recentWords}
          tip="sprite_preview_ai"
        />
        {error && <div className="dw-bad">{error}</div>}
        {ai && (
          <div className="dw-result">
            {face(ai.kind === 'miss' ? null : ai.sprite)}
            <div className="dw-result-main">
              <span className="dw-result-name">
                {ai.kind === 'hit' ? ai.sprite.label : ai.kind === 'guess' ? (ai.sprite?.label ?? ai.name) : '记录里没有'}
              </span>
              <span className="dw-result-tags">
                {ai.kind === 'hit' && ai.how === 'record' && (
                  <>
                    <span className="dw-chip">认词记录 · {ai.word}</span>
                    <Tip k="from_record" />
                  </>
                )}
                {ai.kind === 'hit' && ai.how === 'name' && <span className="dw-chip">名字对上了</span>}
                {ai.kind === 'guess' && <span className="dw-chip">小模型猜的 · 相似度 {ai.score.toFixed(2)}</span>}
                {ai.kind === 'miss' && (
                  <>
                    <button type="button" className="btn small" disabled={busy} onClick={() => void t.guess(ai.word)}>
                      让小模型猜
                    </button>
                    <Tip k="guess_button" />
                  </>
                )}
              </span>
            </div>
            {ai.kind === 'hit' && ai.how === 'record' && (
              <button type="button" className="dw-inline-link" onClick={() => onEditRecord(ai.word)}>
                改这条记录
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <TryLine
        value={t.line}
        onChange={t.setLine}
        placeholder="输入一句台词"
        button={busy ? '问 Jev 中…' : '问 Jev'}
        disabled={busy || noKey || !t.line.trim()}
        onTry={() => void t.askJev()}
        recent={recentLines}
        tip="sprite_preview_jev"
        right={
          noKey && jev.openPage ? (
            <button type="button" className="dw-inline-link" onClick={jev.openPage}>
              去填 key
            </button>
          ) : undefined
        }
      />
      {error && <div className="dw-bad">{error}</div>}
      {jevResult && (
        <div className="dw-result">
          {face(jevResult.sprite)}
          <div className="dw-result-main">
            <span className="dw-result-name">{jevResult.emotion ?? '没判出表情'}</span>
            <span className="dw-result-tags">
              {jevResult.speaker && jevResult.speaker !== 'char' && (
                <span className="dw-chip">Jev 觉得是{SPEAKER_TEXT[jevResult.speaker] ?? jevResult.speaker}</span>
              )}
            </span>
          </div>
          {jevResult.conf !== null && <span className="dw-mono">把握 {jevResult.conf.toFixed(2)}</span>}
        </div>
      )}
    </>
  );
}

export function SpritePreview(p: TryProps) {
  const t = useSpriteTry(p);
  const faces = useMemo(() => facesByCanvas(p.sprites), [p.sprites]);
  if (p.sprites.length === 0) {
    return <div className="dw-line">{p.card.name}还没有立绘,先绑一套再试。</div>;
  }
  const face = (s: PackSprite | null) => <FaceThumb sprite={s} face={s ? (faces.get(s.id) ?? null) : null} className="dw-face-44" />;
  return (
    <div className="dw-preview">
      <TryPanel p={p} t={t} face={face} />
    </div>
  );
}

/** 一排表情差分:圆头像 + 名字,选中的白圈 + 墨线托住;点一张舞台换一张 */
export function FaceStrip({
  sprites,
  current,
  onPick,
  label,
}: {
  sprites: readonly PackSprite[];
  current: string | null;
  onPick: (s: PackSprite) => void;
  label: string;
}) {
  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  return (
    <div className="dw-strip" role="group" aria-label={label} style={{ '--n': Math.max(1, sprites.length) } as CSSProperties}>
      {sprites.map((s) => (
        <button
          key={s.id}
          type="button"
          className={s.id === current ? 'cur' : ''}
          aria-pressed={s.id === current}
          title={s.description || s.label}
          onClick={() => onPick(s)}
        >
          <FaceThumb sprite={s} face={faces.get(s.id) ?? null} className="dw-face-round" />
          <span className="lb">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SpriteStagePreview(
  p: TryProps & {
    packId: string | null;
    /** 所有角色共用的构图:人物大小、头的高度(右边「常用」的两根滑条) */
    stage: SpriteStage;
    /** 舞台后面那张背景:这张卡的第一张背景;没有就是黑底 */
    background: SceneAsset | null;
  },
) {
  const { sprites, card, stage } = p;
  const t = useSpriteTry(p);
  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  const layout = usePackLayout(p.packId);
  // 舞台上摆的那张:默认是排第一的(默认表情);点差分 / 试出结果就换,并播一次入场动效
  const [cur, setCur] = useState<{ id: string; key: number } | null>(null);
  const shown = sprites.find((s) => s.id === cur?.id) ?? sprites[0] ?? null;
  const pick = (s: PackSprite) => setCur((c) => ({ id: s.id, key: (c?.key ?? 0) + 1 }));
  const foundId = t.found?.id ?? null;
  const foundNonce = t.ai ?? t.jevResult;
  useEffect(() => {
    if (foundId) setCur((c) => ({ id: foundId, key: (c?.key ?? 0) + 1 }));
  }, [foundId, foundNonce]);

  if (sprites.length === 0 || !shown) {
    return <div className="dw-line">{card.name}还没有立绘,先绑一套再试。</div>;
  }
  const src = spriteImageUrl(shown);
  const bgSrc = p.background ? sceneImageUrl(p.background) : null;
  // 台词:最近一句;没有就拿这张差分的说明当台词
  const text = p.recentLines[0] || shown.description || '';
  const face = (s: PackSprite | null) => <FaceThumb sprite={s} face={s ? (faces.get(s.id) ?? null) : null} className="dw-face-44" />;
  return (
    <div className="dw-stagebox">
      <Stage
        background={bgSrc ? { src: bgSrc, focus: p.background?.focus_x ?? 50 } : null}
        sprite={src ? { src, face: faces.get(shown.id) ?? null, layout, stage, effect: shown.effect, playKey: cur?.key } : null}
        line={text ? { speaker: card.name, text } : null}
        label={
          <>
            实机预览{p.background ? ` · ${p.background.label}` : ''} · <em>{shown.label}</em>
          </>
        }
        guide={{ faceTop: stage.faceTop, text: `头的高度 ${stage.faceTop.toFixed(2)}` }}
      />
      <FaceStrip sprites={sprites} current={shown.id} onPick={pick} label={`表情差分 · ${sprites.length} 张`} />
      <div className="dw-stage-try">
        <TryPanel p={p} t={t} face={face} />
      </div>
    </div>
  );
}
