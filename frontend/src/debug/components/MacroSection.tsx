import { useEffect, useMemo, useState } from 'react';
import { NAME_RE, type CustomMacro } from '../lib/customMacros';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../lib/macroDefs';
import {
  BUILTIN_MACROS,
  RESERVED_MACRO_NAMES,
  substituteMacros,
  type MacroContext,
  type MacroInfo,
  type MacroVars,
  type VarValue,
} from '../lib/macros';

const TRY_SAMPLE = '{{char}} 看了 {{user}} 一眼:「又是你。」{{// 这句不会发出去}}';

interface Props {
  /** 当前这一刻各宏会展开成什么 —— 宏表的「当前值」直接读它 */
  macros: MacroContext;
  custom: CustomMacro[];
  onChangeCustom: (next: CustomMacro[]) => void;
  variables: MacroVars;
  onChangeVariables: (next: MacroVars) => void;
  /** 有没有打开着的对话。没有的话局部变量没处存 */
  hasChat: boolean;
}

/** 一行自定义宏的毛病。null = 没毛病 */
function macroFault(m: CustomMacro, index: number, list: readonly CustomMacro[]): string | null {
  const name = m.name.trim();
  if (!name) return '还没起名字 —— 这行不会生效';
  if (!NAME_RE.test(name)) return '名字里不能有大括号、冒号或空格';
  if (RESERVED_MACRO_NAMES.has(name.toLowerCase())) return '这个名字被内置宏占了,内置的优先';
  const dup = list.findIndex(
    (o, i) => i !== index && o.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (dup !== -1 && dup < index) return '和上面某一行重名了,只有最后一行生效';
  return null;
}

/** 失焦才提交:变量的值可能很长,边打边存会让每个字都触发一次保存 */
function ValueBox({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className="conn-input sp-var-value"
      rows={Math.min(4, Math.max(1, draft.split('\n').length))}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

function VariableList({
  title,
  note,
  vars,
  emptyText,
  disabled,
  onChange,
}: {
  title: string;
  note: string;
  vars: Record<string, VarValue>;
  emptyText: string;
  disabled?: boolean;
  onChange: (next: Record<string, VarValue>) => void;
}) {
  const [adding, setAdding] = useState('');
  const [armed, setArmed] = useState(false);
  const names = Object.keys(vars).sort((a, b) => a.localeCompare(b, 'zh'));

  const add = () => {
    const name = adding.trim();
    if (!name || name in vars) return;
    onChange({ ...vars, [name]: '' });
    setAdding('');
  };
  const without = (name: string) => {
    const next = { ...vars };
    delete next[name];
    return next;
  };

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">
          {title}
          {names.length > 0 && <span className="sp-var-count">{names.length}</span>}
        </span>
        <span className="sp-group-note">{note}</span>
        <div style={{ flex: 1 }} />
        {names.length > 0 && (
          <button
            className={`btn small${armed ? ' danger armed' : ''}`}
            onClick={() => {
              if (!armed) return setArmed(true);
              setArmed(false);
              onChange({});
            }}
            onBlur={() => setArmed(false)}
          >
            {armed ? '再点一次确认' : '全部清空'}
          </button>
        )}
      </div>

      {names.length === 0 && <div className="sp-empty">{emptyText}</div>}

      {names.length > 0 && (
        <div className="sp-var-list">
          {names.map((name) => (
            <div className="sp-var-row" key={name}>
              <span className="sp-var-name" title={name}>
                {name}
              </span>
              <ValueBox
                value={String(vars[name])}
                onCommit={(text) => onChange({ ...vars, [name]: text })}
              />
              <button
                className="icon-btn tiny"
                onClick={() => onChange(without(name))}
                title="删掉这个变量"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="sp-var-add">
          <input
            className="conn-input"
            value={adding}
            placeholder="新变量的名字"
            spellCheck={false}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button
            className="btn small"
            disabled={!adding.trim() || adding.trim() in vars}
            onClick={add}
          >
            ＋ 新增
          </button>
        </div>
      )}
    </div>
  );
}

function matches(m: MacroInfo, query: string): boolean {
  if (!query) return true;
  const hay = [m.key, m.syntax, m.note, m.example ?? '', ...(m.alias ?? [])].join('\n').toLowerCase();
  return hay.includes(query);
}

/**
 * 「设置 › 宏」。三件事:
 *   1. 把内置宏摊开给人看 —— 有哪些、怎么写、现在会展开成什么
 *   2. 变量:这条对话里预设写了哪些、现在是什么值,能手改
 *   3. 让人自己加几个固定文本的宏
 *
 * 表里的「当前值」读的是真实 ctx —— 所以它也是个诊断工具:{{persona}} 显示
 * 「(空)」就说明你还没激活人设,不用去猜为什么提示词里那块是空的。
 */
export function MacroSection({
  macros,
  custom,
  onChangeCustom,
  variables,
  onChangeVariables,
  hasChat,
}: Props) {
  const [tryText, setTryText] = useState(TRY_SAMPLE);
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({ prompts: true });

  const patchRow = (i: number, p: Partial<CustomMacro>) =>
    onChangeCustom(custom.map((m, j) => (i === j ? { ...m, ...p } : m)));

  const copy = (syntax: string) => {
    void navigator.clipboard?.writeText(syntax).then(
      () => {
        setCopied(syntax);
        window.setTimeout(() => setCopied((c) => (c === syntax ? null : c)), 1200);
      },
      () => {},
    );
  };

  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: BUILTIN_MACROS.filter((m) => m.category === category && matches(m, q)),
      })).filter((g) => g.items.length > 0),
    [q],
  );
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      {/* ── 变量:预设跑到现在写了些什么 ── */}
      <VariableList
        title="这条对话的变量"
        note="预设里的 {{setvar}} 写在这儿、{{getvar}} 从这儿读 · 每次发送后更新 · 跟着对话存"
        vars={variables.local}
        disabled={!hasChat}
        emptyText={
          hasChat
            ? '还没有变量。用了变量宏的预设发过一次消息之后,这里会列出它写进来的值。'
            : '先打开一条对话。'
        }
        onChange={(local) => onChangeVariables({ ...variables, local })}
      />
      <VariableList
        title="全局变量"
        note="{{setglobalvar}} / {{getglobalvar}} · 所有对话共用 · 存在这台机器上"
        vars={variables.global}
        emptyText="还没有全局变量。"
        onChange={(global) => onChangeVariables({ ...variables, global })}
      />

      {/* ── 内置宏:有哪些、当前映射到什么 ── */}
      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">
            内置宏<span className="sp-var-count">{BUILTIN_MACROS.length}</span>
          </span>
          <span className="sp-group-note">
            和酒馆的宏一一对应 · 点宏名可复制 · 大小写不敏感,宏里可以再套宏
          </span>
        </div>

        <input
          className="conn-input sp-macro-search"
          value={query}
          placeholder="搜宏名或说明,比如 变量、时间、roll"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />

        {shown === 0 && <div className="sp-empty">没有匹配的宏。</div>}

        {groups.map(({ category, items }) => {
          const open = q !== '' || !closed[category];
          return (
            <div className="sp-macro-table" key={category}>
              <button
                className="sp-macro-row head sp-macro-cat"
                onClick={() => setClosed((c) => ({ ...c, [category]: !c[category] }))}
              >
                <span>
                  {open ? '▾' : '▸'} {CATEGORY_LABELS[category]} · {items.length}
                </span>
                <span>说明</span>
                <span>当前值</span>
              </button>
              {open &&
                items.map((m) => {
                  const v = m.takesArgs ? '' : m.value(macros);
                  return (
                    <div className="sp-macro-row" key={m.key}>
                      <button
                        className={`sp-macro-name${copied === m.syntax ? ' copied' : ''}`}
                        onClick={() => copy(m.syntax)}
                        title="点一下复制"
                      >
                        {copied === m.syntax ? '已复制' : m.syntax}
                      </button>
                      <span className="sp-macro-note">
                        {m.note}
                        {m.example && <span className="sp-macro-example">{m.example}</span>}
                        {m.alias?.length ? (
                          <span className="sp-macro-alias">
                            别名 {m.alias.map((a) => `{{${a}}}`).join(' ')}
                          </span>
                        ) : null}
                      </span>
                      {m.takesArgs ? (
                        <span className="sp-macro-value empty">带参数</span>
                      ) : m.dynamic ? (
                        <span className="sp-macro-value dyn" title="每次求值都可能不同">
                          {v}
                        </span>
                      ) : v ? (
                        <span className="sp-macro-value" title={v}>
                          {v.length > 60 ? `${v.slice(0, 60)}…` : v}
                        </span>
                      ) : (
                        <span className="sp-macro-value empty">(空)</span>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* ── 自定义宏 ── */}
      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">自定义宏</span>
          <span className="sp-group-note">
            一个名字对一段固定的字,名字可以是中文;值里可以再套宏。内置宏优先,占不到上面那些名字
          </span>
        </div>

        {custom.length === 0 && (
          <div className="sp-empty">
            还没有自定义宏。加一个之后,预设、角色卡、聊天输入里写 {'{{名字}}'} 都会展开。
          </div>
        )}

        <div className="sp-custom-list">
          {custom.map((m, i) => {
            const fault = macroFault(m, i, custom);
            return (
              <div className={`sp-custom-row${fault ? ' bad' : ''}`} key={i}>
                <div className="sp-custom-name">
                  <span className="sp-brace">{'{{'}</span>
                  <input
                    className="conn-input"
                    value={m.name}
                    placeholder="名字"
                    spellCheck={false}
                    onChange={(e) => patchRow(i, { name: e.target.value })}
                  />
                  <span className="sp-brace">{'}}'}</span>
                </div>
                <textarea
                  className="conn-input sp-custom-value"
                  value={m.value}
                  placeholder="展开成什么"
                  rows={2}
                  onChange={(e) => patchRow(i, { value: e.target.value })}
                />
                <button
                  className="icon-btn tiny"
                  onClick={() => onChangeCustom(custom.filter((_, j) => j !== i))}
                  title="删掉这个宏"
                >
                  ✕
                </button>
                {fault && <span className="sp-custom-fault">{fault}</span>}
              </div>
            );
          })}
        </div>

        <button
          className="btn small"
          onClick={() => onChangeCustom([...custom, { name: '', value: '' }])}
        >
          ＋ 新增宏
        </button>
      </div>

      {/* ── 试一试:写对没有,当场就知道 ── */}
      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">试一试</span>
          <span className="sp-group-note">
            左边随便写,右边是展开后的样子。这里改变量不会真的存下来
          </span>
        </div>
        <div className="sp-try">
          <textarea
            className="conn-input sp-try-in"
            value={tryText}
            rows={4}
            spellCheck={false}
            onChange={(e) => setTryText(e.target.value)}
          />
          <div className="sp-try-out">
            {substituteMacros(tryText, macros, { seed: 'try' }) || '(空)'}
          </div>
        </div>
      </div>
    </>
  );
}
