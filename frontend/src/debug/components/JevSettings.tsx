import { useState, type ReactNode } from 'react';
import type { JevDefaults, JevKeyStatus } from '../lib/api';
import type { TagMode } from '../plugins/common';
import type { JevKind, JevKinds, JevPluginConfig } from '../plugins/jev';
import type { JevStats, JevTrial } from '../plugins/jevRun';

/**
 * 插件页里 Jev 标注的几块(设计见 docs/superpowers/specs/2026-10-01-jev-director-design.md 第三节;
 * 10-16 起几个插件共用的设置都搬到了插件抽屉单独的「Jev 标注」页,见 JevPage.tsx):
 *   ModeBar        立绘 / 背景 / BGM / CG / 玩家台词每页最上面:二选一「AI 写标签 | Jev 标注」+ 一行说明;
 *                  有开关的(plugins/switches.ts)右上角再放一个总开关(PowerSwitch)
 *   JevPointer     Jev 模式下模式条下面一行:连接和共用设置在「Jev 标注」页 →;没 key 时变黄「去填 →」
 *   PromptField    一道题的问法:显示默认、改了存下来、能恢复默认
 *   ThresholdField 门槛滑条
 *   TrialTable     试判的结果表(Jev 页用)
 */

/** 插件抽屉拿到的 Jev 相关的东西(DebugApp 拼好传进来) */
export interface JevControls {
  config: JevPluginConfig;
  onChangeConfig: (next: JevPluginConfig) => void;
  keyStatus: JevKeyStatus | null;
  onSaveKey: (key: string) => Promise<void>;
  /** 地址和模型名(走中转时填);空串 = 用官方的 */
  onSaveEndpoint: (url: string, model: string) => Promise<void>;
  /** 后端的默认问法;后端还是旧版时为 null */
  defaults: JevDefaults | null;
  onTest: () => Promise<{ ms: number }>;
  onTrial: () => Promise<JevTrial>;
  /** 每类现在实际在不在用 Jev(模式是 jev 且有 key) */
  kinds: JevKinds;
  /** 最新一条 AI 回复的 Jev 统计 */
  lastStats: JevStats | null;
  /** 切到「Jev 标注」页(插件抽屉给) */
  openPage?: () => void;
}

// ─────────────────────────── 标题栏 ───────────────────────────

/** 插件的总开关(plugins/switches.ts):关掉 = 这个功能整个不用 */
export interface Power {
  on: boolean;
  onChange: (on: boolean) => void;
}

export const OFF_NOTE = '已关闭:提示词里不提、Jev 不判、游戏里不用这个功能。插件设置和预设都不动,打开就照旧';

/** 插件页右上角的小开关 */
export function PowerSwitch({ name, on, onChange }: Power & { name: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name}开关`}
      className={`pl-power${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
      title={on ? `关掉${name}` : `打开${name}`}
    >
      <span className="knob" />
    </button>
  );
}

export function ModeBar({
  name,
  kind,
  mode,
  onChangeMode,
  jev,
  aiNote,
  jevNote,
  power,
}: {
  name: string;
  kind: JevKind;
  mode: TagMode;
  onChangeMode: (mode: TagMode) => void;
  jev: JevControls;
  aiNote: string;
  jevNote: string;
  /** 这个插件的总开关(右上角);不给 = 没有开关 */
  power?: Power;
}) {
  const s = jev.lastStats;
  let note: ReactNode = aiNote;
  let warn = false;
  if (power && !power.on) {
    note = OFF_NOTE;
  } else if (mode === 'jev') {
    if (jev.defaults === null) {
      note = '后端还是旧版,不认 Jev 标注 —— 重启后端。现在照旧由 AI 写标签';
      warn = true;
    } else if (!jev.keyStatus?.has_key) {
      note = '还没填 Jev 的 key(在「Jev 标注」页填)—— 现在照旧由 AI 写标签';
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
        <div className={`pl-mode${power && !power.on ? ' dim' : ''}`} role="radiogroup" aria-label={`${name}的标签由谁写`}>
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
        {power && <PowerSwitch name={name} {...power} />}
      </div>
      <span className={warn ? 'pl-error' : 'sp-group-note'}>{note}</span>
    </div>
  );
}

/** Jev 模式下模式条下面一行:几个插件共用的东西都在「Jev 标注」页 */
export function JevPointer({ jev }: { jev: JevControls }) {
  const missing = jev.keyStatus !== null && !jev.keyStatus.has_key;
  return (
    <div className={`pl-jev-pointer${missing ? ' warn' : ''}`}>
      <span>
        {missing
          ? '还没填 Jev 的 key,现在照旧由 AI 写标签'
          : 'Jev 的连接、用量和共用设置(带上一条回复、立绘和文字同步、说话人门槛、通用问法、试判)在「Jev 标注」页'}
      </span>
      {jev.openPage && (
        <button type="button" className="btn small" onClick={jev.openPage}>
          {missing ? '去填 →' : '去 Jev 页 →'}
        </button>
      )}
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

// ─────────────────────────── 试判的结果 ───────────────────────────

const SPEAKER_NAME: Record<string, string> = { char: '角色', user: '玩家', other: '别人', none: '不是说话' };

export function TrialTable({ trial, kinds, keep }: { trial: JevTrial; kinds: JevKinds; keep: string }) {
  const pct = (v: number | undefined) => (v === undefined ? '' : ` ${v.toFixed(2)}`);
  const s = trial.stats;
  return (
    <>
      <span className="sp-group-note">
        {trial.lines.length} 句,{s.requests} 次请求,共 {(trial.ms / 1000).toFixed(2)} 秒,{s.tokens.toLocaleString()} token
        {s.failed ? `,${s.failed} 句没判成:${s.error ?? ''}` : ''}。没问的格子是空的
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
