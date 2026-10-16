import { useState } from 'react';
import type { BudgetReport } from '../../lib/assembler';
import { parseBudgetInput } from '../../lib/budget';
import { formatTokens } from '../../lib/tokens';
import { TERMS } from '../terms';
import { Inspector, Section, SelectRow } from '../ui';
import { ArmedBtn } from './ArmedBtn';
import { budgetUsage, tokenShare } from './tokenShare';

/**
 * 资料页 · 角色卡的右栏(照 V4CardInfo.png):这张卡怎么发给 AI。
 *
 *   绑定          玩家身份(人设)、预设 —— 选这张卡时自动切过去;改了当场就换
 *   Token 分布    整个提示词各部分占多少(下一次请求的 BudgetReport)
 *   上下文预算    数字框 + 用了几成 / 截掉几条 + 进度条;存在预设里(和左栏预算条同一个值)
 *   底部          红字「删除角色卡」,点两下
 */

interface Option {
  id: string;
  name: string;
}

/** 右栏「绑定」一栏要的东西(和调试台卡面板里的 CardBindings 改的是同一份数据) */
export interface ProfileBinding {
  personas: readonly Option[];
  /** 这张卡绑的人设;null = 没绑 */
  personaId: string | null;
  /** 没绑时用的默认人设名;没设默认人设是 null */
  defaultPersonaName: string | null;
  onPersona: (id: string | null) => void;
  presets: readonly Option[];
  /** 这张卡绑的预设;null = 没绑 */
  presetId: string | null;
  onPreset: (id: string | null) => void;
}

export interface ProfileSideProps {
  binding: ProfileBinding;
  report: BudgetReport;
  /** 当前预算;null = 不截断 */
  budget: number | null;
  /** 预算存在预设里:还没载入预设时不能改 */
  canBudget: boolean;
  onChangeBudget: (v: number | null) => void;
  busy: boolean;
  /** 已经点过两下了,直接删 */
  onDelete: () => void;
}

/** 预算数字框:打字只改自己,回车 / 失焦才交出去;空或 0 = 不截断,填错了弹回原值 */
function BudgetInput({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === null ? '' : String(value);
  const commit = () => {
    if (draft === null) return;
    const next = parseBudgetInput(draft);
    setDraft(null);
    if (next !== undefined && next !== value) onCommit(next);
  };
  return (
    <input
      className="pf-budget-input"
      inputMode="numeric"
      aria-label="上下文预算(token)"
      placeholder="不截断"
      value={draft ?? shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

export function ProfileSide({ binding, report, budget, canBudget, onChangeBudget, busy, onDelete }: ProfileSideProps) {
  const share = tokenShare(report.parts);
  const usage = budgetUsage(report, budget);
  return (
    <Inspector
      label="这张卡怎么发给 AI"
      footer={
        <>
          <span className="st-flex" />
          <ArmedBtn label="删除角色卡" disabled={busy} onConfirm={onDelete} />
        </>
      }
    >
      <div className="pf-side">
        <Section title="绑定" help={TERMS.bind} first />
        <SelectRow
          label="玩家身份"
          value={binding.personaId ?? ''}
          disabled={busy}
          options={[
            {
              value: '',
              label: binding.defaultPersonaName
                ? `不绑定(用默认人设「${binding.defaultPersonaName}」)`
                : '不绑定(不自动切换)',
            },
            ...binding.personas.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(v) => binding.onPersona(v || null)}
        />
        <SelectRow
          label="预设"
          value={binding.presetId ?? ''}
          disabled={busy}
          options={[
            { value: '', label: '不绑定(用对话记的预设)' },
            ...binding.presets.map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(v) => binding.onPreset(v || null)}
        />
        <div className="pf-gap" />

        <Section
          title="Token 分布"
          help={TERMS.token}
          right={<span className="pf-side-total">~{formatTokens(share.total)}</span>}
        />
        <div className="pf-share-bar" role="img" aria-label={share.segments.map((s) => `${s.name} ${s.tokens}`).join('、')}>
          {share.segments
            .filter((s) => s.tokens > 0)
            .map((s) => (
              <span
                key={s.key}
                className={`pf-share-seg ${s.key}`}
                style={{ width: `${s.pct}%` }}
                title={`${s.name} ${s.tokens} tok · ${Math.round(s.pct)}%`}
              />
            ))}
        </div>
        <div className="pf-legend">
          {share.segments.map((s) => (
            <div key={s.key} className="pf-legend-row">
              <span className={`pf-share-swatch ${s.key}`} />
              <span className="pf-legend-name">{s.name}</span>
              <span className="pf-legend-tok">{s.tokens}</span>
            </div>
          ))}
        </div>

        <Section title="上下文预算" help={TERMS.budget} />
        <div className="pf-budget-row">
          <BudgetInput value={budget} disabled={!canBudget} onCommit={onChangeBudget} />
          <span className="pf-budget-text">{canBudget ? usage.text : '还没有预设,不截断'}</span>
        </div>
        {usage.fill !== null && (
          <div className="pf-budget-track" aria-hidden="true">
            <span className="pf-budget-fill" style={{ width: `${usage.fill}%` }} />
          </div>
        )}
        {usage.warn && <div className="pf-budget-warn">{usage.warn}</div>}
      </div>
    </Inspector>
  );
}
