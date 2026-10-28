/**
 * 局内菜单的「开发者」页(界面统一计划 U31,设计稿 docs/design/unify/tools.html #a 的开发者页):
 * 模型这条回复的完整原文,以及每个标签落在哪一句、对上了哪个素材。原来是 VNScreen.tsx 里的 ConsoleView,拆出来换了纸面皮。
 *
 *   左边  此刻 / 标签表 / 语音表 / 模型完整输出,四块照旧;标签表占主区
 *   右边  一块小舞台(vn/ui/Stage,和游戏里一样的画面):点标签表或语音表的一行,舞台换成那一句的表情差分、背景和台词,
 *         舞台下面写这一句的细节;一行都没点时看的是游戏里光标停着的那一句
 *
 * 颜色:纸、墨、细线全是 --av-*(跟设置里的主题);选中是白纸浮起 + 左边一道墨线,不跟角色色;
 * 只有真出错(标签对不上、语音合成失败、Jev 没判成)才是红字 + 红圆「!」,报错给后端 / 模型的英文原文;
 * Jev 的统计、没有标签的提示这类正常说明用普通字色。样式在 console/console.css(cv-*),逻辑在 console/logic.ts。
 */

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Beat } from '../core/beats';
import { stateAt, type Timeline } from '../core/timeline';
import {
  sceneImageUrl,
  spriteImageUrl,
  type PackSprite,
  type SceneAsset,
  type SpeakRequest,
  type SpriteLayout,
} from '../lib/api';
import { currentInfo } from '../lib/chatEntry';
import type { EmotionContext } from '../plugins/emotionMatch';
import { jevKindsOf } from '../plugins/jev';
import { entryView } from '../plugins/jevNotes';
import { kindName } from '../plugins/registry';
import type { SceneState } from '../plugins/scene';
import { facesByCanvas, type SpriteStage } from '../plugins/spriteLayout';
import {
  EMO_MODE_TEXT,
  spriteHitsUpTo,
  voiceForSpeaker,
  voiceKey,
  voiceSkipReason,
  type VoiceCast,
} from '../plugins/voice';
import {
  BGM_FROM,
  clipStatus,
  hitVerdict,
  hitWhere,
  isMiss,
  pickedLine,
  rawSegments,
  resolveTag,
  type RowPick,
  type Verdict,
} from './console/logic';
import './console/console.css';
import type { TagKind } from './script';
import { Help } from './ui/Help';
import { PaperButton } from './ui/PaperButton';
import { Stage } from './ui/Stage';
import type { ClipState } from './voice';

export interface ConsoleVoice {
  enabled: boolean;
  /** 情绪不变:不等模型认表情 */
  fixedEmotion: boolean;
  cast: VoiceCast;
  plans: readonly (SpeakRequest | null)[];
  clips: ReadonlyMap<string, ClipState>;
  paused: boolean;
  lastError: string | null;
  charName: string;
  streaming: boolean;
}

export interface ConsoleViewProps {
  beat: Beat | null;
  /** 这是第几条(只数 AI 回复) */
  beatNumber: number;
  /** 光标在第几条回复、第几句:没点任何一行时右边的舞台看这一句 */
  beatIndex: number;
  line: number;
  /** 游戏里的时间线:点一行时按它查那一句的表情、背景、CG,和舞台上放的一模一样 */
  timeline: Timeline;
  sprites: PackSprite[];
  spriteStage: SpriteStage;
  spriteLayout: SpriteLayout;
  /** 立绘标签的匹配(精确 / 模型) */
  emotion: EmotionContext;
  tagKinds: TagKind[];
  sceneAssets: SceneAsset[];
  scene: SceneState;
  voice: ConsoleVoice;
  /** 「回到调试台」 */
  onExit: () => void;
}

/** 出错的一行:红色圆底「!」+ 红字(正文是后端 / 模型的原文,不翻译) */
function Err({ children }: { children: ReactNode }) {
  return (
    <span className="cv-err">
      <i aria-hidden="true">!</i>
      <span>{children}</span>
    </span>
  );
}

/** 匹配结果:对上了是淡绿的 ✓ / ≈,还在认和不用对的是普通字,对不上才是红 */
function VerdictText({ v }: { v: Verdict }) {
  if (isMiss(v)) return <Err>{v.text}</Err>;
  return (
    <span className={`cv-v ${v.mark === '✓' || v.mark === '≈' ? 'ok' : 'plain'}`}>
      <b aria-hidden="true">{v.mark}</b> {v.text}
    </span>
  );
}

function Head({ zh, en, tip, children }: { zh: string; en: string; tip?: string; children?: ReactNode }) {
  return (
    <div className="cv-sh">
      <span className="zh">{zh}</span>
      <span className="en">{en}</span>
      {tip && <Help tip={tip} />}
      {children}
    </div>
  );
}

/** 「?」里的话(设计稿 creator.js 的 devPage / match) */
const TIP = {
  page: '只看「这一条」回复。整段提示词怎么拼的、每块多少 token,在完整调试台的提示词检查器里。',
  match: '✓ = 对上了(认词记录 / 名字对上);≈ = 小模型认的(带分数);! = 没对上,保持上一张;… = 还在认。',
} as const;

const STAR = (
  <svg className="av-star" viewBox="-10 -10 20 20" aria-hidden="true">
    <path d="M0-10C1.1-2.6 2.6-1.1 10 0 2.6 1.1 1.1 2.6 0 10-1.1 2.6-2.6 1.1-10 0-2.6-1.1-1.1-2.6 0-10Z" />
  </svg>
);

/** 一行可点:鼠标点、键盘 Enter / 空格都行 */
function rowProps(on: boolean, pick: () => void) {
  return {
    className: on ? 'on' : undefined,
    tabIndex: 0,
    'aria-current': on ? ('true' as const) : undefined,
    onClick: pick,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    },
  };
}

/** 开发者页:模型这条回复的完整原文,以及每个标签落在哪一句、对上了哪个素材 */
export function ConsoleView({
  beat,
  beatNumber,
  beatIndex,
  line,
  timeline,
  sprites,
  spriteStage,
  spriteLayout,
  emotion,
  tagKinds,
  sceneAssets,
  scene,
  voice,
  onExit,
}: ConsoleViewProps) {
  const raw = beat?.raw ?? '';
  const hits = useMemo(() => beat?.parsed?.hits ?? [], [beat]);
  const lines = useMemo(() => beat?.parsed?.lines ?? [], [beat]);
  // 点中的那一行只属于这一条回复这个分支:换了回复 / 分支就当没点
  const beatKey = beat ? `${beat.entry.id}:${beat.entry.swipeIndex}` : '';
  const [picked, setPicked] = useState<{ key: string; row: RowPick } | null>(null);
  const pick = picked?.key === beatKey ? picked.row : null;
  const setPick = (row: RowPick | null) => setPicked(row ? { key: beatKey, row } : null);

  const matchCtx = useMemo(() => ({ emotion, sprites, sceneAssets }), [emotion, sprites, sceneAssets]);

  // 原文里把几类标签都标出来
  const segs = useMemo(
    () => rawSegments(raw, tagKinds, (kind, label) => !isMiss(resolveTag(kind, label, matchCtx))),
    [raw, tagKinds, matchCtx],
  );

  const broken = tagKinds.filter((k) => !k.pattern).map((k) => kindName(k.kind));
  const jev = beat ? currentInfo(beat.entry)?.jev : undefined;
  const jevDropped = beat && jev ? entryView(beat.entry, tagKinds).dropped : 0;
  const jevPending = beat?.entry.jevPending;
  const jevSprite = beat ? jevKindsOf(beat.entry).includes('sprite') : false;

  // 语音表:每句一行。右边舞台下面也要看选中那一句,所以先算好
  const voiceRows = useMemo(
    () =>
      lines.map((ln, i) => {
        const plan = voice.plans[i] ?? null;
        const profile = ln.player ? null : voiceForSpeaker(ln.speaker, voice.charName, voice.cast);
        const st = plan ? voice.clips.get(voiceKey(plan)) : undefined;
        const why = voiceSkipReason(ln, profile, {
          streamingLast: voice.streaming && i === lines.length - 1,
          pendingTag:
            !voice.fixedEmotion &&
            spriteHitsUpTo(hits, i, voice.charName).some((h) => emotion.resolve(h.label).state === 'pending'),
          jevPending: jevPending !== undefined && i >= jevPending,
          jev: jevSprite,
        });
        const actual = st?.state === 'ready' && st.emotion !== (plan?.emotion ?? '') ? ` → ${st.emotion}` : '';
        return {
          who: `${ln.untagged ? '(没写立绘标签)' : (ln.speaker ?? '旁白')}${profile ? ` → ${profile.name}` : ''}`,
          emotion: plan ? `${plan.emotion ?? '(默认)'}${actual}` : '—',
          mode: st?.state === 'ready' ? EMO_MODE_TEXT[st.mode] : '—',
          // 没请求的句子写为什么不念(旁白、没声音……),请求了的写合成状态
          status: plan ? clipStatus(st) : { text: why, error: false, ok: false },
          // 实际送去合成的字(日语声音念的是日语)
          synth: plan?.text ?? null,
        };
      }),
    [lines, hits, voice, emotion, jevPending, jevSprite],
  );

  // ---- 右边的舞台:点中那句(或光标那句)在游戏里的样子 ----
  const faces = useMemo(() => facesByCanvas(sprites), [sprites]);
  const at = pickedLine(pick, hits, lines.length, line);
  const state = stateAt(timeline, beatIndex, at);
  const shown = sprites.find((s) => s.label === state.shownLabel) ?? sprites[0] ?? null;
  const shownSrc = shown?.has_image ? spriteImageUrl(shown) : null;
  const bg = state.scene.bg;
  const cg = state.cgFrame;
  const bgSrc = bg ? sceneImageUrl(bg) : null;
  const cgSrc = cg ? sceneImageUrl(cg) : null;
  const ln = lines[at];
  const pickedHit = pick?.table === 'tag' ? hits[pick.index] : null;
  const vr = voiceRows[at];
  const hasLine = Boolean(beat && ln);
  const emotionName = state.shownLabel ?? (sprites.length === 0 ? '内置表情' : '无');

  return (
    <div className="cv">
      <div className="cv-main">
        <div className="cv-bar">
          <span className="cv-dim">
            当前这条回复的原文和标签;提示词检查器在完整调试台里
            <Help tip={TIP.page} />
          </span>
          <PaperButton sm className="cv-exit" onClick={onExit}>
            回到调试台
          </PaperButton>
        </div>

        <section className="cv-now">
          <div>
            <span className="cv-fl">此刻</span>
            <b>
              {beat
                ? `第 ${beatNumber} 条回复 · 分支 ${beat.entry.swipeIndex + 1}/${beat.entry.swipes.length} · ${lines.length} 句`
                : '还没有回复'}
            </b>
          </div>
          <div>
            <span className="cv-fl">场景</span>
            {scene.bg ? `「${scene.bg.label}」` : '默认背景(这张卡没绑场景包,或者包里没有背景)'}
            <span className="cv-fl">音乐</span>
            {scene.bgm ? `「${scene.bgm.label}」(${BGM_FROM[scene.bgmFrom ?? 'tag']})` : '无'}
            <span className="cv-fl">CG</span>
            {scene.cg ? `「${scene.cg.label}」` : '无'}
          </div>
        </section>

        <section className="cv-sec">
          <Head zh="标签" en="Tags" tip={TIP.match}>
            {broken.length > 0 && <Err>{broken.join('、')}的模板不合法,这几类不识别</Err>}
          </Head>
          {jev && (
            <>
              <p className="cv-note cv-jevnote">
                {STAR}
                <span>
                  这条的{(jev.kinds ?? []).map((k) => kindName(k)).join('、')}标签是 Jev 标的:判了 {jev.lines} 句、{jev.requests} 次请求、最慢{' '}
                  {(jev.maxMs / 1000).toFixed(2)} 秒、
                  {/* 只数 token 不算钱:走中转的价格各不一样 */}
                  {jev.tokens.toLocaleString()} token
                  {jevPending !== undefined ? ` · 第 ${jevPending + 1} 句起还在判` : ''}
                  {jevDropped ? ` · 原文改过,${jevDropped} 句的标注对不上已去掉` : ''}
                  {jev.notes ? ' · 标签另存,模型原文在调试台聊天区点「看原文」' : ''}
                </span>
              </p>
              {jev.failed ? (
                <p className="cv-note">
                  <Err>
                    {jev.failed} 句没判成(照没标处理){jev.error ? `:${jev.error}` : ''}
                  </Err>
                </p>
              ) : null}
            </>
          )}
          {hits.length === 0 ? (
            <p className="cv-note">
              这条回复里没有标签。去插件面板检查:当前预设里有没有「立绘指令 / 场景指令 / 音乐指令 · 插件」这几个块,块有没有开启。
            </p>
          ) : (
            <div className="cv-scroll">
              <table className="cv-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>类别</th>
                    <th>标签原文</th>
                    <th>生效于</th>
                    <th>匹配结果</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h, i) => (
                    <tr key={i} {...rowProps(pick?.table === 'tag' && pick.index === i, () => setPick({ table: 'tag', index: i }))}>
                      <td>{i + 1}</td>
                      <td>{kindName(h.kind)}</td>
                      <td>
                        <code>{h.raw}</code>
                      </td>
                      <td>{hitWhere(h)}</td>
                      <td>
                        <VerdictText v={hitVerdict(h, matchCtx)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="cv-sec">
          <Head zh="语音" en="Voice">
            {voice.enabled && (voice.cast.main || voice.cast.extras.length > 0) && voice.paused ? (
              <Err>
                连续失败,暂停中(每 15 秒自动重连){voice.lastError ? `:${voice.lastError}` : ''}
              </Err>
            ) : (
              <span className="cv-sub">
                {!voice.enabled
                  ? '插件里关着'
                  : !voice.cast.main && voice.cast.extras.length === 0
                    ? '这张卡没绑声音(调试台 → 插件 → 语音)'
                    : `音色「${voice.cast.main?.name ?? '无'}」${voice.fixedEmotion ? ' · 情绪不变' : ''}`}
              </span>
            )}
          </Head>
          {lines.length > 0 && (
            <div className="cv-scroll">
              <table className="cv-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>说话人 → 声音</th>
                    <th>情绪(要的 → 实际)</th>
                    <th>方式</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {voiceRows.map((r, i) => (
                    <tr key={i} {...rowProps(pick?.table === 'voice' && pick.index === i, () => setPick({ table: 'voice', index: i }))}>
                      <td>{i + 1}</td>
                      <td>{r.who}</td>
                      <td>{r.emotion}</td>
                      <td>{r.mode}</td>
                      <td>
                        {r.status.error ? (
                          <Err>{r.status.text}</Err>
                        ) : (
                          <span className={r.status.ok ? 'cv-v ok' : undefined}>
                            {r.status.ok && <b aria-hidden="true">✓ </b>}
                            {r.status.text}
                          </span>
                        )}
                        {r.synth && <div className="cv-sub cv-synth">{r.synth}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="cv-sec">
          <Head zh="模型完整输出" en="Raw" />
          <pre className="cv-raw">
            {raw
              ? segs.map((s, i) =>
                  s.tag ? (
                    <mark key={i} className={`${s.tag.ok ? 'ok' : 'miss'} k-${s.tag.kind}`}>
                      {s.text}
                    </mark>
                  ) : (
                    s.text
                  ),
                )
              : '(空)'}
          </pre>
        </section>
      </div>

      <aside className="cv-side" aria-label="这一句的样子">
        <Head zh={hasLine ? `第 ${at + 1} 句` : '舞台'} en="Line" />
        <Stage
          background={bg && bgSrc ? { src: bgSrc, focus: bg.focus_x ?? 50 } : null}
          sprite={
            shown && shownSrc
              ? { src: shownSrc, face: faces.get(shown.id) ?? null, layout: spriteLayout, stage: spriteStage }
              : null
          }
          cg={cg && cgSrc ? { src: cgSrc, focus: cg.focus_x ?? 50, mode: 'cover' } : null}
          line={ln ? { speaker: ln.speaker ?? '', text: ln.text, narration: !ln.speaker } : null}
          label={
            <>
              {hasLine ? `第 ${at + 1} 句` : '还没有回复'} · <em>{emotionName}</em>
            </>
          }
        />
        <div className="cv-kv">
          {pickedHit && (
            <>
              <span>类别</span>
              <b>{kindName(pickedHit.kind)}</b>
              <span>标签原文</span>
              <code>{pickedHit.raw}</code>
              <span>生效于</span>
              <b>{hitWhere(pickedHit)}</b>
              <span>匹配结果</span>
              <b>
                <VerdictText v={hitVerdict(pickedHit, matchCtx)} />
              </b>
            </>
          )}
          {hasLine && (
            <>
              <span>表情</span>
              <b>
                {emotionName}
                {shown && !shown.has_image ? '(还没传图)' : ''}
              </b>
              {vr && (
                <>
                  <span>语音</span>
                  <b>
                    {vr.who}
                    {vr.emotion !== '—' ? ` · ${vr.emotion}` : ''}
                  </b>
                  <span>状态</span>
                  <b>{vr.status.error ? <Err>{vr.status.text}</Err> : vr.status.text}</b>
                </>
              )}
            </>
          )}
        </div>
        <p className="cv-hint">
          {pick ? (
            <button type="button" className="cv-link" onClick={() => setPick(null)}>
              回到光标那一句
            </button>
          ) : (
            '点标签表或语音表的一行,这里换成那一句的样子。'
          )}
        </p>
      </aside>
    </div>
  );
}
