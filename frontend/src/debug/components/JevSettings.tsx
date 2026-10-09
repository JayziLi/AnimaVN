import { useState, type ReactNode } from 'react';
import type { JevDefaults, JevKeyStatus } from '../lib/api';
import type { TagMode } from '../plugins/common';
import {
  SHARED_PROMPT_KEYS,
  SPEAKER_THRESHOLD,
  type JevKind,
  type JevKinds,
  type JevPluginConfig,
  type SharedPromptKey,
} from '../plugins/jev';
import type { JevStats, JevTrial } from '../plugins/jevRun';
import { DeleteButton } from './pluginFields';

/**
 * 插件页里 Jev 标注的几块(设计见 docs/superpowers/specs/2026-10-01-jev-director-design.md 第三节):
 *   ModeBar        立绘 / 背景 / BGM / CG / 玩家台词每页最上面:二选一「AI 写标签 | Jev 标注」+ 一行说明
 *   JevCommon      几个插件共用的设置:key 和测试、立绘和文字同步、说话人门槛、通用问法、试判
 *   PromptField    一道题的问法:显示默认、改了存下来、能恢复默认
 *   ThresholdField 门槛滑条
 */

/** 插件抽屉拿到的 Jev 相关的东西(DebugApp 拼好传进来) */
export interface JevControls {
  config: JevPluginConfig;
  onChangeConfig: (next: JevPluginConfig) => void;
  keyStatus: JevKeyStatus | null;
  onSaveKey: (key: string) => Promise<void>;
  /** 后端的默认问法;后端还是旧版时为 null */
  defaults: JevDefaults | null;
  onTest: () => Promise<{ ms: number }>;
  onTrial: () => Promise<JevTrial>;
  /** 每类现在实际在不在用 Jev(模式是 jev 且有 key) */
  kinds: JevKinds;
  /** 最新一条 AI 回复的 Jev 统计 */
  lastStats: JevStats | null;
}

type Notify = (kind: 'ok' | 'error', message: string) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const usd = (tokens: number) => `$${((tokens * 0.042) / 1e6).toFixed(4)}`;

// ─────────────────────────── 标题栏 ───────────────────────────

export function ModeBar({
  name,
  kind,
  mode,
  onChangeMode,
  jev,
  aiNote,
  jevNote,
}: {
  name: string;
  kind: JevKind;
  mode: TagMode;
  onChangeMode: (mode: TagMode) => void;
  jev: JevControls;
  aiNote: string;
  jevNote: string;
}) {
  const s = jev.lastStats;
  let note: ReactNode = aiNote;
  let warn = false;
  if (mode === 'jev') {
    if (jev.defaults === null) {
      note = '后端还是旧版,不认 Jev 标注 —— 重启后端。现在照旧由 AI 写标签';
      warn = true;
    } else if (!jev.keyStatus?.has_key) {
      note = '还没设 Jev 的 key(下面「Jev 通用设置」里填)—— 现在照旧由 AI 写标签';
      warn = true;
    } else {
      note = jevNote;
      if (s && s.kinds.includes(kind)) {
        note += ` · 上一条回复:判了 ${s.lines} 句,最慢 ${(s.maxMs / 1000).toFixed(2)} 秒`;
        if (s.failed) note += `,${s.failed} 句没判成`;
      }
    }
  }
  return (
    <div className="pl-modebar">
      <div className="pl-modebar-head">
        <span className="pl-modebar-name">{name}</span>
        <div className="pl-mode" role="radiogroup" aria-label={`${name}的标签由谁写`}>
          {(['ai', 'jev'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => mode !== m && onChangeMode(m)}
            >
              {m === 'ai' ? 'AI 写标签' : 'Jev 标注'}
            </button>
          ))}
        </div>
      </div>
      <span className={warn ? 'pl-error' : 'sp-group-note'}>{note}</span>
    </div>
  );
}

// ─────────────────────────── 一道题的问法 ───────────────────────────

const PLACEHOLDER_HINT: Record<string, string> = {
  char: '角色名',
  user: '玩家名',
  n: '第几句',
  line: '这句原文(前 50 字)',
  current: '现在的背景 / 曲子',
  current_desc: '它的说明(带括号)',
};

/** 问「第几句」的题没写 {{n}},Jev 就不知道问的是哪句 */
const NEEDS_N = new Set(['speaker', 'emotion', 'bg', 'bgm', 'cg']);
const PROMPT_MAX = 500;

export function PromptField({
  label,
  promptKey,
  value,
  defaults,
  placeholders,
  onChange,
  rows = 3,
}: {
  label: string;
  promptKey: string;
  /** 改过的;null = 用默认 */
  value: string | null;
  defaults: JevDefaults | null;
  placeholders: (keyof typeof PLACEHOLDER_HINT)[];
  onChange: (next: string | null) => void;
  rows?: number;
}) {
  const def = defaults?.prompts[promptKey] ?? null;
  // 正在改的时候显示自己的草稿:清空、或者恰好改成和默认一样时 value 会变回 null,
  // 直接显示 value ?? def 的话默认问法会立刻跳回来,新打的字接在它后面
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? def ?? '';
  const missingN = NEEDS_N.has(promptKey) && !shown.includes('{{n}}');
  return (
    <div className="pl-prompt">
      <div className="pl-row">
        <span className="pl-prompt-label">{label}</span>
        {value !== null && <span className="pl-badge">改过</span>}
        <div style={{ flex: 1 }} />
        <button className="btn small" disabled={value === null} onClick={() => onChange(null)}>
          恢复默认
        </button>
      </div>
      <textarea
        className="text-input pl-wide pl-textarea"
        rows={rows}
        maxLength={PROMPT_MAX}
        value={shown}
        spellCheck={false}
        placeholder={def === null ? '(后端还没更新,拿不到默认问法)' : undefined}
        onFocus={() => setDraft(value ?? def ?? '')}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          onChange(!v.trim() || v === def ? null : v);
        }}
      />
      <span className="sp-group-note">
        {placeholders.map((p) => (
          <span key={p} className="pl-ph">
            <code className="pl-code">{`{{${p}}}`}</code> {PLACEHOLDER_HINT[p]}
          </span>
        ))}
      </span>
      {missingN && <span className="pl-error">没写 {'{{n}}'}:Jev 不知道问的是哪一句</span>}
    </div>
  );
}

// ─────────────────────────── 门槛 ───────────────────────────

export function ThresholdField({
  label,
  value,
  def,
  min,
  max,
  low,
  high,
  note,
  onChange,
}: {
  label: string;
  value: number;
  def: number;
  min: number;
  max: number;
  /** 滑条两头的说明 */
  low: string;
  high: string;
  note: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="vb-params">
      <div className={`vb-param${value === def ? ' is-default' : ''}`}>
        <span className="vb-param-name">{label}</span>
        <div className="vb-param-ctl">
          <span className="vb-param-def">{low}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={0.05}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={label}
          />
          <span className="vb-param-def">{high}</span>
          <span className="vb-param-value">{value.toFixed(2)}</span>
          <button className="btn small" disabled={value === def} onClick={() => onChange(def)}>
            默认 {def}
          </button>
        </div>
        <span className="vb-param-note">{note}</span>
      </div>
    </div>
  );
}

// ─────────────────────────── 几个插件共用的设置 ───────────────────────────

const SHARED_LABELS: Record<SharedPromptKey, { label: string; placeholders: (keyof typeof PLACEHOLDER_HINT)[] }> = {
  state: { label: '通用说明(每次放在最前面)', placeholders: ['char', 'user'] },
  speaker: { label: '说话人题', placeholders: ['n', 'line', 'char', 'user'] },
  speaker_char: { label: '　选项「角色」的说明', placeholders: ['char', 'user'] },
  speaker_user: { label: '　选项「玩家」的说明', placeholders: ['char', 'user'] },
  speaker_other: { label: '　选项「别人」的说明', placeholders: ['char', 'user'] },
  speaker_none: { label: '　选项「不是说话」的说明', placeholders: ['char', 'user'] },
};

const SPEAKER_NAME: Record<string, string> = { char: '角色', user: '玩家', other: '别人', none: '不是说话' };

export function JevCommon({ jev, notify }: { jev: JevControls; notify: Notify }) {
  const { config, onChangeConfig, keyStatus, defaults } = jev;
  // 没 key 时默认展开,让人一眼看到要填什么
  const [open, setOpen] = useState(!keyStatus?.has_key);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const [trial, setTrial] = useState<JevTrial | null>(null);

  const saveKey = async (key: string) => {
    setBusy('key');
    try {
      await jev.onSaveKey(key);
      setDraft('');
      setTested(null);
      notify('ok', key ? 'Jev 的 key 已保存' : 'Jev 的 key 已删除');
    } catch (e) {
      notify('error', `保存失败: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy('test');
    try {
      const { ms } = await jev.onTest();
      setTested({ ok: true, text: `通了 · ${(ms / 1000).toFixed(2)} 秒` });
    } catch (e) {
      setTested({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  const runTrial = async () => {
    setBusy('trial');
    try {
      setTrial(await jev.onTrial());
    } catch (e) {
      notify('error', `试判失败: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const setPrompt = (k: SharedPromptKey, v: string | null) =>
    onChangeConfig({ ...config, prompts: { ...config.prompts, [k]: v } });

  const keyText =
    keyStatus === null
      ? '正在问后端…'
      : keyStatus.has_key
        ? keyStatus.source === 'env'
          ? 'key 已设置(后端环境变量 JEV_API_KEY)'
          : 'key 已设置'
        : '还没设 key';
  const s = jev.lastStats;

  return (
    <div className="sp-group pl-jev">
      <div className="sp-group-head">
        <span className="sp-group-title">Jev 通用设置</span>
        <span className="sp-group-note">几个插件共用,在哪个插件里改都一样。</span>
      </div>
      <div className={`pl-status ${keyStatus?.has_key ? 'on' : 'missing'}`}>
        <span className="pl-status-dot" />
        <span className="pl-status-text">
          {keyText}
          {s && s.kinds.length > 0 &&
            ` · 上一条回复:判了 ${s.lines} 句、${s.requests} 次请求,最慢 ${(s.maxMs / 1000).toFixed(2)} 秒,${s.tokens.toLocaleString()} token(约 ${usd(s.tokens)})${s.failed ? `,${s.failed} 句没判成:${s.error ?? ''}` : ''}`}
        </span>
        <button className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <>
          <div className="pl-sub">
            <span className="pl-prompt-label">Jev 的 key</span>
            <span className="sp-group-note">
              在 typesafe.ai 的控制台创建。只存在后端,填了以后这里读不回来;后端设了环境变量 JEV_API_KEY 时用环境变量的。
            </span>
            {keyStatus?.source !== 'env' && (
              <div className="pl-row">
                <input
                  className="text-input"
                  type="password"
                  autoComplete="off"
                  placeholder={keyStatus?.has_key ? '换一个 key' : '粘贴 Jev 的 API key'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="btn small accent"
                  disabled={busy !== null || !draft.trim()}
                  onClick={() => void saveKey(draft.trim())}
                >
                  保存
                </button>
                {/* key 只能写不能读,删了就找不回来:和别处的删除一样点两次 */}
                {keyStatus?.has_key && <DeleteButton disabled={busy !== null} onConfirm={() => void saveKey('')} />}
              </div>
            )}
            <div className="pl-row">
              <button className="btn small" disabled={busy !== null || !keyStatus?.has_key} onClick={() => void test()}>
                {busy === 'test' ? '测试中…' : '测试'}
              </button>
              {tested && <span className={tested.ok ? 'sp-group-note' : 'pl-error'}>{tested.text}</span>}
            </div>
          </div>

          <div className="pl-sub">
            <label className="vp-check">
              <input
                type="checkbox"
                checked={config.syncText}
                onChange={(e) => onChangeConfig({ ...config, syncText: e.target.checked })}
              />
              立绘和文字同步
            </label>
            <span className="sp-group-note">
              开着:你追上生成进度的那句,等 Jev 判完立绘 / 背景再出字,画面和文字一起变;这句出字因此晚约 0.7 秒
              (日中对照约 1.2 秒),最多等 2 秒。关着:文字照常边写边出,立绘 / 背景晚一点换。没追上的句子不受影响。
            </span>
          </div>

          <div className="pl-sub">
            <ThresholdField
              label="说话人门槛"
              value={config.speakerThreshold}
              def={SPEAKER_THRESHOLD.def}
              min={SPEAKER_THRESHOLD.min}
              max={SPEAKER_THRESHOLD.max}
              low="更敢判成别人"
              high="更不容易漏念"
              note="Jev 判「这句不是角色说的」要多大把握才信;不够就还算角色的(照常念、换立绘)"
              onChange={(v) => onChangeConfig({ ...config, speakerThreshold: v })}
            />
          </div>

          <div className="pl-sub">
            <span className="pl-prompt-label">问法</span>
            <span className="sp-group-note">
              每次判断时发给 Jev 的说明和题目,改了下一句就用新的。表情、场景、音乐的题在各自插件里。
            </span>
            {SHARED_PROMPT_KEYS.map((k) => (
              <PromptField
                key={k}
                label={SHARED_LABELS[k].label}
                promptKey={k}
                value={config.prompts[k]}
                defaults={defaults}
                placeholders={SHARED_LABELS[k].placeholders}
                onChange={(v) => setPrompt(k, v)}
                rows={k === 'state' ? 3 : 2}
              />
            ))}
          </div>

          <div className="pl-sub">
            <div className="pl-row">
              <span className="pl-prompt-label">试判</span>
              <div style={{ flex: 1 }} />
              <button className="btn small accent" disabled={busy !== null} onClick={() => void runTrial()}>
                {busy === 'trial' ? '判断中…' : '用最新一条回复试判'}
              </button>
            </div>
            <span className="sp-group-note">
              用现在的设置和问法,把当前对话最新一条 AI 回复整条判一遍,按句列出结果。不改存档,一次不到 0.001 美元。
            </span>
            {trial && <TrialTable trial={trial} kinds={jev.kinds} keep={defaults?.keep ?? '不换'} />}
          </div>
        </>
      )}
    </div>
  );
}

function TrialTable({ trial, kinds, keep }: { trial: JevTrial; kinds: JevKinds; keep: string }) {
  const pct = (v: number | undefined) => (v === undefined ? '' : ` ${v.toFixed(2)}`);
  const s = trial.stats;
  return (
    <>
      <span className="sp-group-note">
        {trial.lines.length} 句,{s.requests} 次请求,共 {(trial.ms / 1000).toFixed(2)} 秒,{s.tokens.toLocaleString()} token
        (约 {usd(s.tokens)}){s.failed ? `,${s.failed} 句没判成:${s.error ?? ''}` : ''}。没问的格子是空的
        (旁白不问谁说的,台词不问场景;一条回复场景 / 音乐各只换一次,换过就不再问;CG 每句都问)。
      </span>
      <div className="vn-console-scroll">
        <table className="vn-console-table">
          <thead>
            <tr>
              <th>#</th>
              <th>句子</th>
              {(kinds.sprite || kinds.player) && <th>谁说的</th>}
              {kinds.sprite && <th>表情</th>}
              {kinds.bg && <th>场景</th>}
              {kinds.bgm && <th>音乐</th>}
              {kinds.cg && <th>CG</th>}
            </tr>
          </thead>
          <tbody>
            {trial.lines.map((l) => {
              const d = l.decision;
              const failed = d === 'failed';
              const dec = d && d !== 'failed' ? d : null;
              return (
                <tr key={l.index}>
                  <td>{l.index + 1}</td>
                  <td>{l.text.length > 40 ? `${l.text.slice(0, 40)}…` : l.text}</td>
                  {(kinds.sprite || kinds.player) && (
                    <td>{failed ? '没判成' : dec?.speaker ? `${SPEAKER_NAME[dec.speaker]}${pct(dec.confidence.speaker)}` : ''}</td>
                  )}
                  {kinds.sprite && <td>{dec?.emotion ? `${dec.emotion}${pct(dec.confidence.emotion)}` : ''}</td>}
                  {kinds.bg && <td>{dec?.bg ? `→ ${dec.bg}${pct(dec.confidence.bg)}` : ''}</td>}
                  {kinds.bgm && <td>{dec?.bgm ? `→ ${dec.bgm}${pct(dec.confidence.bgm)}` : ''}</td>}
                  {kinds.cg && (
                    <td>
                      {dec?.cg ? `→ ${dec.cg}${pct(dec.confidence.cg)}` : dec?.cg_off ? `收起${pct(dec.confidence.cg)}` : ''}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="sp-group-note">「→」是这句换成了什么;没换的不写(Jev 选了「{keep}」或者把握不够)。</span>
    </>
  );
}
