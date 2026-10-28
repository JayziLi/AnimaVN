/**
 * 句检查器(素材架构设计 1.9;第 1d 期由「历史」里的语音详情扩出来)—— 这一句为什么是这样:
 *   判定:形态、说话人、表情(这句显示的那张,下面一行写怎么来的)、背景、CG(构图和这一帧),沿用的写沿用哪句。
 *     能只改这一句的表情(存进存档,只这个分支的这一句);这句的词是认词记录或模型认的时候,还能让这个词以后都认成别的。
 *   语音:说话人 → 声音;立绘标签 → 认成哪个表情;要的情绪 → 配对表配的那一行或者按名字挑 → 参考音频和原文;
 *     发给语音服务的原样请求;缓存里有没有、这次放的时候怎么样。不念的句子写原因。参考音频那几行能点 ▶ 听原声。
 * 历史页每句的「详情」和对话框上右键 / 长按打开的浮层是同一个组件。「怎么来的」那几句字在 inspectorText.ts(有测试)。
 *
 * 念的句子问后端 /api/tts/explain:和真正合成走同一套挑法,但不合成、不碰语音服务。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { stateAt, type Timeline } from '../core/timeline';
import {
  debugApi,
  type PackSprite,
  type PairingCellOut,
  type SpeakRequest,
  type VoiceExplain,
  type VoiceProfile,
} from '../lib/api';
import type { ChatEntry } from '../lib/chatEntry';
import { emotionCandidates, RECORD_SOURCE_NAME, type EmotionContext, type TagMatch } from '../plugins/emotionMatch';
import { manualAt, manualLabel, manualOf } from '../plugins/manualMarks';
import { formName } from '../plugins/forms';
import { voiceDetail } from '../plugins/voiceExtensions';
import {
  VOICE_LANGS,
  spriteHitsUpTo,
  spriteLabelAfter,
  voiceKey,
  voiceSkipReason,
} from '../plugins/voice';
import { audioBus } from './audioBus';
import {
  effectiveEmotion,
  emotionHow,
  manualSelect,
  originIn,
  originText,
  recordable,
  speakerText,
  voicePickText,
  type TagBy,
} from './inspectorText';
import type { TagHit, VNLine } from './script';
import { saveWordRecord } from './useWordRecords';
import { useVoice, voicePlayer, type ClipState } from './voice';

interface Props {
  /** 这句所在的回复(手改记号存在它当前分支上) */
  entry: ChatEntry;
  /** 这条回复在时间线里是第几条 */
  entryIndex: number;
  /** 整段对话的时间线:这句的画面,背景和 CG 从哪来 */
  timeline: Timeline;
  line: VNLine;
  /** 这句是这条回复的第几句(从 0 数) */
  index: number;
  /** 这条回复的全部标签 */
  hits: readonly TagHit[];
  /** 当前立绘包里启用的立绘;没配立绘时是空的(手改从内置表情里选) */
  sprites: readonly PackSprite[];
  /** 这张卡的表情名单(认词记录按它记) */
  listRef: string;
  /** 表情认法选了认词记录:才能「以后都认成」,语音才查配对表 */
  records: boolean;
  /**
   * 主声音念的句子(情绪跟着表情走的时候)按配对表挑那一行:配给主声音的那张表(立绘 id → 一行语气的 id),
   * 还没读到、没有表是 null。不是主声音的台词、情绪不变时不传
   */
  voicePairs?: { table: ReadonlyMap<string, string | null> | null };
  /** 只改这一句的表情(pick 是 null = 不改了);不传不显示这一行 */
  onSetManual?: (pick: { item: string; label: string } | null) => void;
  /** 这条回复第一句之前生效的表情(之前各条回复累计下来的) */
  emotionBefore: string | null;
  /** 这句怎么念;不念是 null */
  plan: SpeakRequest | null;
  /** 说话人对上的声音(玩家台词是 null) */
  profile: VoiceProfile | null;
  ctx: EmotionContext;
  voiceEnabled: boolean;
  /** 插件设置里选了情绪不变 */
  fixedEmotion: boolean;
  /** 流式时这条回复的最后一句(还在写) */
  streamingLast: boolean;
  /** 这条回复的标签是 Jev 标的;这句 Jev 还在判 */
  jev?: boolean;
  jevPending?: boolean;
  /** 从这句接着看(历史页才有) */
  onJump?: () => void;
  /** 关掉(对话框上的浮层才有) */
  onClose?: () => void;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

const langName = (lang: string) =>
  [...VOICE_LANGS.gpt_sovits, ...VOICE_LANGS.indextts].find((l) => l.value === lang)?.name ?? lang;

function matchText(m: TagMatch): string {
  switch (m.state) {
    case 'exact':
      return `✓ 名字对上「${m.label}」`;
    case 'record':
      return `✓ 认词记录:认成「${m.label}」(${RECORD_SOURCE_NAME[m.source]})`;
    case 'model':
      return `≈ 模型认成「${m.label}」(相似度 ${m.score.toFixed(2)})`;
    case 'pending':
      return '… 模型还在认';
    case 'failed':
      return `✗ ${m.reason},保持之前的表情`;
  }
}

function howText(x: VoiceExplain): string {
  switch (x.how) {
    case 'exact':
      return '名字对上';
    case 'alias':
      return `别名「${x.via ?? ''}」对上`;
    case 'nearest':
      return `情绪表里没有「${x.wanted ?? ''}」,模型挑了最像的「${x.via ?? ''}」(相似度 ${(x.score ?? 0).toFixed(2)})`;
    case 'default':
      return x.wanted ? `情绪表里没有「${x.wanted}」,模型也没挑出来,用排第一的默认情绪` : '没传情绪,用排第一的默认情绪';
    case 'pairing':
      return '配对表:这张立绘配的是这一段';
  }
}

function clipText(st: ClipState | undefined): string {
  if (!st) return '这次打开还没放过这句';
  switch (st.state) {
    case 'queued':
      return '排队等合成';
    case 'loading':
      return '合成中…';
    case 'ready':
      return `✓ ${st.cache === 'hit' ? '缓存命中' : '新合成'} · ${(st.ms / 1000).toFixed(1)} 秒 · 用「${st.emotion}」的参考`;
    case 'error':
      return `✗ ${st.message}`;
  }
}

/** 请求体里除了文字和参考之外的那些(合成参数),一行写完 */
const REQ_SHOWN = new Set([
  'text',
  'text_lang',
  'lang',
  'ref_audio_path',
  'prompt_text',
  'prompt_lang',
  'aux_ref_audio_paths',
  'spk_audio_path',
  'emo_audio_path',
  'emo_vector',
  'media_type',
  'streaming_mode',
]);
const paramsOf = (req: Record<string, unknown>) =>
  Object.entries(req)
    .filter(([k, v]) => !REQ_SHOWN.has(k) && v !== null && v !== undefined)
    .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

// ---- 参考音频试听:从语音服务那台机器上取回原声(后端转发,只放行这个声音配过的路径) ----

/** 取过的原声留在内存里,反复听不用再取;太多就丢掉最早的(一段不到 1 MB) */
const refAudio = new Map<string, Promise<ArrayBuffer>>();
const REF_KEEP = 12;
/** 正在放的是哪一段(播放器里只知道是 'preview') */
let refPlaying: string | null = null;

function loadRef(profileId: string, path: string): Promise<ArrayBuffer> {
  const key = `${profileId}
${path}`;
  let p = refAudio.get(key);
  if (!p) {
    p = debugApi.referenceAudio(profileId, path);
    // 失败的不留,下次重新取
    p.catch(() => refAudio.delete(key));
    refAudio.set(key, p);
    while (refAudio.size > REF_KEEP) refAudio.delete(refAudio.keys().next().value as string);
  }
  return p;
}

function RefPlay({ profileId, path }: { profileId: string; path: string }) {
  const snap = useVoice();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `${profileId}
${path}`;
  const playing = snap.speaking === 'preview' && refPlaying === key;

  const click = async () => {
    if (playing) {
      voicePlayer.stop();
      return;
    }
    // 在点击里解锁:取原声要一会儿,回来就不算用户手势了
    audioBus.unlock();
    setLoading(true);
    setError(null);
    try {
      const audio = await loadRef(profileId, path);
      refPlaying = key;
      await voicePlayer.playBuffer(audio);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`vn-vd-play${playing ? ' on' : ''}`}
        onClick={() => void click()}
        disabled={loading}
        aria-label={playing ? '停' : '听参考原声'}
        title={playing ? '停' : '听这段参考的原声'}
      >
        {loading ? '…' : playing ? '■' : '▶'}
      </button>
      {error && <span className="vn-vd-err">{error}</span>}
    </>
  );
}

/**
 * 一行:名字、显示的字(复制详情也用它);note 是下面那行小字;full 是悬停看到的全文;
 * refPath 是能试听的参考音频;control 是这一行的下拉(有它时显示它,复制时用 v)
 */
interface Row {
  k: string;
  v: string;
  note?: string;
  full?: string;
  refPath?: string;
  control?: ReactNode;
}

/** 下拉里「不改了」那一项的值(立绘 id、内置表情名都不会是它) */
const CLEAR = '\u0000clear';

export function LineInspector({
  entry,
  entryIndex,
  timeline,
  line,
  index,
  hits,
  sprites,
  listRef,
  records,
  voicePairs,
  onSetManual,
  emotionBefore,
  plan,
  profile,
  ctx,
  voiceEnabled,
  fixedEmotion,
  streamingLast,
  jev,
  jevPending,
  onJump,
  onClose,
}: Props) {
  const snap = useVoice();
  const planKey = plan ? voiceKey(plan) : null;
  const [ex, setEx] = useState<{ key: string; data?: VoiceExplain; error?: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  // 「以后都认成」:改好的那个词、出错的原因
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 主声音配对表里那一格的来源(问后端要整张表;表改了再问)
  const [cells, setCells] = useState<{ key: string; cells: PairingCellOut[] } | null>(null);

  // plan 每次重算都是新对象,按它的内容取;nonce 变了是「重新检查」
  const pid = plan?.profile_id ?? null;
  const wanted = plan?.emotion ?? null;
  // 表情认法 = 认词记录时配对表挑好的那一行;旧算法没有
  const rowId = plan?.emotion_id;
  const said = plan?.text ?? null;
  const sfx = Boolean(plan?.sfx);
  useEffect(() => {
    if (pid === null || said === null) return;
    const req = {
      profile_id: pid,
      emotion: wanted,
      ...(rowId !== undefined && { emotion_id: rowId }),
      text: said,
      ...(sfx && { sfx }),
    };
    const key = voiceKey(req);
    let live = true;
    debugApi
      .explainVoice(req)
      .then((data) => live && setEx({ key, data }))
      .catch((e: unknown) => live && setEx({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [pid, wanted, rowId, said, sfx, nonce]);

  const explain = ex && ex.key === planKey ? ex : null;
  const x = explain?.data;

  // ---- 判定:时间线里这句的状态,以及表情、背景、CG 从哪来 ----

  const state = stateAt(timeline, entryIndex, index);
  const origins = useMemo(
    () => ({
      emotion: originIn(timeline, entryIndex, index, (s) => s.spriteLabel),
      bg: originIn(timeline, entryIndex, index, (s) => s.scene.bg),
      cg: originIn(timeline, entryIndex, index, (s) => s.scene.cg),
    }),
    [timeline, entryIndex, index],
  );

  // 这条回复里到这句为止最后一个立绘标签(路人台词前的不算),以及它认成了什么
  const tags = spriteHitsUpTo(hits, index, ctx.charName);
  const lastTag = tags[tags.length - 1];
  const lastMatch = lastTag ? ctx.resolve(lastTag.label) : null;
  const effective = spriteLabelAfter(tags, ctx, emotionBefore);
  const own = hits.filter((h) => h.kind === 'sprite' && h.lineIndex === index);

  // 手改的:找不到那一张(删了、停用了)当没改,下拉里还能「不改了」
  const mark = manualAt(manualOf(entry), index);
  const manual = mark ? manualLabel(mark, sprites) : null;
  // 下拉的选项:立绘包里启用的立绘;没配立绘是内置表情(item 和手改记号一样:立绘 id / 内置表情名)
  const choices = useMemo(() => emotionCandidates(sprites).map((c) => ({ item: c.key, label: c.label })), [sprites]);
  // 下拉选中哪一项;占位那一项只在没改、或者改的那张真找不到时才有(找到了还挂着「改的那张不在了」,看着像没改上)
  const manualPick = manualSelect(mark, choices);

  // 形态开着时这句的形态:名字用形态卡带给的
  const formLabel = state.form === null ? null : formName(state.form);
  const by: TagBy = jev ? 'jev' : entry.overswipe === 'loop' ? 'card' : 'ai';
  const how = emotionHow({
    manual,
    tag: lastTag && lastMatch ? { word: lastTag.label, line: lastTag.lineIndex, match: lastMatch } : null,
    line: index,
    by,
    fromStart: origins.emotion.at === 'initial',
    shown: state.shownLabel,
    rawOnFail: ctx.rawOnFail,
    mapped:
      formLabel !== null && manual === null && state.shownLabel !== state.spriteLabel
        ? { from: state.spriteLabel, form: formLabel }
        : null,
  });

  const pickManual = (value: string) => {
    if (!onSetManual) return;
    if (value === CLEAR) {
      onSetManual(null);
      return;
    }
    const c = choices.find((o) => o.item === value);
    if (c) onSetManual(c);
  };

  // 「以后这个词都认成」:认词记录或模型认的词才有;表情认法得是认词记录(旧算法不看认词记录,改了也不生效)
  const word = lastTag && lastMatch && records && recordable(lastMatch) ? lastTag.label : null;
  const wordLabel = lastMatch && 'label' in lastMatch ? lastMatch.label : null;
  const wordValue = word ? (choices.find((c) => c.label === wordLabel)?.item ?? '') : '';
  const saveWord = async (item: string) => {
    if (!word || !item || item === wordValue) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveWordRecord(listRef, word, item);
      setSaved(word);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const judge: Row[] = [];
  if (formLabel !== null) judge.push({ k: '形态', v: formLabel });
  judge.push({ k: '说话人', v: speakerText(line, { charName: ctx.charName, jev }) });
  judge.push({ k: '表情', v: state.shownLabel ?? '无', note: how });
  if (onSetManual) {
    judge.push({
      k: '只改这一句',
      v: manual ?? (mark ? '改的那张不在了' : '没改'),
      control: (
        <select
          className="vn-set-select"
          value={manualPick.value}
          onChange={(e) => pickManual(e.target.value)}
          aria-label="只改这一句的表情"
        >
          {manualPick.placeholder !== null && (
            <option value="" disabled>
              {manualPick.placeholder}
            </option>
          )}
          {choices.map((c) => (
            <option key={c.item} value={c.item}>
              {c.label}
            </option>
          ))}
          {mark && <option value={CLEAR}>不改了</option>}
        </select>
      ),
    });
  }
  if (word) {
    judge.push({
      k: `以后「${word}」都认成`,
      v: wordLabel ?? '',
      control: (
        <>
          <select
            className="vn-set-select"
            value={wordValue}
            disabled={saving}
            onChange={(e) => void saveWord(e.target.value)}
            aria-label={`以后「${word}」都认成`}
          >
            {wordValue === '' && <option value="" disabled />}
            {choices.map((c) => (
              <option key={c.item} value={c.item}>
                {c.label}
              </option>
            ))}
          </select>
          {saved === word && !saving && !saveError && <span className="vn-vd-note">已改,以后都按它</span>}
          {saveError && <span className="vn-vd-err">{saveError}</span>}
        </>
      ),
    });
  }
  const bg = state.scene.bg;
  judge.push({ k: '背景', v: bg ? `${bg.label} · ${originText(origins.bg)}` : '没有背景' });
  const cg = state.scene.cg;
  const frame = state.cgFrame;
  judge.push({
    k: 'CG',
    v: cg
      ? `${cg.label} / ${!frame || frame.id === cg.id ? '构图本身' : `差分「${frame.label}」`} · ${originText(origins.cg)}`
      : '—',
  });

  // ---- 语音:主声音按配对表挑的那一行 ----

  const pairTable = voicePairs?.table ?? null;
  const pairSprite = voicePairs ? (sprites.find((s) => s.label === state.shownLabel) ?? null) : null;
  const pairRow = pairSprite && pairTable ? (pairTable.get(pairSprite.id) ?? null) : null;
  const target = records && pairRow !== null ? (profile?.id ?? null) : null;
  const cellsKey = target ? `${listRef}\u0000${target}` : null;
  useEffect(() => {
    if (!cellsKey || !target) return;
    let live = true;
    debugApi
      .pairings('voice', listRef, target)
      .then((tables) => live && setCells({ key: cellsKey, cells: tables.flatMap((t) => t.cells) }))
      .catch(() => live && setCells({ key: cellsKey, cells: [] }));
    return () => {
      live = false;
    };
    // pairTable:配对页改了一格、补配回来以后再问一次
  }, [cellsKey, listRef, target, pairTable]);
  const cell =
    cells && cells.key === cellsKey && pairSprite ? cells.cells.find((c) => c.item === pairSprite.id) : undefined;

  const rows: Row[] = [];
  /** [名字, 显示的内容, 悬停看到的全文, 能试听的参考音频路径] */
  const push = (k: string, v: string, full?: string, refPath?: string) => rows.push({ k, v, full, refPath });
  if (jev) push('标签来源', jevPending ? 'Jev 标注(这句还在判)' : 'Jev 标注');
  if (profile) push('声音', `${profile.name} · 念${langName(profile.text_lang)}`);
  push('这句的标签', own.length ? own.map((h) => h.raw).join(' ') : '没有(立绘标签不在这句上)');
  push(
    '立绘标签',
    lastTag
      ? `${lastTag.raw}(第 ${lastTag.lineIndex + 1} 句)→ ${matchText(ctx.resolve(lastTag.label))}`
      : `这条回复里这句之前没有立绘标签,沿用之前的「${emotionBefore ?? '无'}」`,
  );
  // 手改了的句子语音按手改的那张念(和画面、要的情绪、挑哪一行一样),这里也写它
  rows.push({ k: '生效的表情', ...effectiveEmotion(manual, effective) });

  if (!voiceEnabled) {
    push('语音', '语音插件关着');
  } else if (!plan) {
    push(
      '语音',
      voiceSkipReason(line, profile, {
        streamingLast,
        // 手改了的句子不等模型认标签(planVoiceLines 同样),不念就不是因为这个
        pendingTag: !fixedEmotion && manual === null && tags.some((h) => ctx.resolve(h.label).state === 'pending'),
        jev,
        jevPending,
      }),
    );
  } else {
    push(
      '要的情绪',
      plan.emotion ??
        (fixedEmotion ? '不传(插件设置里语音情绪选了不变,用默认情绪)' : '不传(不是音色,用它的默认情绪)'),
    );
    if (voicePairs && plan.emotion !== null) {
      const rowLabel =
        pairRow === null ? null : (profile?.emotions.find((e) => e.id === pairRow)?.label ?? '(这一行已经不在了)');
      push('挑哪一行', voicePickText({ records, sprite: pairSprite?.label ?? null, row: rowLabel, ...(cell && { cell }) }));
    }
    if (explain?.error) {
      push('后端', `✗ ${explain.error}`);
    } else if (!x) {
      push('后端', '正在问…');
    } else {
      const req = x.request;
      push('用的情绪行', x.emotion ? `「${x.emotion}」· ${howText(x)}` : `(没有情绪行)· ${howText(x)}`);
      if (x.api_type === 'indextts') {
        const spk = str(req.spk_audio_path);
        push('音色参考', baseName(spk), spk, spk || undefined);
        push(
          '情绪来源',
          x.mode === 'ref'
            ? `参考音频 ${baseName(str(req.emo_audio_path))}`
            : x.mode === 'vector'
              ? `情绪向量 ${str(req.emo_vector)}`
              : '不控制(沿用音色参考的语气)',
          x.mode === 'ref' ? str(req.emo_audio_path) : undefined,
          x.mode === 'ref' ? str(req.emo_audio_path) : undefined,
        );
        push('念的文字', `${str(req.text)}(${langName(str(req.lang))})`);
      } else {
        const ref = str(req.ref_audio_path);
        push('参考音频', baseName(ref), ref, ref || undefined);
        push('参考原文', `${str(req.prompt_text)}(${langName(str(req.prompt_lang))})`);
        // 辅助参考只混音色,语气还跟上面那段走
        const aux = Array.isArray(req.aux_ref_audio_paths) ? req.aux_ref_audio_paths.map(str) : [];
        aux.forEach((p, i) => push(`辅助参考 ${i + 1}`, baseName(p), p, p));
        // 走了卡带的那一层(比如拼接)时,「念的文字」换成卡带给的那一行(plugins/voiceExtensions.ts)
        const extra = voiceDetail(x);
        if (extra) push(extra.label, extra.value, extra.title);
        else push('念的文字', `${str(req.text)}(${langName(str(req.text_lang))})`);
        push('模型', `${baseName(x.gpt_weights)} / ${baseName(x.sovits_weights)}`, `${x.gpt_weights}\n${x.sovits_weights}`);
      }
      push('合成参数', paramsOf(req) || '—');
      push('语音服务', x.connection_name);
      push('缓存', x.cached ? '合成过,缓存里有(重播直接出)' : '还没合成过');
    }
    push('这次播放', clipText(snap.clips.get(voiceKey(plan))));
  }

  const copy = async () => {
    const lineOf = ({ k, v, note, full }: Row) =>
      `${k}:${full && full !== v ? full.replace(/\n/g, ' ') : v}${note ? `(${note})` : ''}`;
    const text = [
      line.text,
      ...(line.ja ? [`日语:${line.ja}`] : []),
      '【判定】',
      ...judge.map(lineOf),
      '【语音】',
      ...rows.map(lineOf),
      ...(x ? ['发给语音服务的请求:', JSON.stringify(x.request, null, 2)] : []),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied(null), 1600);
  };

  const grid = (list: Row[]) => (
    <dl className="vn-vd-grid">
      {list.map(({ k, v, note, full, refPath, control }) => (
        <div key={k} className="vn-vd-row">
          <dt>{k}</dt>
          <dd title={full}>
            {refPath && pid && <RefPlay profileId={pid} path={refPath} />}
            {control ?? v}
            {note && <span className="vn-vd-note">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="vn-vd">
      <div className="vn-vd-sec">判定</div>
      {grid(judge)}
      <div className="vn-vd-sec">语音</div>
      {grid(rows)}
      {x && (
        <details className="vn-vd-raw">
          <summary>发给语音服务的原样请求</summary>
          <pre>{JSON.stringify(x.request, null, 2)}</pre>
        </details>
      )}
      <div className="vn-vd-actions">
        <button type="button" className="vn-pill" onClick={() => void copy()}>
          {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制详情'}
        </button>
        {plan && (
          <button type="button" className="vn-pill" onClick={() => setNonce((n) => n + 1)} title="声音或情绪表改过之后重新问一遍">
            重新检查
          </button>
        )}
        {onJump && (
          <button type="button" className="vn-pill accent" onClick={onJump}>
            回到这里
          </button>
        )}
        {onClose && (
          <button type="button" className="vn-pill" onClick={onClose}>
            关掉
          </button>
        )}
      </div>
    </div>
  );
}
