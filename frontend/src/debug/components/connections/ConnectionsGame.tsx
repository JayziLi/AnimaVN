/**
 * 局内菜单「模型」页的三栏(U30,设计稿 tools.html#a 的模型页 / kit/creator.js 的 modelPage):
 *   左 已保存的连接 + Jev 的 key 状态 / 中 表单 / 右 测试(发送测试消息、结果)。
 * 只管画。状态、增删改、测试都在 ConnectionsDrawer 里,和调试台网页里的 API 设置抽屉是同一份逻辑;
 * 抽屉收到 `game` 就用这个组件代替单栏表单。
 */

import type { ReactNode } from 'react';
import type { ApiType, DebugConnection, JevKeyStatus, ThinkingLevel } from '../../lib/api';
import { Help } from '../../vn/ui/Help';
import { PaperButton } from '../../vn/ui/PaperButton';
import { Switch } from '../../vn/ui/Switch';
import {
  BASE_URL_HINTS,
  connIcon,
  connSub,
  elapsed,
  jevLine,
  NOTES,
  THINK_OPTIONS,
  TIPS,
  type ConnBusy,
  type ConnFormState,
  type TestResult,
} from './connModel';
import './connectionsGame.css';

export interface ConnGameProps {
  /** null = 还在读 */
  connections: DebugConnection[] | null;
  selectedId: string | null;
  selected: DebugConnection | null;
  form: ConnFormState;
  onForm: (patch: Partial<ConnFormState>) => void;
  dirty: boolean;
  cachedModels: string[];
  testMessage: string;
  onTestMessage: (v: string) => void;
  busy: ConnBusy;
  deleteArmed: boolean;
  result: TestResult | null;
  jev?: { status: JevKeyStatus | null; onOpen: () => void };
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onPickModel: (model: string) => void;
  onPing: () => void;
  onSendTest: () => void;
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

function Field({
  label,
  tip,
  note,
  span,
  children,
}: {
  label: string;
  tip?: string;
  /** 字段下面一行淡字(设计稿 .tl-fnote) */
  note?: string;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`vn-cn-field${span ? ' span' : ''}`}>
      <span className="vn-cn-fl">
        {label}
        {tip && <Help tip={tip} />}
      </span>
      {children}
      {note && <span className="vn-cn-note">{note}</span>}
    </label>
  );
}

function ResultBox({ r }: { r: TestResult | null }) {
  // 还没测:一句怎么用(设计稿 .tl-tres 的空态)
  if (!r)
    return (
      <div className="vn-cn-res idle" aria-live="polite">
        <span className="vn-cn-dim">{TIPS.test}</span>
      </div>
    );
  if (r.kind === 'busy') {
    return (
      <div className="vn-cn-res busy" role="status" aria-live="polite">
        <i className="vn-cn-spin" aria-hidden="true" />
        <span>{r.what === 'ping' ? '连接中…' : '发送中…'}</span>
      </div>
    );
  }
  const ok = r.kind === 'ok';
  const head = r.what === 'ping' ? (ok ? '通了' : '没连上') : ok ? '收到回复' : '没有收到回复';
  return (
    <div className={`vn-cn-res ${ok ? 'ok' : 'bad'}`} role={ok ? 'status' : 'alert'} aria-live="polite">
      <b>
        {ok ? '✓ ' : ''}
        {head}
      </b>
      <span className="vn-cn-dim">用时 {elapsed(r.ms)}</span>
      {/* 回复和后端报错都按原文放,英文也不翻 */}
      <p className="vn-cn-raw">{r.text}</p>
    </div>
  );
}

export function ConnectionsGame(p: ConnGameProps) {
  const { form, selected, selectedId } = p;
  const mock = form.api_type === 'mock';
  const idle = p.busy === null;
  const creating = selectedId === null;
  const jev = p.jev ? jevLine(p.jev.status) : null;

  return (
    <div className="vn-cn">
      {/* ── 左:已保存的连接 + Jev ── */}
      <aside className="vn-cn-list" aria-label="已保存的连接">
        <div className="vn-cn-lh">
          <span className="vn-cn-zh">已保存的连接</span>
          <span className="vn-cn-n">{p.connections?.length ?? 0} 个</span>
        </div>
        <div className="vn-cn-rows" role="radiogroup" aria-label="已保存的连接">
          {p.connections?.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === selectedId}
              className={`vn-cn-row${c.id === selectedId ? ' on' : ''}`}
              disabled={!idle}
              onClick={() => p.onSelect(c.id)}
            >
              <span className="vn-cn-ic" aria-hidden="true">
                {connIcon(c.name)}
              </span>
              <span className="tx">
                <b>{c.name}</b>
                <small>{connSub(c)}</small>
              </span>
              {c.is_active && <span className="vn-cn-now">当前启用</span>}
            </button>
          ))}
          {creating && (
            <div className="vn-cn-row on draft" role="radio" aria-checked="true">
              <span className="vn-cn-ic" aria-hidden="true">
                +
              </span>
              <span className="tx">
                <b>{form.name.trim() || '新连接'}</b>
                <small>还没保存</small>
              </span>
            </div>
          )}
        </div>
        {!creating && (
          <button type="button" className="vn-cn-new" onClick={p.onNew} disabled={!idle}>
            <PlusIcon />
            新建连接…
          </button>
        )}
        {p.jev && jev && (
          <div className="vn-cn-foot">
            <div className="vn-cn-jev">
              <span className="vn-cn-fl">
                判断模型 Jev
                <Help tip={TIPS.jev} />
              </span>
              <span className="vn-cn-jevst">
                <i className={`vn-cn-dot ${jev.tone}`} aria-hidden="true" />
                {jev.text}
              </span>
              <button type="button" className="vn-cn-link" onClick={p.jev.onOpen}>
                去设置
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ── 中:表单 ── */}
      <section className="vn-cn-form" aria-label="连接设置">
        <div className="vn-cn-ph">
          <h3 className="vn-cn-h1">{creating ? '新建连接' : selected?.name || form.name}</h3>
          {selected?.is_active && <span className="vn-cn-chip">当前启用</span>}
          {p.dirty && <span className="vn-cn-dim">有没保存的改动</span>}
          <span className="vn-cn-flex" />
          {!creating && (
            <PaperButton sm onClick={p.onNew} disabled={!idle}>
              新建
            </PaperButton>
          )}
          <PaperButton kind="primary" sm onClick={p.onSave} disabled={!idle}>
            {p.busy === 'save' ? '保存中…' : '保存'}
          </PaperButton>
          {!creating && (
            <PaperButton kind="danger" sm armed={p.deleteArmed} onClick={p.onDelete} disabled={!idle}>
              {p.busy === 'delete' ? '删除中…' : p.deleteArmed ? '确认删除?' : '删除'}
            </PaperButton>
          )}
        </div>

        {/* 这条连接现在是什么 + 和左上「模型」小窗口是同一份数据 */}
        <div className="vn-cn-meta">
          {!creating && selected && (
            <span className="vn-cn-live">
              <i className={`vn-cn-dot${selected.is_active ? ' ok' : ''}`} aria-hidden="true" />
              {selected.name} · {selected.model || '未设模型'}
            </span>
          )}
          <span>{creating ? '填好名称、类型、地址和 key,保存以后就能测试' : NOTES.sameData}</span>
          {!creating && <Help tip={TIPS.sameData} />}
        </div>

        <div className="vn-cn-grid">
          <Field label="名称">
            <input
              className="text-input"
              value={form.name}
              onChange={(e) => p.onForm({ name: e.target.value })}
              placeholder="例:OpenRouter / 本地 Ollama"
            />
          </Field>
          <Field label="类型">
            <select
              className="select"
              value={form.api_type}
              onChange={(e) => p.onForm({ api_type: e.target.value as ApiType })}
            >
              <option value="openai_compatible">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="mock">Mock(本地测试)</option>
            </select>
          </Field>

          {!mock && (
            <>
              {/* 地址不遮(10-26 定):截图要打码自己来 */}
              <Field label="Base URL" span>
                <input
                  className="text-input mono"
                  value={form.base_url}
                  onChange={(e) => p.onForm({ base_url: e.target.value })}
                  placeholder={BASE_URL_HINTS[form.api_type]}
                  spellCheck={false}
                />
              </Field>
              <Field label="API Key" note={selected?.has_api_key ? TIPS.key : undefined} span>
                <input
                  className="text-input mono"
                  type="password"
                  value={form.api_key}
                  onChange={(e) => p.onForm({ api_key: e.target.value })}
                  placeholder={selected?.has_api_key ? '已保存密钥(留空保持不变)' : 'sk-…'}
                  autoComplete="new-password"
                />
              </Field>
            </>
          )}

          <Field label="模型名" span>
            <div className="vn-cn-inrow">
              <input
                className="text-input mono"
                value={form.model}
                onChange={(e) => p.onForm({ model: e.target.value })}
                placeholder="例:claude-sonnet-5 / gpt-4o / llama3"
                spellCheck={false}
              />
              {!mock && (
                <PaperButton sm onClick={p.onRefresh} disabled={!idle}>
                  {p.busy === 'refresh' ? '刷新中…' : '刷新列表'}
                </PaperButton>
              )}
            </div>
          </Field>

          {p.cachedModels.length > 0 && (
            <Field label={`可用模型 · ${p.cachedModels.length} 个`} tip={TIPS.models} span>
              <select
                className="select mono"
                value=""
                onChange={(e) => e.target.value && p.onPickModel(e.target.value)}
              >
                <option value="">从列表选择…</option>
                {p.cachedModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* 流式、思考是端点的能力,跟着连接走 */}
          <div className="vn-cn-field span">
            <div className="vn-cn-opt">
              <span className="vn-cn-fl">
                流式输出
                <Help tip={TIPS.stream} />
              </span>
              <Switch label="流式输出" checked={form.stream} onChange={(v) => p.onForm({ stream: v })} />
            </div>
            <span className="vn-cn-note">{TIPS.stream}</span>
          </div>
          {!mock && (
            <Field label="思考" tip={TIPS.think} note={NOTES.think} span>
              <select
                className="select"
                value={form.thinking ?? ''}
                onChange={(e) => p.onForm({ thinking: e.target.value === '' ? null : (e.target.value as ThinkingLevel) })}
              >
                {THINK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      {/* ── 右:测试 ── */}
      <aside className="vn-cn-test" aria-label="测试">
        <div className="vn-cn-lh">
          <span className="vn-cn-zh">测试</span>
          <span className="vn-cn-en">Test</span>
        </div>
        <label className="vn-cn-field">
          <span className="vn-cn-fl">测试消息</span>
          <textarea
            className="conn-textarea"
            value={p.testMessage}
            onChange={(e) => p.onTestMessage(e.target.value)}
            rows={3}
          />
        </label>
        <div className="vn-cn-inrow">
          <PaperButton sm onClick={p.onPing} disabled={creating || !idle}>
            {p.busy === 'ping' ? '连接中…' : '连接'}
          </PaperButton>
          <PaperButton sm onClick={p.onSendTest} disabled={creating || !idle || !p.testMessage.trim()}>
            {p.busy === 'test' ? '发送中…' : '发送测试消息'}
          </PaperButton>
        </div>
        {creating && <p className="vn-cn-dim">先保存这条连接,再测试。</p>}
        <ResultBox r={p.result} />
      </aside>
    </div>
  );
}
