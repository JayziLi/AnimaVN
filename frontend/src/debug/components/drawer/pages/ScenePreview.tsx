/**
 * 背景页的快速预览(第 2 步 D6,画布 V6Bg):上面一排这张卡能换的背景(前 7 张 +「+N」),下面试一下:
 *   AI 写  输一个场景名 → 名字 / 别名对上哪张(和游戏里认 <bg:…> 标签一样)
 *   Jev 标 输一句 →「问 Jev」:只问背景和 BGM(带这张卡的背景、BGM 名单和门槛);点一次问一次
 * 试的结果只放在这里:不写进对话、不改设置。
 *
 * 游戏菜单里(U25)换成实机预览舞台:
 *   SceneStagePreview  背景页:舞台 → 一排背景缩略图(点一张舞台换一张)→ 试一下(试出来的背景也摆上去)
 *                      CG 页:舞台(用选中的那张 CG)→ 一排 CG 缩略图
 *   TrackList          BGM 页:这张卡能放的曲子一首一行(曲子没有画面,不放舞台)
 */

import { useEffect, useMemo, useState } from 'react';
import { debugApi, sceneThumbUrl, spriteImageUrl, sceneImageUrl, type PackSprite, type SceneAsset } from '../../../lib/api';
import { resolveByLabel, type TagMode } from '../../../plugins/common';
import { facesByCanvas, type SpriteStage } from '../../../plugins/spriteLayout';
import { Stage } from '../../../vn/ui/Stage';
import type { JevControls } from '../../JevSettings';
import { errText } from '../../pluginRunner';
import { askRequest } from '../jevAsk';
import { TryLine } from './shared';
import { usePackLayout } from './stageData';

const SHOWN = 7;

type Result = { bg: SceneAsset | null; keep: string | null; bgm: string | null; conf: number | null; how: 'name' | 'jev' } | null;

function Thumb({ a, w, className }: { a: SceneAsset | null; w: number; className: string }) {
  const url = a ? sceneThumbUrl(a, w) : null;
  return url ? <img className={className} src={url} alt="" loading="lazy" /> : <span className={`${className} blank`} aria-hidden="true" />;
}

interface TryProps {
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
}

/** 试一下的状态和动作(两种画法共用) */
function useBgTry(p: TryProps) {
  const { mode, card, bgs, bgms, recentLines, jev, prompt, userName, thresholds } = p;
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
    setResult({ bg, keep: bg ? null : (here?.label ?? null), bgm: bgmOf(bg), conf: null, how: 'name' });
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

  return { input, setInput, busy, error, result, noKey, here, tryName, askJev };
}

type Tried = ReturnType<typeof useBgTry>;

/** 输入框 + 试一下 + 结果一行(两种画法共用) */
function TryPanel({ p, t }: { p: TryProps; t: Tried }) {
  const { mode, bgs, recentLines, jev } = p;
  const { busy, error, result, noKey, here } = t;
  return (
    <>
      {mode === 'ai' ? (
        <TryLine
          value={t.input}
          onChange={t.setInput}
          placeholder="AI 可能写的场景名"
          button="试一下"
          disabled={!t.input.trim()}
          onTry={t.tryName}
          recent={bgs.slice(0, 4).map((a) => a.label)}
          tip="bg_preview_ai"
        />
      ) : (
        <TryLine
          value={t.input}
          onChange={t.setInput}
          placeholder="输入一句,比如 走吧,去万民堂"
          button={busy ? '问 Jev 中…' : '问 Jev'}
          disabled={busy || noKey || !t.input.trim() || bgs.length < 2}
          onTry={() => void t.askJev()}
          recent={recentLines}
          tip="preview_bg"
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
            <span className="dw-result-name">{result.bg ? result.bg.label : result.how === 'name' ? '名字对不上' : '不换'}</span>
            <span className="dw-result-tags">
              {!result.bg && result.keep && <span className="dw-chip">还在「{result.keep}」</span>}
              {result.bgm && <span className="dw-chip">BGM · {result.bgm}</span>}
            </span>
          </div>
          {result.conf !== null && <span className="dw-mono">把握 {result.conf.toFixed(2)}</span>}
        </div>
      )}
    </>
  );
}

export function ScenePreview(p: TryProps) {
  const t = useBgTry(p);
  const { bgs, card } = p;
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
      <TryPanel p={p} t={t} />
    </div>
  );
}

/** 一排缩略图(背景或 CG):点一张舞台换一张;选中 = 白框 + 外面一圈墨线 */
function ThumbStrip({
  items,
  current,
  onPick,
  label,
}: {
  items: readonly SceneAsset[];
  current: string | null;
  onPick: (a: SceneAsset) => void;
  label: string;
}) {
  return (
    <div className="dw-thumbstrip" role="group" aria-label={label}>
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          className={a.id === current ? 'cur' : ''}
          aria-pressed={a.id === current}
          title={a.description || a.label}
          onClick={() => onPick(a)}
        >
          <Thumb a={a} w={200} className="dw-thumbstrip-img" />
          <span className="lb">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 舞台上陪着背景 / CG 站着的那张立绘:这张卡当前立绘包里排第一的 */
function useDefaultSprite(sprites: readonly PackSprite[]) {
  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  const first = sprites[0] ?? null;
  return { first, face: first ? (faces.get(first.id) ?? null) : null };
}

export function SceneStagePreview(
  p: TryProps & {
    kind: 'bg' | 'cg';
    /** 这张卡的 CG 构图(启用的) */
    cgs: readonly SceneAsset[];
    sprites: readonly PackSprite[];
    packId: string | null;
    stage: SpriteStage;
  },
) {
  const { kind, bgs, cgs, card, stage } = p;
  const t = useBgTry(p);
  const layout = usePackLayout(p.packId);
  const { first, face } = useDefaultSprite(p.sprites);
  const [pickedBg, setPickedBg] = useState<string | null>(null);
  const [pickedCg, setPickedCg] = useState<string | null>(null);
  const bg = bgs.find((b) => b.id === pickedBg) ?? bgs[0] ?? null;
  const cg = cgs.find((c) => c.id === pickedCg) ?? cgs[0] ?? null;
  // 试出来的背景也摆到舞台上
  const foundId = t.result?.bg?.id ?? null;
  useEffect(() => {
    if (foundId) setPickedBg(foundId);
  }, [foundId, t.result]);

  if (kind === 'bg' && bgs.length === 0) return <div className="dw-line">{card.name}还没有背景,先绑一个场景包再试。</div>;
  if (kind === 'cg' && cgs.length === 0) {
    return <div className="dw-blank">{card.name}还没有 CG</div>;
  }
  const bgSrc = bg ? sceneImageUrl(bg) : null;
  const cgSrc = kind === 'cg' && cg ? sceneImageUrl(cg) : null;
  const spriteSrc = first ? spriteImageUrl(first) : null;
  const text = p.recentLines[0] || first?.description || '';
  const items = kind === 'bg' ? bgs : cgs;
  const current = kind === 'bg' ? (bg?.id ?? null) : (cg?.id ?? null);
  return (
    <div className="dw-stagebox">
      <Stage
        background={bgSrc ? { src: bgSrc, focus: bg?.focus_x ?? 50 } : null}
        sprite={spriteSrc && first ? { src: spriteSrc, face, layout, stage } : null}
        cg={cgSrc && cg ? { src: cgSrc, focus: cg.focus_x ?? 50, mode: 'cover' } : null}
        line={text ? { speaker: card.name, text } : null}
        label={
          <>
            实机预览 · <em>{kind === 'bg' ? bg?.label : cg?.label}</em>
          </>
        }
      />
      <ThumbStrip
        items={items}
        current={current}
        onPick={(a) => (kind === 'bg' ? setPickedBg(a.id) : setPickedCg(a.id))}
        label={kind === 'bg' ? `场景 · ${bgs.length} 张` : `CG · ${cgs.length} 张`}
      />
      {kind === 'bg' && (
        <div className="dw-stage-try">
          <TryPanel p={p} t={t} />
        </div>
      )}
    </div>
  );
}

/** BGM 页中间:这张卡能放的曲子,一首一行(曲名 + 给 AI 看的说明) */
export function TrackList({ card, bgms }: { card: { name: string }; bgms: readonly SceneAsset[] }) {
  if (bgms.length === 0) return <div className="dw-blank">{card.name}还没有 BGM</div>;
  return (
    <div className="dw-tracks">
      <div className="dw-tracks-head">
        <span className="zh">曲目</span>
        <span className="en">Tracks</span>
        <span className="dw-mono">{bgms.length} 首</span>
      </div>
      <ul>
        {bgms.map((a) => (
          <li key={a.id}>
            <svg
              className="dw-ic"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9.5 17V5.5l9-1.8V15" />
              <circle cx="7" cy="17" r="2.5" />
              <circle cx="16" cy="15" r="2.5" />
            </svg>
            <span className="lb">{a.label}</span>
            <span className="tt">{a.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
