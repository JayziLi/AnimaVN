/**
 * 声音编辑器(照 V4AttachVoice.png):主区是「声音设置」(名字、语音服务、语言、别名、权重或音色参考)、「试听」台和
 * 「情绪参考」表,右栏是选中那种情绪的参考音频、参考文本、别名、辅助参考,和整个声音的「全局参数」(语速、温度、切分;
 * GPT-SoVITS 下面还有收起来的「更多参数」:采样步数、top_p、top_k、重复惩罚、句间停顿、并行推理、试听用的固定种子)。
 * 不依赖卡:卡编辑器「声音」栏和素材管理页都用它,主区顶上那一行(header)由用的地方给。
 *
 * 声音按 voiceId 自己从后端读;改完用后端回的那份更新自己,再 onChanged() 让 DebugApp 重新拉声音列表 ——
 * 游戏里这个声音已经合成好的句子会作废重念(useVoicePlugin 比较前后的设置)。
 * 参考音频、权重在语音机上,这里改的是路径;▶ 原声经后端从语音机取回(/api/tts/reference)。
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  debugApi,
  type TtsConnection,
  type VoiceEmotion,
  type VoiceEmotionPatch,
  type VoiceParams,
  type VoiceProfile,
  type VoiceProfilePatch,
} from '../../lib/api';
import { EmotionVectorEditor } from '../../components/EmotionVectorEditor';
import { LABEL_MAX } from '../../plugins/common';
import {
  GSV_NUM_PARAMS,
  INDEX_NUM_PARAMS,
  SPEED_RANGE,
  TEXT_SPLIT_METHODS,
  sampleIn,
  sampleLangOf,
} from '../../plugins/voice';
import { audioBus } from '../../vn/audioBus';
import { useVoice, voicePlayer } from '../../vn/voice';
import { ArmedBtn } from '../profile/ArmedBtn';
import { Icon } from '../icons';
import { TERMS } from '../terms';
import {
  Btn,
  Chip,
  CommitTextarea,
  FieldLabel,
  HelpTip,
  Inspector,
  InspectorHead,
  PromptDialog,
  Section,
  SelectBox,
  SelectRow,
  SliderRow,
  TagsField,
} from '../ui';
import type { Notify } from '../types';
import {
  MORE_GSV_PARAMS,
  SEED_MAX,
  aliasesPatch,
  basename,
  benchBlocker,
  benchTuning,
  connectionOption,
  filesPending,
  fmtSpeed,
  langOptions,
  matchBadge,
  missingSettings,
  moreParamsSummary,
  moveToFront,
  newEmotionFrom,
  paramDefault,
  parseSeed,
  peaksOf,
  progressText,
  refPatch,
  rowText,
  samplesFor,
  selectAfterDelete,
  settingPatch,
  settingsSummary,
  tableNote,
  withParam,
  type SettingKey,
} from './voiceEditorModel';
import { VoiceFilesPending } from './VoiceFilesPending';
import './voiceEditor.css';

export interface VoiceEditorProps {
  voiceId: string;
  /**
   * 外面列表里这个声音现在叫什么(素材管理顶上的名字、卡编辑器「⋯ → 重命名」改的):变了就跟着换,
   * 不用整个重读。不给 = 只认自己读到的
   */
  name?: string;
  /** 主区顶上那一行:卡编辑器里是类型小牌子 + 声音页签 + ⋯;素材管理页是包名、用到它的卡…… */
  header: ReactNode;
  /**
   * 拿来对照情绪的差分名:卡编辑器里是当前服装启用的差分(空数组 = 这张卡没立绘,对照内置基础表情);
   * null = 不对照(素材管理页不带卡;备用声音只用默认情绪),表头不出匹配小牌子
   */
  spriteLabels: readonly string[] | null;
  /** 改了这个声音(情绪、参考、参数)之后调:DebugApp 重新拉声音列表(voicePlugin.refresh) */
  onChanged: () => void;
  notify: Notify;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const round2 = (n: number) => Math.round(n * 100) / 100;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

/** 换了声音整个重来(试听的句子换成那个声音的语言、选中第一行) */
export function VoiceEditor(props: VoiceEditorProps) {
  return <Editor key={props.voiceId} {...props} />;
}

function Editor({ voiceId, name, header, spriteLabels, onChanged, notify }: VoiceEditorProps) {
  const [data, setData] = useState<{ profile: VoiceProfile | null; connections: TtsConnection[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // 外面改了名字:跟着换。只看外面的名字有没有变 —— 这里刚改的名字外面还没刷新时,不能被旧名字盖回去
  const [outerName, setOuterName] = useState(name);
  if (name !== outerName) {
    setOuterName(name);
    if (name && data?.profile && data.profile.name !== name) {
      setData({ ...data, profile: { ...data.profile, name } });
    }
  }
  useEffect(() => {
    let alive = true;
    Promise.all([debugApi.listVoices(), debugApi.listTtsConnections()])
      .then(([profiles, connections]) => {
        if (alive) setData({ profile: profiles.find((p) => p.id === voiceId) ?? null, connections });
      })
      .catch((e: unknown) => {
        if (alive) setFailed(errText(e));
      });
    return () => {
      alive = false;
    };
  }, [voiceId]);

  if (!data?.profile) {
    const text = failed ? `声音读取失败:${failed}` : data ? '这个声音已经删掉了' : '读取中…';
    return (
      <main className="st-main">
        {header}
        <div className="st-pending">
          <Icon name="mic" size={28} />
          <span>{text}</span>
        </div>
      </main>
    );
  }
  const patch = (f: (p: VoiceProfile) => VoiceProfile) =>
    setData((d) => (d?.profile ? { ...d, profile: f(d.profile) } : d));
  return (
    <Loaded
      profile={data.profile}
      connection={data.connections.find((c) => c.id === data.profile?.connection_id) ?? null}
      connections={data.connections}
      patch={patch}
      header={header}
      spriteLabels={spriteLabels}
      onChanged={onChanged}
      notify={notify}
    />
  );
}

// ---------------------------------------------------------------- 播放

/** 解码过的一段:时长和波形(画播放条用);解不出来时长是 0、没有波形 */
interface Clip {
  audio: ArrayBuffer;
  duration: number;
  peaks: number[] | null;
}

/** 试听台波形的柱子数、右栏参考音频卡片的柱子数(和图里一样) */
const BENCH_BARS = 120;
const REF_BARS = 64;

async function decode(audio: ArrayBuffer, bars: number): Promise<Clip> {
  const ctx = audioBus.context;
  if (!ctx) return { audio, duration: 0, peaks: null };
  try {
    // decodeAudioData 会用掉传进去的 ArrayBuffer,传一份拷贝,播放时还要用原件
    const buf = await ctx.decodeAudioData(audio.slice(0));
    return { audio, duration: buf.duration, peaks: peaksOf(buf.getChannelData(0), bars) };
  } catch {
    return { audio, duration: 0, peaks: null };
  }
}

/** 取过的参考原声留在内存里,反复听不用再去语音机取;太多就丢掉最早的(一段不到 1 MB) */
const refClips = new Map<string, Promise<Clip>>();
const REF_KEEP = 12;
const refKey = (profileId: string, path: string) => `${profileId}\n${path}`;

function loadRef(profileId: string, path: string): Promise<Clip> {
  const key = refKey(profileId, path);
  let p = refClips.get(key);
  if (!p) {
    p = debugApi.referenceAudio(profileId, path).then((a) => decode(a, REF_BARS));
    // 失败的不留,下次重新取
    p.catch(() => refClips.delete(key));
    refClips.set(key, p);
    while (refClips.size > REF_KEEP) refClips.delete(refClips.keys().next().value as string);
  }
  return p;
}

/**
 * 正在放哪一段、放到哪了。播放器(vn/voice.ts)只知道在放「试听」('preview'),
 * 是哪一段由这里记:'take' = 试听台合成的那句,'ref:<情绪 id>' = 那一行的参考原声
 */
function usePreview() {
  const snap = useVoice();
  const [cur, setCur] = useState<{ key: string; startedAt: number; duration: number } | null>(null);
  const live = snap.speaking === 'preview' ? cur : null;
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  // 换声音、关卡编辑器时停掉自己在放的
  const mine = useRef(false);
  useEffect(() => {
    mine.current = cur !== null;
  }, [cur]);
  useEffect(
    () => () => {
      if (mine.current && voicePlayer.getSnapshot().speaking === 'preview') voicePlayer.stop();
    },
    [],
  );
  return {
    /** 调用方要先在点击里 audioBus.unlock() */
    play: async (key: string, clip: Clip) => {
      setCur(null);
      await voicePlayer.playBuffer(clip.audio);
      setCur({ key, startedAt: performance.now(), duration: clip.duration });
    },
    stop: () => voicePlayer.stop(),
    playing: (key: string) => live?.key === key,
    /** 放到第几秒;没在放是 0 */
    pos: (key: string) => (live?.key === key ? Math.max(0, (now - live.startedAt) / 1000) : 0),
  };
}

type Preview = ReturnType<typeof usePreview>;

/** 圆的 ▶:放着时是 ■,取音频 / 合成时转圈 */
function RoundPlay({
  size,
  muted,
  playing,
  loading,
  disabled,
  label,
  onClick,
}: {
  size: number;
  muted?: boolean;
  playing: boolean;
  loading?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`vo-play${muted && !playing ? ' muted' : ''}${playing || loading ? ' on' : ''}`}
      style={{ width: size, height: size }}
      aria-label={playing ? '停' : label}
      title={playing ? '停' : label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {loading ? (
        <span className="vo-spin" aria-hidden="true" />
      ) : playing ? (
        <span className="vo-stop" aria-hidden="true" />
      ) : (
        <Icon name="play" size={Math.round(size * 0.42)} />
      )}
    </button>
  );
}

/** 波形:放过的那段浅色;还没有音频时是一排矮柱子 */
function Wave({ peaks, bars, height, progress }: { peaks: number[] | null; bars: number; height: number; progress: number }) {
  const list = peaks ?? Array.from({ length: bars }, () => 0);
  return (
    <svg
      className="vo-wave"
      viewBox={`0 0 ${list.length * 3} ${height}`}
      preserveAspectRatio="none"
      height={height}
      aria-hidden="true"
    >
      {list.map((v, i) => {
        const h = Math.max(3, v * height);
        return (
          <rect
            key={i}
            x={i * 3}
            y={(height - h) / 2}
            width={2}
            height={h}
            className={(i + 0.5) / list.length <= progress ? 'on' : undefined}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- 编辑器本体

interface LoadedProps {
  profile: VoiceProfile;
  connection: TtsConnection | null;
  /** 全部语音服务(「声音设置」的下拉) */
  connections: readonly TtsConnection[];
  patch: (f: (p: VoiceProfile) => VoiceProfile) => void;
  header: ReactNode;
  spriteLabels: readonly string[] | null;
  onChanged: () => void;
  notify: Notify;
}

function Loaded({ profile, connection, connections, patch, header, spriteLabels, onChanged, notify }: LoadedProps) {
  const isIndex = connection?.api_type === 'indextts';
  const emotions = profile.emotions;
  const [selId, setSelId] = useState<string | null>(emotions[0]?.id ?? null);
  const sel = emotions.find((e) => e.id === selId) ?? emotions[0] ?? null;
  // 试听台的情绪:没单独选过就跟着表里选中的那行
  const [benchEmo, setBenchEmo] = useState<string | null>(null);
  const benchLabel = emotions.find((e) => e.label === benchEmo)?.label ?? sel?.label ?? '';
  const [dialog, setDialog] = useState<'add' | 'rename' | null>(null);
  const preview = usePreview();
  // 「更多参数」里的固定种子:只给试听用,不存
  const [seedText, setSeedText] = useState('');

  const select = (id: string) => {
    setSelId(id);
    setBenchEmo(null);
  };
  // 新增的那行在表的最下面:画出来以后滚到看得见
  const table = useRef<HTMLDivElement | null>(null);
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    const id = reveal.current;
    if (!id) return;
    reveal.current = null;
    table.current?.querySelector(`[data-emotion="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  // ---- 写库:用后端回的那份更新自己,再通知 DebugApp ----

  const run = async <T,>(fn: () => Promise<T>, apply: (r: T) => void): Promise<boolean> => {
    try {
      apply(await fn());
      onChanged();
      return true;
    } catch (e) {
      notify('error', errText(e));
      return false;
    }
  };
  const saveEmotion = (e: VoiceEmotion, body: VoiceEmotionPatch) =>
    run(
      () => debugApi.updateVoiceEmotion(profile.id, e.id, body),
      (next) => patch((p) => ({ ...p, emotions: p.emotions.map((x) => (x.id === next.id ? next : x)) })),
    );
  const saveVoice = (body: VoiceProfilePatch) =>
    run(
      () => debugApi.updateVoice(profile.id, body),
      (next) => patch(() => next),
    );
  const addEmotion = (input: string) =>
    run(
      () => debugApi.createVoiceEmotion(profile.id, newEmotionFrom(input, emotions)),
      (row) => {
        patch((p) => ({ ...p, emotions: [...p.emotions, row] }));
        select(row.id);
        reveal.current = row.id;
      },
    );
  const deleteEmotion = (e: VoiceEmotion) => {
    const next = selectAfterDelete(emotions, e.id);
    return run(
      () => debugApi.deleteVoiceEmotion(profile.id, e.id),
      () => {
        patch((p) => ({ ...p, emotions: p.emotions.filter((x) => x.id !== e.id) }));
        if (next) select(next);
      },
    );
  };
  const makeDefault = (e: VoiceEmotion) =>
    run(
      () =>
        debugApi.reorderVoiceEmotions(
          profile.id,
          moveToFront(
            emotions.map((x) => x.id),
            e.id,
          ),
        ),
      (rows) => patch((p) => ({ ...p, emotions: rows })),
    );

  // ---- 参考原声 ----

  const [refs, setRefs] = useState<Record<string, Clip>>({});
  const [refLoading, setRefLoading] = useState<string | null>(null);
  const [refError, setRefError] = useState<{ key: string; text: string } | null>(null);
  const playRef = async (e: VoiceEmotion) => {
    const key = `ref:${e.id}`;
    if (preview.playing(key)) {
      preview.stop();
      return;
    }
    if (!e.ref_path) return;
    // 在点击里解锁:去语音机取原声要一会儿,回来就不算用户手势了
    audioBus.unlock();
    setRefLoading(key);
    setRefError(null);
    try {
      const clip = await loadRef(profile.id, e.ref_path);
      setRefs((m) => ({ ...m, [refKey(profile.id, e.ref_path)]: clip }));
      await preview.play(key, clip);
    } catch (err) {
      setRefError({ key: refKey(profile.id, e.ref_path), text: errText(err) });
      notify('error', `参考音频取不回来:${errText(err)}`);
    } finally {
      setRefLoading(null);
    }
  };

  const badge = matchBadge(spriteLabels, profile);

  return (
    <>
      <main className="st-main">
        {header}
        {filesPending(profile) && (
          <VoiceFilesPending
            profile={profile}
            onPlaced={(next) => {
              patch(() => next);
              onChanged();
            }}
            notify={notify}
          />
        )}
        <VoiceSettings profile={profile} connections={connections} isIndex={isIndex} saveVoice={saveVoice} />
        <Bench
          profile={profile}
          isIndex={isIndex}
          emotionLabel={benchLabel}
          onEmotion={setBenchEmo}
          preview={preview}
          seed={isIndex ? { seed: null, bad: false } : parseSeed(seedText)}
        />
        <section className="vo-panel vo-table" aria-label="情绪参考">
          <div className="vo-table-head">
            <span className="vo-title">情绪参考</span>
            <span className="vo-note">{tableNote(emotions.length, badge !== null)}</span>
            <span className="st-flex" />
            {badge && (
              <span
                className={`vo-match${badge.ok ? '' : ' warn'}`}
                title={
                  badge.ok
                    ? undefined
                    : `没对上的会用情绪识别挑最接近的一行念(模型没装时用默认「${emotions[0]?.label ?? '—'}」)。想指定的话,给那一行加别名:${badge.missing.join('、')}`
                }
              >
                <Icon name={badge.ok ? 'check' : 'alert'} size={13} strokeWidth={badge.ok ? 2.4 : 1.8} />
                {badge.text}
              </span>
            )}
            <Btn small icon="plus" onClick={() => setDialog('add')}>
              新增情绪
            </Btn>
          </div>
          {emotions.length === 0 ? (
            <div className="vo-table-empty">
              {isIndex
                ? '还没有情绪 · 点「新增情绪」填一个情绪名,和差分名一致'
                : '还没有情绪 · 点「新增情绪」贴一段参考音频的路径'}
            </div>
          ) : (
            <div role="list" ref={table}>
              {emotions.map((e) => {
                const on = e.id === sel?.id;
                const t = rowText(e, isIndex);
                const key = `ref:${e.id}`;
                return (
                  <div key={e.id} role="listitem" data-emotion={e.id} className={`vo-row${on ? ' selected' : ''}`}>
                    <span className="vo-row-play">
                      <RoundPlay
                        size={24}
                        muted={!on}
                        playing={preview.playing(key)}
                        loading={refLoading === key}
                        disabled={!e.ref_path}
                        label={e.ref_path ? `听「${e.label}」的参考音频` : '这一行没有参考音频'}
                        onClick={() => void playRef(e)}
                      />
                    </span>
                    <button type="button" className="vo-row-main" aria-pressed={on} onClick={() => select(e.id)}>
                      <span className="vo-row-label">{e.label}</span>
                      <span className="vo-row-alias">
                        {e.aliases.length > 0 ? (
                          e.aliases.map((a) => (
                            <span key={a} className="vo-alias">
                              {a}
                            </span>
                          ))
                        ) : (
                          <span className="vo-dash">—</span>
                        )}
                      </span>
                      <span className={`vo-row-text${t.faint ? ' faint' : ''}`} title={t.text}>
                        {t.text}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <EmotionInspector
        profile={profile}
        connection={connection}
        isIndex={isIndex}
        emotion={sel}
        index={sel ? emotions.indexOf(sel) : -1}
        refClip={sel?.ref_path ? (refs[refKey(profile.id, sel.ref_path)] ?? null) : null}
        refError={sel?.ref_path && refError?.key === refKey(profile.id, sel.ref_path) ? refError.text : null}
        preview={preview}
        refLoading={sel ? refLoading === `ref:${sel.id}` : false}
        onPlayRef={(e) => void playRef(e)}
        onRename={() => setDialog('rename')}
        onMakeDefault={(e) => void makeDefault(e)}
        onDelete={(e) => void deleteEmotion(e)}
        saveEmotion={saveEmotion}
        saveVoice={saveVoice}
        seed={{ text: seedText, onText: setSeedText }}
        notify={notify}
      />

      {dialog === 'add' && (
        <PromptDialog
          title="新增情绪"
          label={
            isIndex
              ? '情绪名(和差分名一致,比如 开心)'
              : '参考音频在语音机上的路径;文件名是「【情绪】原文.wav」就自动填好情绪名和参考文本。也可以只填情绪名'
          }
          placeholder={isIndex ? '开心' : 'D:/AnimaVoice/refs/角色/【开心】原文.wav'}
          initial=""
          confirmLabel="新增"
          onCancel={() => setDialog(null)}
          onSubmit={(v) => {
            setDialog(null);
            void addEmotion(v);
          }}
        />
      )}
      {dialog === 'rename' && sel && (
        <PromptDialog
          title="改情绪名"
          label="情绪名(和差分名一致时直接用这一行)"
          initial={sel.label}
          onCancel={() => setDialog(null)}
          onSubmit={(v) => {
            setDialog(null);
            if (v !== sel.label) void saveEmotion(sel, { label: v });
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- 声音设置

/**
 * 主区最上面的「声音设置」:名字、语音服务、语言、别名,GPT-SoVITS 的两个权重或 IndexTTS 的音色参考。
 * 一格一存(失焦 / 回车,下拉选了就存)。都填好了收成一行摘要;缺东西(刚新建的声音)时一打开就是展开的
 */
function VoiceSettings({
  profile,
  connections,
  isIndex,
  saveVoice,
}: {
  profile: VoiceProfile;
  connections: readonly TtsConnection[];
  isIndex: boolean;
  saveVoice: (body: VoiceProfilePatch) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(() => missingSettings(profile, isIndex).length > 0);
  const bodyId = useId();
  const connection = connections.find((c) => c.id === profile.connection_id) ?? null;
  const summary = settingsSummary(profile, connection, isIndex);
  const save = (key: SettingKey, raw: string) => {
    const body = settingPatch(profile, key, raw);
    return body ? saveVoice(body) : false;
  };
  const options = connections.map(connectionOption);
  return (
    <section className="vo-panel vo-settings" aria-label="声音设置">
      <button
        type="button"
        className="vo-settings-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vo-title">声音设置</span>
        {!open && (
          <span className={`vo-note${summary.warn ? ' warn' : ''}`} title={summary.text}>
            {summary.text}
          </span>
        )}
        <span className="st-flex" />
        <Icon name="chev" size={15} className={open ? 'vo-chev open' : 'vo-chev'} />
      </button>
      {open && (
        <div id={bodyId} className="vo-settings-body">
          <div className="vo-set-field">
            <FieldLabel text="名字" />
            <CommitInput label="声音名" value={profile.name} maxLength={LABEL_MAX} onCommit={(v) => save('name', v)} />
          </div>
          <div className="vo-set-field">
            <FieldLabel text="语音服务" help={TERMS.ttsService} />
            <SelectBox
              label="语音服务"
              value={profile.connection_id}
              options={connection ? options : [{ value: profile.connection_id, label: '没选语音服务' }, ...options]}
              disabled={connections.length === 0}
              onChange={(v) => void save('connection_id', v)}
            />
          </div>
          <div className="vo-set-field">
            <FieldLabel text="语言" help={TERMS.voiceLang} />
            <SelectBox
              label="语言"
              value={profile.text_lang}
              options={langOptions(profile.text_lang, isIndex)}
              onChange={(v) => void save('text_lang', v)}
            />
          </div>
          <div className="vo-set-field">
            <FieldLabel text="别名" help={TERMS.speakerAlias} />
            <TagsField
              values={profile.aliases}
              onChange={(next) => {
                const body = aliasesPatch(profile, next);
                if (body) void saveVoice(body);
              }}
            />
          </div>
          {isIndex ? (
            <div className="vo-set-field wide">
              <FieldLabel text="音色参考" help={TERMS.speakerRef} />
              <CommitInput
                path
                label="音色参考的路径"
                value={profile.ref_path}
                placeholder="D:/AnimaVoice/refs/角色/【平静】原文.wav"
                onCommit={(v) => save('ref_path', v)}
              />
            </div>
          ) : (
            <>
              <div className="vo-set-field">
                <FieldLabel text="GPT 权重(.ckpt)" help={TERMS.gptWeights} />
                <CommitInput
                  path
                  label="GPT 权重的路径"
                  value={profile.gpt_weights}
                  placeholder="D:/AnimaVoice/models/角色/角色-e10.ckpt"
                  onCommit={(v) => save('gpt_weights', v)}
                />
              </div>
              <div className="vo-set-field">
                <FieldLabel text="SoVITS 权重(.pth)" help={TERMS.sovitsWeights} />
                <CommitInput
                  path
                  label="SoVITS 权重的路径"
                  value={profile.sovits_weights}
                  placeholder="D:/AnimaVoice/models/角色/角色_e10_s230_l32.pth"
                  onCommit={(v) => save('sovits_weights', v)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 试听

interface Take extends Clip {
  /** 后端实际用的情绪(对不上时是默认那行) */
  emotion: string;
  cache: 'hit' | 'miss';
  ms: number;
  /** 用的固定种子;没固定是 null */
  seed: number | null;
}

function Bench({
  profile,
  isIndex,
  emotionLabel,
  onEmotion,
  preview,
  seed,
}: {
  profile: VoiceProfile;
  isIndex: boolean;
  emotionLabel: string;
  onEmotion: (label: string) => void;
  preview: Preview;
  /** 「更多参数」里填的固定种子(只有 GSV);填得不对时不让合成 */
  seed: { seed: number | null; bad: boolean };
}) {
  const samples = samplesFor(profile.text_lang);
  const [text, setText] = useState(samples[0].text);
  // 「声音设置」里换了语言:框里还是内置例句的话换成同一句的这个语言版本(日语声音别去念中文例句)
  const lang = sampleLangOf(profile.text_lang);
  const [textLang, setTextLang] = useState(lang);
  if (lang !== textLang) {
    setTextLang(lang);
    setText(sampleIn(text, lang));
  }
  const [take, setTake] = useState<Take | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = benchBlocker(profile, isIndex);
  const canRun = Boolean(text.trim()) && !busy && !missing && !seed.bad;

  const synth = async () => {
    if (!canRun) return;
    // 在点击里解锁:合成要一两秒,回来就不算用户手势了
    audioBus.unlock();
    setBusy(true);
    setError(null);
    try {
      const r = await debugApi.speak(
        { profile_id: profile.id, emotion: emotionLabel || null, text: text.trim() },
        false,
        benchTuning(profile, seed.seed, isIndex),
      );
      const clip = await decode(r.audio, BENCH_BARS);
      const next: Take = { ...clip, emotion: r.emotion, cache: r.cache, ms: r.ms, seed: isIndex ? null : seed.seed };
      setTake(next);
      await preview.play('take', next);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (!take) return;
    if (preview.playing('take')) preview.stop();
    else {
      audioBus.unlock();
      void preview.play('take', take).catch((e: unknown) => setError(errText(e)));
    }
  };

  const pos = preview.pos('take');
  const current = profile.emotions.find((e) => e.label === emotionLabel);
  return (
    <section className="vo-panel vo-bench" aria-label="试听">
      <div className="vo-bench-head">
        <span className="vo-title">试听</span>
        <span className="vo-note">输入台词,选择情绪,试听合成效果</span>
        <span className="st-flex" />
        <span className="vo-samples" role="group" aria-label="例句">
          {samples.map((s) => (
            <button
              key={s.name}
              type="button"
              className={`vo-sample${text.trim() === s.text ? ' on' : ''}`}
              title={s.text}
              onClick={() => setText(s.text)}
            >
              {s.name}
            </button>
          ))}
        </span>
      </div>
      <textarea
        className="vo-bench-text"
        rows={2}
        maxLength={500}
        value={text}
        placeholder="要念的台词"
        aria-label="要念的台词"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="vo-bench-row">
        <span className="vo-label">情绪</span>
        <div className={`st-select vo-emo${profile.emotions.length === 0 ? ' disabled' : ''}`}>
          <span className="st-select-value">{emotionLabel || '默认'}</span>
          {current && current === profile.emotions[0] && <span className="st-select-sub">默认</span>}
          <Icon name="chev" size={14} />
          <select
            aria-label="试听用的情绪"
            value={emotionLabel}
            disabled={profile.emotions.length === 0}
            onChange={(e) => onEmotion(e.target.value)}
          >
            {profile.emotions.map((e, i) => (
              <option key={e.id} value={e.label}>
                {i === 0 ? `${e.label}(默认)` : e.label}
              </option>
            ))}
          </select>
        </div>
        <span className="st-flex" />
        <Btn kind="primary" icon={busy ? undefined : 'play'} disabled={!canRun} onClick={() => void synth()}>
          {busy ? '合成中…' : '合成'}
        </Btn>
      </div>
      <div className="vo-player">
        <RoundPlay
          size={34}
          playing={preview.playing('take')}
          loading={busy}
          disabled={!take || busy}
          label="播放这句"
          onClick={toggle}
        />
        <div className="vo-player-wave">
          {take ? (
            <Wave peaks={take.peaks} bars={BENCH_BARS} height={38} progress={take.duration ? pos / take.duration : 0} />
          ) : (
            <span className="vo-player-hint">{busy ? '合成中…' : '点「合成」听这句'}</span>
          )}
        </div>
        <span className="vo-time">{take ? progressText(pos, take.duration) : '— / — 秒'}</span>
      </div>
      {(missing || error || take) && (
        <div className={`vo-bench-foot${missing || error ? ' error' : ''}`} role={error ? 'alert' : undefined}>
          {missing ||
            error ||
            (take &&
              [
                `用「${take.emotion || '默认'}」念`,
                take.cache === 'hit' ? '缓存里的' : '新合成',
                secs(take.ms),
                ...(take.seed !== null ? [`种子 ${take.seed}`] : []),
              ].join(' · '))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 右栏

/**
 * 一行输入框:打字只改自己,回车 / 失焦才交出去,Esc 放弃;外面的值变了(换了一行、存好了)就跟着换。
 * onCommit 回 false(没存成:重名、清空了名字)时退回原值。path = 路径的样子(等宽小字)
 */
function CommitInput({
  value,
  label,
  placeholder,
  path,
  maxLength,
  onCommit,
}: {
  value: string;
  /** 读屏用的名字 */
  label: string;
  placeholder?: string;
  path?: boolean;
  maxLength?: number;
  onCommit: (next: string) => Promise<boolean> | boolean | void;
}) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = async () => {
    if (draft.trim() === value) return;
    if ((await onCommit(draft)) === false) setDraft(value);
  };
  return (
    <input
      className={`st-input${path ? ' vo-path' : ''}`}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      maxLength={maxLength}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function EmotionInspector({
  profile,
  connection,
  isIndex,
  emotion: e,
  index,
  refClip,
  refError,
  refLoading,
  preview,
  onPlayRef,
  onRename,
  onMakeDefault,
  onDelete,
  saveEmotion,
  saveVoice,
  seed,
  notify,
}: {
  profile: VoiceProfile;
  connection: TtsConnection | null;
  isIndex: boolean;
  emotion: VoiceEmotion | null;
  index: number;
  refClip: Clip | null;
  refError: string | null;
  refLoading: boolean;
  preview: Preview;
  onPlayRef: (e: VoiceEmotion) => void;
  onRename: () => void;
  onMakeDefault: (e: VoiceEmotion) => void;
  onDelete: (e: VoiceEmotion) => void;
  saveEmotion: (e: VoiceEmotion, body: VoiceEmotionPatch) => Promise<boolean>;
  saveVoice: (body: VoiceProfilePatch) => Promise<boolean>;
  seed: SeedBox;
  notify: Notify;
}) {
  const count = profile.emotions.length;
  const [warm, setWarm] = useState<{ busy: boolean; text: string } | null>(null);
  const warmup = async () => {
    setWarm({ busy: true, text: '预加载中…(服务刚启动时要 40 秒左右)' });
    try {
      const r = await debugApi.warmupVoice(profile.id, true);
      setWarm({ busy: false, text: `已预加载 · ${secs(r.ms)}` });
    } catch (err) {
      setWarm({ busy: false, text: '预加载失败' });
      notify('error', `预加载失败:${errText(err)}`);
    }
  };

  const key = e ? `ref:${e.id}` : '';
  const playing = e ? preview.playing(key) : false;
  const head = e ? (
    <InspectorHead
      media={
        <RoundPlay
          size={48}
          playing={playing}
          loading={refLoading}
          disabled={!e.ref_path}
          label={e.ref_path ? '听参考音频原声' : '这一行没有参考音频'}
          onClick={() => onPlayRef(e)}
        />
      }
      title={
        <button type="button" className="vo-ihead-name" title="改情绪名" onClick={onRename}>
          {e.label}
        </button>
      }
      badge={
        index === 0 ? (
          <>
            <Chip strong>默认情绪</Chip>
            未匹配的差分使用此项
          </>
        ) : (
          <>
            第 {index + 1} 种 · 共 {count} 种
            <button type="button" className="st-link" onClick={() => onMakeDefault(e)}>
              设为默认
            </button>
          </>
        )
      }
    />
  ) : (
    <InspectorHead title="还没有情绪" badge="先在左边「新增情绪」" />
  );

  return (
    <Inspector
      label={e ? `调整「${e.label}」` : '声音的全局参数'}
      head={head}
      footer={
        <>
          <Btn small icon="flame" disabled={warm?.busy} onClick={() => void warmup()}>
            预加载
          </Btn>
          <span className="vo-foot-note" title={warm?.text ?? '语音服务刚重启、或者那边手动切过权重之后,先让它把这个声音加载好'}>
            {warm?.text ?? '服务重启后用'}
          </span>
          <span className="st-flex" />
          {e && <ArmedBtn small label="删除此情绪" onConfirm={() => onDelete(e)} />}
        </>
      }
    >
      {e && (
        <>
          <Section title={isIndex ? '情绪参考' : '参考音频'} help={TERMS.ref} first />
          <div className="vo-refcard">
            <button
              type="button"
              className="vo-refwave"
              disabled={!e.ref_path}
              aria-label={playing ? '停' : '听参考音频原声'}
              onClick={() => onPlayRef(e)}
            >
              <Wave
                peaks={refClip?.peaks ?? null}
                bars={REF_BARS}
                height={34}
                progress={refClip?.duration ? preview.pos(key) / refClip.duration : 0}
              />
              <span className="vo-time small">
                {refClip ? progressText(preview.pos(key), refClip.duration) : refLoading ? '取回中…' : e.ref_path ? '▶ 原声' : ''}
              </span>
            </button>
            <CommitInput
              path
              label="参考音频的路径"
              value={e.ref_path}
              placeholder={isIndex ? '可选。填了就照这段的语气念,向量不生效' : 'D:/AnimaVoice/refs/角色/【平静】原文.wav'}
              onCommit={(v) => void saveEmotion(e, refPatch(e, v))}
            />
            <span className={`vo-refnote${refError ? ' error' : ''}`}>
              {refError ?? (e.ref_path ? basename(e.ref_path) : '文件在语音机上,这里填的是那边的路径')}
            </span>
          </div>

          {!isIndex && (
            <div className="vo-field">
              <FieldLabel text="参考文本" help={TERMS.refText} />
              <CommitTextarea
                rows={2}
                value={e.prompt_text}
                placeholder="参考音频里说的原话,一字不差"
                onCommit={(v) => void saveEmotion(e, { prompt_text: v })}
              />
            </div>
          )}

          <div className="vo-field">
            <FieldLabel text="别名" help={TERMS.voiceAlias} />
            <TagsField values={e.aliases} onChange={(v) => void saveEmotion(e, { aliases: v })} />
          </div>

          {/* 辅助参考只在这一行已经挂了的时候出现,能删不能加:10-15 用户试听,多挂辅助参考效果比较差 */}
          {!isIndex && e.aux_refs.length > 0 && (
            <div className="vo-field">
              <div className="st-label">
                辅助参考
                <HelpTip text={TERMS.aux} />
                <span className="vo-aux-count">{e.aux_refs.length} 段</span>
              </div>
              <div className="vo-aux">
                {e.aux_refs.map((p) => (
                  <span key={p} className="vo-aux-item" title={p}>
                    <span className="vo-aux-name">{basename(p)}</span>
                    <button
                      type="button"
                      className="st-tag-x"
                      aria-label={`去掉辅助参考「${basename(p)}」`}
                      title="去掉这段"
                      onClick={() => void saveEmotion(e, { aux_refs: e.aux_refs.filter((x) => x !== p) })}
                    >
                      <Icon name="x" size={11} strokeWidth={2.2} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {isIndex && (
            <div className="vo-field">
              <EmotionVectorEditor
                value={e.emo_vector}
                disabled={!!e.ref_path}
                onCommit={(v) => saveEmotion(e, { emo_vector: v })}
              />
            </div>
          )}
        </>
      )}

      <GlobalParams
        profile={profile}
        connection={connection}
        isIndex={isIndex}
        first={!e}
        saveVoice={saveVoice}
        seed={seed}
      />
    </Inspector>
  );
}

const TEMP = GSV_NUM_PARAMS.find((p) => p.key === 'temperature');
const ALPHA = INDEX_NUM_PARAMS.find((p) => p.key === 'emo_alpha');

/** 「全局参数」:作用于这个声音的全部情绪,改完直接存到声音上;GPT-SoVITS 下面还有收起来的「更多参数」 */
function GlobalParams({
  profile,
  connection,
  isIndex,
  first,
  saveVoice,
  seed,
}: {
  profile: VoiceProfile;
  connection: TtsConnection | null;
  isIndex: boolean;
  first: boolean;
  saveVoice: (body: VoiceProfilePatch) => Promise<boolean>;
  seed: SeedBox;
}) {
  // 拖的时候只改这里(跟手),松手才存
  const [draft, setDraft] = useState<{ speed?: number; temp?: number; alpha?: number }>({});
  const commit = async (k: 'speed' | 'temp' | 'alpha', body: VoiceProfilePatch) => {
    await saveVoice(body);
    setDraft((d) => {
      const next = { ...d };
      delete next[k];
      return next;
    });
  };
  const alphaDef = connection?.emo_alpha ?? 1;
  const speed = draft.speed ?? profile.speed;
  const temp = draft.temp ?? profile.params.temperature ?? TEMP?.def ?? 1;
  const alpha = draft.alpha ?? profile.params.emo_alpha ?? alphaDef;
  const split = profile.params.text_split_method ?? 'cut5';
  return (
    <>
      <Section title="全局参数" note={`作用于全部 ${profile.emotions.length} 种情绪`} first={first} />
      <SliderRow
        label="语速"
        {...SPEED_RANGE}
        value={speed}
        format={fmtSpeed}
        onChange={(v) => setDraft((d) => ({ ...d, speed: v }))}
        onCommit={(v) => void commit('speed', { speed: round2(v) })}
      />
      {isIndex ? (
        <SliderRow
          label="情绪强度"
          min={ALPHA?.min ?? 0}
          max={ALPHA?.max ?? 1}
          step={ALPHA?.step ?? 0.05}
          value={alpha}
          format={(v) => v.toFixed(2)}
          note={ALPHA?.note}
          onChange={(v) => setDraft((d) => ({ ...d, alpha: v }))}
          onCommit={(v) => void commit('alpha', { params: withParam(profile.params, 'emo_alpha', round2(v), alphaDef) })}
        />
      ) : (
        <>
          <SliderRow
            label="温度"
            help={TERMS.temp}
            min={TEMP?.min ?? 0.05}
            max={TEMP?.max ?? 1.5}
            step={TEMP?.step ?? 0.05}
            value={temp}
            format={(v) => v.toFixed(2)}
            onChange={(v) => setDraft((d) => ({ ...d, temp: v }))}
            onCommit={(v) =>
              void commit('temp', { params: withParam(profile.params, 'temperature', round2(v), TEMP?.def ?? 1) })
            }
          />
          <SelectRow
            label="切分"
            help={TERMS.split}
            value={split}
            options={TEXT_SPLIT_METHODS.map((m) => ({
              value: m.value,
              label: m.name,
              sub: m.value === 'cut5' ? '默认' : undefined,
            }))}
            onChange={(v) =>
              void saveVoice({
                params: withParam(
                  profile.params,
                  'text_split_method',
                  v as NonNullable<VoiceProfile['params']['text_split_method']>,
                  'cut5',
                ),
              })
            }
          />
          <MoreParams profile={profile} connSteps={connection?.sample_steps ?? 64} saveVoice={saveVoice} seed={seed} />
        </>
      )}
    </>
  );
}

/** 「固定种子」框:字放在 Loaded 里,试听台和「更多参数」共用 */
interface SeedBox {
  text: string;
  onText: (text: string) => void;
}

const MORE_HELP: Partial<Record<keyof VoiceParams, string>> = {
  sample_steps: TERMS.sampleSteps,
  top_p: TERMS.topP,
  top_k: TERMS.topK,
  repetition_penalty: TERMS.repPenalty,
  fragment_interval: TERMS.fragInterval,
};

/**
 * 「更多参数」(只有 GPT-SoVITS,默认收起,收着时写改过哪几项):旧试音台里有、上面没单独放的几项 ——
 * 采样步数、top_p、top_k、重复惩罚、句间停顿、并行推理,存在声音上(调回默认就删掉那一项);
 * 固定种子只用于上面的试听,不存
 */
function MoreParams({
  profile,
  connSteps,
  saveVoice,
  seed,
}: {
  profile: VoiceProfile;
  /** 采样步数没设时跟的语音服务的步数 */
  connSteps: number;
  saveVoice: (body: VoiceProfilePatch) => Promise<boolean>;
  seed: SeedBox;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  // 拖的时候只改这里(跟手),松手才存
  const [draft, setDraft] = useState<Partial<Record<keyof VoiceParams, number>>>({});
  const commit = async (key: (typeof MORE_GSV_PARAMS)[number]['key'], value: number, def: number) => {
    await saveVoice({ params: withParam(profile.params, key, value, def) });
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };
  const parallel = profile.params.parallel_infer ?? true;
  const { seed: seedValue, bad: seedBad } = parseSeed(seed.text);
  const note =
    [moreParamsSummary(profile.params), ...(seedValue !== null ? [`种子 ${seedValue}`] : [])].join(' · ') || '全部默认';
  return (
    <>
      <button
        type="button"
        className="vo-more"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="st-section-title">更多参数</span>
        <span className="vo-more-note" title={note}>
          {note}
        </span>
        <span className="st-flex" />
        <Icon name="chev" size={15} className={open ? 'vo-chev open' : 'vo-chev'} />
      </button>
      {open && (
        <div id={bodyId} className="vo-more-body">
          {MORE_GSV_PARAMS.map((p) => {
            const def = paramDefault(p, connSteps);
            const whole = p.step >= 1;
            return (
              <SliderRow
                key={p.key}
                label={p.name}
                help={MORE_HELP[p.key]}
                min={p.min}
                max={p.max}
                step={p.step}
                value={draft[p.key] ?? profile.params[p.key] ?? def}
                format={(v) =>
                  // 带单位的(句间停顿「0.3秒」)去掉末尾的 0,放得下
                  whole ? String(Math.round(v)) : p.unit ? `${round2(v)}${p.unit}` : v.toFixed(2)
                }
                onChange={(v) => setDraft((d) => ({ ...d, [p.key]: v }))}
                onCommit={(v) => void commit(p.key, whole ? Math.round(v) : round2(v), def)}
              />
            );
          })}
          <div className="st-row">
            <span className="st-row-label">
              并行推理
              <HelpTip text={TERMS.parallel} />
            </span>
            <span className="st-flex" />
            <button
              type="button"
              role="switch"
              aria-checked={parallel}
              aria-label="并行推理"
              className="vo-switch"
              onClick={() =>
                void saveVoice({ params: withParam(profile.params, 'parallel_infer', !parallel, true) })
              }
            >
              <span className={`st-switch${parallel ? ' on' : ''}`} aria-hidden="true">
                <span className="st-switch-knob" />
              </span>
            </button>
          </div>
          <div className="st-row">
            <span className="st-row-label">
              固定种子
              <HelpTip text={TERMS.seed} />
            </span>
            <input
              className={`st-input vo-seed${seedBad ? ' bad' : ''}`}
              inputMode="numeric"
              aria-label="固定种子"
              aria-invalid={seedBad}
              placeholder="随机"
              value={seed.text}
              onChange={(e) => seed.onText(e.target.value)}
            />
          </div>
          {seedBad && <div className="vo-row-error">0 到 {SEED_MAX} 的整数</div>}
        </div>
      )}
    </>
  );
}
