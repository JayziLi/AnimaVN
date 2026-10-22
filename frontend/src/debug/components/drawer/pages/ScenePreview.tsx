/**
 * 背景页的快速预览(第 2 步 D6,画布 V6Bg):上面一排这张卡能换的背景(前 7 张 +「+N」),下面试一下:
 *   AI 写  输一个场景名 → 名字 / 别名对上哪张(和游戏里认 <bg:…> 标签一样)
 *   Jev 标 输一句 →「问 Jev」:只问背景和 BGM(带这张卡的背景、BGM 名单和门槛);点一次问一次
 * 试的结果只放在这里:不写进对话、不改设置。
 */

import { useState } from 'react';
import { debugApi, sceneThumbUrl, type SceneAsset } from '../../../lib/api';
import { resolveByLabel, type TagMode } from '../../../plugins/common';
import type { JevControls } from '../../JevSettings';
import { errText } from '../../pluginRunner';
import { askRequest } from '../jevAsk';
import { TryLine } from './shared';

const SHOWN = 7;

type Result = { bg: SceneAsset | null; keep: string | null; bgm: string | null; conf: number | null; how: 'name' | 'jev' } | null;

function Thumb({ a, w, className }: { a: SceneAsset | null; w: number; className: string }) {
  const url = a ? sceneThumbUrl(a, w) : null;
  return url ? <img className={className} src={url} alt="" loading="lazy" /> : <span className={`${className} blank`} aria-hidden="true" />;
}

export function ScenePreview({
  mode,
  card,
  bgs,
  bgms,
  recentLines,
  jev,
  prompt,
  userName,
  thresholds,
}: {
  mode: TagMode;
  card: { id: string; name: string };
  /** 启用的背景、BGM(拼法和游戏一样) */
  bgs: readonly SceneAsset[];
  bgms: readonly SceneAsset[];
  recentLines: readonly string[];
  jev: JevControls;
  prompt: Record<string, string>;
  userName: string;
  thresholds: { bg: number; bgm: number };
}) {
  const [input, setInput] = useState(mode === 'ai' ? (bgs[1]?.label ?? bgs[0]?.label ?? '') : (recentLines[0] ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const noKey = jev.keyStatus !== null && !jev.keyStatus.has_key;
  // 试的时候当作还在第一张背景、放它的默认曲(还没聊的样子)
  const here = bgs[0] ?? null;
  const bgmOf = (bg: SceneAsset | null) => (bg?.bgm_id ? (bgms.find((m) => m.id === bg.bgm_id)?.label ?? null) : null);

  const tryName = () => {
    const bg = resolveByLabel(input, bgs);
    setError(null);
    setResult({ bg, keep: bg ? null : here?.label ?? null, bgm: bgmOf(bg), conf: null, how: 'name' });
  };

  const askJev = async () => {
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const req = askRequest({
        kind: 'bg',
        char: card.name,
        user: userName,
        line: text,
        sprites: [],
        bgs,
        bgms,
        cgs: [],
        thresholds: { speaker: jev.config.speakerThreshold, bg: thresholds.bg, bgm: thresholds.bgm, cg: 0.6 },
        prompts: prompt,
      });
      if (!req) return;
      const d = (await debugApi.annotateLines(req)).lines[0];
      const bg = d?.bg ? (bgs.find((b) => b.label === d.bg) ?? null) : null;
      setResult({
        bg,
        keep: bg ? null : (here?.label ?? null),
        bgm: d?.bgm ?? bgmOf(bg),
        conf: d?.confidence.bg ?? null,
        how: 'jev',
      });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (bgs.length === 0) return <div className="dw-line">{card.name}还没有背景,先绑一个场景包再试。</div>;

  return (
    <div className="dw-preview">
      <div className="dw-thumbs">
        {bgs.slice(0, SHOWN).map((a) => (
          <div key={a.id} className="dw-thumb" title={a.description || a.label}>
            <Thumb a={a} w={160} className="dw-thumb-img" />
            <span className="dw-thumb-name">{a.label}</span>
          </div>
        ))}
        {bgs.length > SHOWN && <div className="dw-thumb-more">+{bgs.length - SHOWN}</div>}
      </div>
      {mode === 'ai' ? (
        <TryLine
          value={input}
          onChange={setInput}
          placeholder="AI 可能写的场景名"
          button="试一下"
          disabled={!input.trim()}
          onTry={tryName}
          recent={bgs.slice(0, 4).map((a) => a.label)}
        />
      ) : (
        <TryLine
          value={input}
          onChange={setInput}
          placeholder="输入一句,比如 走吧,去万民堂"
          button={busy ? '问 Jev 中…' : '问 Jev'}
          disabled={busy || noKey || !input.trim() || bgs.length < 2}
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
      )}
      {mode === 'jev' && bgs.length < 2 && <div className="dw-muted">只有一张背景,Jev 没得挑。</div>}
      {error && <div className="dw-bad">{error}</div>}
      {result && (
        <div className="dw-result">
          <Thumb a={result.bg ?? here} w={160} className="dw-thumb-72" />
          <div className="dw-result-main">
            <span className="dw-result-name">
              {result.bg ? result.bg.label : result.how === 'name' ? '名字对不上' : '不换'}
            </span>
            <span className="dw-result-tags">
              {!result.bg && result.keep && <span className="dw-chip">还在「{result.keep}」</span>}
              {result.bgm && <span className="dw-chip">BGM · {result.bgm}</span>}
            </span>
          </div>
          {result.conf !== null && <span className="dw-mono">把握 {result.conf.toFixed(2)}</span>}
        </div>
      )}
    </div>
  );
}
