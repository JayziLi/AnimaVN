import { useEffect, useState } from 'react';
import {
  LOGIC_LABELS,
  POSITION_LABELS,
  WI_LOGIC,
  WI_POSITION,
  WI_ROLE,
  createEntry,
  emptyBook,
  entryTitle,
  type CharacterBook,
  type CharacterBookEntry,
  type CharacterBookFields,
} from '../lib/characterBook';
import { estimateTokens, formatTokens } from '../lib/tokens';
import { parseRegexFromString, splitKeys, type WorldInfoRow } from '../lib/worldInfo';

/**
 * 角色世界书的编辑器。一行一条,点开改。
 *
 * 每行右边那句话是这条在**下一次请求**里的下场(触发了 / 为什么没触发),
 * 和提示词检查器读的是同一份结果 —— 改完关键词马上能看到它会不会中。
 */

interface Props {
  book: CharacterBook | null;
  /** 下一次请求的世界书触发明细 */
  rows: WorldInfoRow[];
  onChange: (book: CharacterBook | null) => void;
}

/** 下拉里的排列顺序:常用的在前,我们放不到原位的排最后 */
const POSITION_OPTIONS: { value: number; note?: string }[] = [
  { value: WI_POSITION.before },
  { value: WI_POSITION.after },
  { value: WI_POSITION.atDepth },
  { value: WI_POSITION.emTop },
  { value: WI_POSITION.emBottom },
  { value: WI_POSITION.anTop, note: '按倒数第 4 条处理' },
  { value: WI_POSITION.anBottom, note: '按倒数第 4 条处理' },
  { value: WI_POSITION.outlet, note: '还不支持' },
];

const ROLE_OPTIONS = [
  { value: WI_ROLE.system, name: 'system' },
  { value: WI_ROLE.user, name: 'user' },
  { value: WI_ROLE.assistant, name: 'assistant' },
];

const LOGIC_OPTIONS = [WI_LOGIC.andAny, WI_LOGIC.andAll, WI_LOGIC.notAny, WI_LOGIC.notAll];

const EXTRA_SCANS: { key: keyof CharacterBookFields; name: string }[] = [
  { key: 'matchCharacterDescription', name: '角色描述' },
  { key: 'matchCharacterPersonality', name: '性格' },
  { key: 'matchScenario', name: '情景' },
  { key: 'matchPersonaDescription', name: '玩家人设' },
  { key: 'matchCharacterDepthPrompt', name: '角色备注' },
  { key: 'matchCreatorNotes', name: '创作者注释' },
];

/** 失焦才提交的输入框 —— 关键词和数字都不能边打边解析 */
function DraftInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (text: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      {...rest}
      className={`text-input wi-input ${rest.className ?? ''}`}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function KeysInput({
  keys,
  placeholder,
  onCommit,
}: {
  keys: string[];
  placeholder: string;
  onCommit: (keys: string[]) => void;
}) {
  const broken = keys.filter((k) => k.startsWith('/') && !parseRegexFromString(k));
  return (
    <>
      <DraftInput
        value={keys.join(', ')}
        placeholder={placeholder}
        onCommit={(text) => onCommit(splitKeys(text))}
      />
      {broken.length > 0 && (
        <span className="wi-warn">
          {broken.join('  ')} 不是合法的正则,会被当成普通文字去匹配
        </span>
      )}
    </>
  );
}

function NumberInput({
  value,
  min,
  max,
  placeholder,
  onCommit,
}: {
  value: number | null;
  min: number;
  max: number;
  placeholder?: string;
  /** 清空时传 null;不接受空值的字段自己兜底 */
  onCommit: (value: number | null) => void;
}) {
  return (
    <DraftInput
      className="wi-number-input"
      inputMode="numeric"
      value={value === null ? '' : String(value)}
      placeholder={placeholder}
      onCommit={(text) => {
        if (!text.trim()) return onCommit(null);
        const n = Math.floor(Number(text));
        if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
      }}
    />
  );
}

function Check({
  checked,
  label,
  title,
  onChange,
}: {
  checked: boolean;
  label: string;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="wi-check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** 「跟全局 / 开 / 关」三选一 */
function TriState({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <select
      className="select"
      value={value === null ? 'inherit' : value ? 'on' : 'off'}
      onChange={(e) =>
        onChange(e.target.value === 'inherit' ? null : e.target.value === 'on')
      }
    >
      <option value="inherit">跟全局设置</option>
      <option value="on">开</option>
      <option value="off">关</option>
    </select>
  );
}

function EntryForm({
  entry,
  onPatch,
  onDelete,
}: {
  entry: CharacterBookEntry;
  onPatch: (patch: Partial<CharacterBookFields>) => void;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const hasSecondary = entry.secondaryKeys.length > 0;

  return (
    <div className="wi-form">
      <div className="wi-grid">
        <label className="wi-field wide">
          <span>标题</span>
          <DraftInput
            value={entry.comment}
            placeholder="只给自己看,不进提示词"
            onCommit={(comment) => onPatch({ comment })}
          />
        </label>
        <div className="wi-field">
          <span>触发方式</span>
          <div className="sp-seg">
            <button
              className={`sp-seg-btn${entry.constant ? '' : ' active'}`}
              onClick={() => onPatch({ constant: false })}
              title="聊天里出现关键词才进提示词"
            >
              关键词
            </button>
            <button
              className={`sp-seg-btn${entry.constant ? ' active' : ''}`}
              onClick={() => onPatch({ constant: true })}
              title="每一轮都进提示词"
            >
              常驻
            </button>
          </div>
        </div>
      </div>

      {!entry.constant && (
        <>
          <label className="wi-field">
            <span>关键词 · 逗号分隔,任意一个出现就触发;可以写 /正则/</span>
            <KeysInput
              keys={entry.keys}
              placeholder="蛋包饭, 早餐, /第\d+章/"
              onCommit={(keys) => onPatch({ keys })}
            />
          </label>

          <div className="wi-grid">
            <label className="wi-field wide">
              <span>次要关键词 · 主关键词命中之后再看这一组</span>
              <KeysInput
                keys={entry.secondaryKeys}
                placeholder="留空 = 不用"
                onCommit={(secondaryKeys) =>
                  // 酒馆编辑器里所有条目都启用次要关键词,填了就算启用
                  onPatch({ secondaryKeys, selective: secondaryKeys.length > 0 || entry.selective })
                }
              />
            </label>
            {hasSecondary && (
              <label className="wi-field">
                <span>这一组要</span>
                <select
                  className="select"
                  value={entry.selectiveLogic}
                  onChange={(e) => onPatch({ selectiveLogic: Number(e.target.value) })}
                >
                  {LOGIC_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {LOGIC_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {hasSecondary && !entry.selective && (
            <div className="wi-warn">
              这条卡里写的是「不启用次要关键词」,上面这一组目前不起作用。
              <button className="wi-link" onClick={() => onPatch({ selective: true })}>
                启用
              </button>
            </div>
          )}
        </>
      )}

      <label className="wi-field">
        <span>
          正文 · 触发后进提示词的内容 · 约 {formatTokens(estimateTokens(entry.content))} tok
        </span>
        <textarea
          className="ce-textarea"
          rows={6}
          value={entry.content}
          onChange={(e) => onPatch({ content: e.target.value })}
        />
      </label>

      <div className="wi-grid">
        <label className="wi-field">
          <span>位置</span>
          <select
            className="select"
            value={entry.position}
            onChange={(e) => onPatch({ position: Number(e.target.value) })}
          >
            {POSITION_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {POSITION_LABELS[p.value]}
                {p.note ? `(${p.note})` : ''}
              </option>
            ))}
          </select>
        </label>
        {entry.position === WI_POSITION.atDepth && (
          <>
            <label className="wi-field">
              <span>深度 · 0 = 最后一条之后</span>
              <NumberInput
                value={entry.depth}
                min={0}
                max={999}
                onCommit={(v) => onPatch({ depth: v ?? 0 })}
              />
            </label>
            <label className="wi-field">
              <span>身份</span>
              <select
                className="select"
                value={entry.role}
                onChange={(e) => onPatch({ role: Number(e.target.value) })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="wi-field">
          <span>顺序 · 小的在前</span>
          <NumberInput
            value={entry.insertion_order}
            min={0}
            max={99999}
            onCommit={(v) => onPatch({ insertion_order: v ?? 0 })}
          />
        </label>
        <label className="wi-field">
          <span>概率 %</span>
          <NumberInput
            value={entry.useProbability ? entry.probability : 100}
            min={0}
            max={100}
            onCommit={(v) => onPatch({ probability: v ?? 100, useProbability: true })}
          />
        </label>
      </div>

      <details className="wi-advanced">
        <summary>高级</summary>

        <div className="wi-grid">
          <label className="wi-field">
            <span>扫描条数</span>
            <NumberInput
              value={entry.scanDepth}
              min={0}
              max={1000}
              placeholder="跟全局设置"
              onCommit={(scanDepth) => onPatch({ scanDepth })}
            />
          </label>
          <label className="wi-field">
            <span>区分大小写</span>
            <TriState
              value={entry.caseSensitive}
              onChange={(caseSensitive) => onPatch({ caseSensitive })}
            />
          </label>
          <label className="wi-field">
            <span>全词匹配</span>
            <TriState
              value={entry.matchWholeWords}
              onChange={(matchWholeWords) => onPatch({ matchWholeWords })}
            />
          </label>
          <label className="wi-field">
            <span>聊天满几条才参与</span>
            <NumberInput
              value={entry.delay}
              min={0}
              max={9999}
              placeholder="不限"
              onCommit={(delay) => onPatch({ delay: delay || null })}
            />
          </label>
        </div>

        <div className="wi-field">
          <span>除了聊天记录,还扫描</span>
          <div className="wi-checks">
            {EXTRA_SCANS.map((s) => (
              <Check
                key={s.key}
                label={s.name}
                checked={Boolean(entry[s.key])}
                onChange={(v) => onPatch({ [s.key]: v })}
              />
            ))}
          </div>
        </div>

        <div className="wi-field">
          <span>递归</span>
          <div className="wi-checks">
            <Check
              label="不被别的条目带出来"
              title="只认聊天记录里的关键词"
              checked={entry.excludeRecursion}
              onChange={(excludeRecursion) => onPatch({ excludeRecursion })}
            />
            <Check
              label="不带出别的条目"
              title="这条的正文不拿去扫描"
              checked={entry.preventRecursion}
              onChange={(preventRecursion) => onPatch({ preventRecursion })}
            />
            <Check
              label="只能被别的条目带出来"
              title="第一轮扫聊天记录时不参与"
              checked={entry.delayUntilRecursion > 0}
              onChange={(v) => onPatch({ delayUntilRecursion: v ? 1 : 0 })}
            />
            <Check
              label="不受预算限制"
              checked={entry.ignoreBudget}
              onChange={(ignoreBudget) => onPatch({ ignoreBudget })}
            />
          </div>
        </div>

        <div className="wi-grid">
          <label className="wi-field">
            <span>互斥分组 · 同名的一轮只进一条</span>
            <DraftInput
              value={entry.group}
              placeholder="不分组"
              onCommit={(group) => onPatch({ group: group.trim() })}
            />
          </label>
          {entry.group && (
            <>
              <label className="wi-field">
                <span>权重</span>
                <NumberInput
                  value={entry.groupWeight}
                  min={1}
                  max={10000}
                  onCommit={(v) => onPatch({ groupWeight: v ?? 100 })}
                />
              </label>
              <div className="wi-field">
                <span>&nbsp;</span>
                <Check
                  label="组里优先"
                  title="同组有这条就选这条,不掷骰"
                  checked={entry.groupOverride}
                  onChange={(groupOverride) => onPatch({ groupOverride })}
                />
              </div>
            </>
          )}
        </div>

        {(entry.sticky || entry.cooldown) && (
          <div className="wi-warn">
            这条在卡里设了
            {entry.sticky ? ` 粘性 ${entry.sticky} 条` : ''}
            {entry.cooldown ? ` 冷却 ${entry.cooldown} 条` : ''}
            。这两项还没实现,目前按普通条目处理;设置会原样保留在卡里。
          </div>
        )}
      </details>

      <div className="ce-sec-foot">
        <div style={{ flex: 1 }} />
        <button
          className={`btn small danger${armed ? ' armed' : ''}`}
          onClick={() => (armed ? onDelete() : setArmed(true))}
          onBlur={() => setArmed(false)}
        >
          {armed ? '再点一次确认' : '删除这条'}
        </button>
      </div>
    </div>
  );
}

export function BookEditor({ book, rows, onChange }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  if (!book) {
    return (
      <div className="wi-empty">
        这张卡还没有世界书。
        <button
          className="btn small"
          onClick={() => {
            const next = emptyBook();
            const entry = createEntry(next);
            onChange({ ...next, entries: [entry] });
            setOpen(entry.uid);
          }}
        >
          ＋ 新建第一条
        </button>
      </div>
    );
  }

  const byUid = new Map(rows.map((r) => [r.uid, r]));
  const sorted = [...book.entries].sort((a, b) => a.insertion_order - b.insertion_order);

  const patch = (uid: number, p: Partial<CharacterBookFields>) =>
    onChange({
      ...book,
      entries: book.entries.map((e) => (e.uid === uid ? { ...e, ...p } : e)),
    });

  return (
    <>
      <div className="ce-book">
        {sorted.map((e) => {
          const row = byUid.get(e.uid);
          const state = !e.enabled ? 'off' : row?.placed ? 'hit' : 'miss';
          const isOpen = open === e.uid;
          return (
            <div key={e.uid} className={`ce-book-entry wi-entry ${state}${isOpen ? ' open' : ''}`}>
              <div className="ce-book-row">
                <button
                  className="wi-toggle"
                  onClick={() => patch(e.uid, { enabled: !e.enabled })}
                  title={e.enabled ? '点一下关掉这条' : '点一下打开这条'}
                >
                  <span className={`block-toggle${e.enabled ? ' on' : ''}`}>
                    <span className="knob" />
                  </span>
                </button>
                <button className="wi-row-main" onClick={() => setOpen(isOpen ? null : e.uid)}>
                  <span className="ce-book-order">{e.insertion_order}</span>
                  <span className="ce-book-keys">{entryTitle(e)}</span>
                  <span className="wi-tag">{e.constant ? '常驻' : '关键词'}</span>
                  <span className="wi-tag">{POSITION_LABELS[e.position] ?? e.position}</span>
                  <span className={`wi-state ${state}`} title={row?.note ?? undefined}>
                    {!e.enabled ? '已关闭' : (row?.reason ?? '—')}
                  </span>
                  <span className="ce-book-token">
                    {formatTokens(estimateTokens(e.content))}
                  </span>
                </button>
              </div>
              {isOpen && (
                <EntryForm
                  entry={e}
                  onPatch={(p) => patch(e.uid, p)}
                  onDelete={() => {
                    setOpen(null);
                    onChange({ ...book, entries: book.entries.filter((x) => x.uid !== e.uid) });
                  }}
                />
              )}
            </div>
          );
        })}
        {sorted.length === 0 && <div className="wi-empty">世界书是空的</div>}
      </div>

      <div className="ce-sec-foot">
        <button
          className="btn small"
          onClick={() => {
            const entry = createEntry(book);
            onChange({ ...book, entries: [...book.entries, entry] });
            setOpen(entry.uid);
          }}
        >
          ＋ 新条目
        </button>
      </div>
    </>
  );
}
