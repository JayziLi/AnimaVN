/**
 * 立绘页的快速预览(第 2 步 D6,画布 V6Sprite):
 *   AI 写  输一个表情词 →「试一下」:名字 / 别名对上、认词记录里记过就直接给;都没有时可以「让小模型猜」(只看结果,不记下)
 *   Jev 标 输一句台词 →「问 Jev」:只问谁说的和表情(带这张卡的表情名单和改过的问法);点一次问一次
 * 试的结果只放在这里:不写进对话、不改设置、不写认词记录。
 */

import { useMemo, useState } from 'react';
import { debugApi, type PackSprite, type WordRecordOut } from '../../../lib/api';
import type { TagMode } from '../../../plugins/common';
import { emotionCandidates, toRequestCandidate } from '../../../plugins/emotionMatch';
import { facesByCanvas } from '../../../plugins/spriteLayout';
import { FaceThumb } from '../../../studio/FaceThumb';
import type { JevControls } from '../../JevSettings';
import { errText } from '../../pluginRunner';
import { askRequest } from '../jevAsk';
import { resolveWordLocally } from '../previewModel';
import { Tip } from '../Tip';
import { TryLine } from './shared';

type AiResult =
  | { kind: 'hit'; word: string; sprite: PackSprite; how: 'name' | 'record' }
  | { kind: 'miss'; word: string }
  | { kind: 'guess'; word: string; sprite: PackSprite | null; name: string; score: number };

type JevResult = { line: string; emotion: string | null; sprite: PackSprite | null; conf: number | null; speaker: string | null };

const SPEAKER_TEXT: Record<string, string> = { user: '玩家说的', other: '别的角色说的', none: '不是在说话' };

export function SpritePreview({
  mode,
  card,
  sprites,
  listRef,
  recentLines,
  recentWords,
  jev,
  prompt,
  userName,
  speakerThreshold,
  onEditRecord,
}: {
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
}) {
  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
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

  if (sprites.length === 0) {
    return <div className="dw-line">{card.name}还没有立绘,先绑一套再试。</div>;
  }

  const face = (s: PackSprite | null) => <FaceThumb sprite={s} face={s ? (faces.get(s.id) ?? null) : null} className="dw-face-44" />;

  if (mode === 'ai') {
    return (
      <div className="dw-preview">
        <TryLine
          value={word}
          onChange={setWord}
          placeholder="AI 可能写的表情词,比如 才不是"
          button={busy ? '查找中…' : '试一下'}
          disabled={busy || !word.trim()}
          onTry={() => void tryWord()}
          recent={recentWords}
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
                    <button type="button" className="btn small" disabled={busy} onClick={() => void guess(ai.word)}>
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
      </div>
    );
  }

  return (
    <div className="dw-preview">
      <TryLine
        value={line}
        onChange={setLine}
        placeholder="输入一句台词"
        button={busy ? '问 Jev 中…' : '问 Jev'}
        disabled={busy || noKey || !line.trim()}
        onTry={() => void askJev()}
        recent={recentLines}
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
    </div>
  );
}
