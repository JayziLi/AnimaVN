/**
 * 插件页的「配对表」(素材架构设计 1.6.6、1.6.8,第 1d 期):
 * 语音页一张(这张卡当前立绘包 × 主声音),CG 页每个有差分的构图一张(当前立绘包 × 构图,可折叠)。
 * 一行一张立绘:配的那段语气 / 那张差分(下拉)、来源、小标;语音每行能用那段念一句试听。
 * 改一格走 vn/usePairings.ts 的 savePairingCell(先发请求,成了再更新整个页面共用的缓存,游戏里马上按新的走);
 * 这张表被不止一张卡用时,先在那一行下面问一句再改。「补上缺的」= 缺格补配(fillPairingTable)。
 * 「让模型重配」:先显示发出去的字数和原文,点了才发(花钱),回来的只列成建议清单,采纳了才改(来源记「聊天模型配的」)。
 * 纯函数在 plugins/pairingView.ts。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  debugApi,
  type PackSprite,
  type PairingEstimate,
  type PairingFollower,
  type PairingSuggestOut,
  type PairingTableOut,
  type SceneAsset,
  type VoiceProfile,
} from '../lib/api';
import { emotionListRef } from '../plugins/emotionMatch';
import {
  allSameRow,
  baseRows,
  cellFlags,
  fillSummary,
  missingItems,
  openSuggestions,
  pairableCgs,
  pairingSourceName,
  rowChoices,
  sharedEditWarning,
  suggestionRows,
  usedByText,
  variantWordRows,
  withCell,
  type Choice,
} from '../plugins/pairingView';
import { DEFAULT_VOICE_SAMPLE, sampleIn, sampleLangOf } from '../plugins/voice';
import { audioBus } from '../vn/audioBus';
import { fillPairingTable, savePairingCell } from '../vn/usePairings';
import { useTimelineEngine } from '../vn/useTimelineEngine';
import { voicePlayer } from '../vn/voice';
import { errText } from './pluginRunner';

type CardRef = { id: string; name: string } | null;
type CardList = readonly { id: string; name: string }[];

/** 名单里的一项:立绘的 id 和名字 */
interface Item {
  key: string;
  label: string;
}

/** 改一格;采纳模型的建议时来源记 chat */
interface Edit {
  item: string;
  value: string | null;
  source: 'player' | 'chat';
}

/** 试听按钮:用这一段语气(行的 id)念一句,按钮上写 label */
type Audition = (rowId: string, label: string) => ReactNode;

/** 下拉里「构图本身」(null)和「还没配」的值 */
const SELF = '';
const MISSING = '__missing__';
const encode = (v: string | null) => v ?? SELF;
const decode = (s: string) => (s === SELF ? null : s);

const LEGACY_NOTE = '表情认法现在是「旧算法」,这张表还不起作用;在视觉小说的 设置 → 数据 换成「认词记录」才按它走。';

/** 读一份名单的共用配对表(给了 target 只读那一张);换了名单、声音以后上一份的结果不算 */
function usePairingTables(follower: PairingFollower, listRef: string | null, target?: string) {
  const key = `${follower}\u0000${listRef ?? ''}\u0000${target ?? ''}`;
  const [state, setState] = useState<{ key: string; tables: ReadonlyMap<string, PairingTableOut> } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    if (listRef === null) return;
    let alive = true;
    debugApi
      .pairings(follower, listRef, target)
      .then((rows) => alive && setState({ key, tables: new Map(rows.map((t) => [t.target, t])) }))
      .catch((e: unknown) => alive && setError({ key, text: errText(e) }));
    return () => {
      alive = false;
    };
  }, [key, follower, listRef, target]);

  /** 改完、补完一张表以后换上后端回的那份 */
  const setTable = useCallback(
    (t: PairingTableOut) =>
      setState((cur) => {
        const base: Iterable<[string, PairingTableOut]> = cur?.key === key ? cur.tables : [];
        return { key, tables: new Map(base).set(t.target, t) };
      }),
    [key],
  );

  const tables = state?.key === key ? state.tables : null;
  return { tables, error: !tables && error?.key === key ? error.text : null, setTable };
}

// ─────────────────────────── 语音 ───────────────────────────

export function VoicePairingGroup({
  main,
  fixedEmotion,
  card,
  sprites,
  packName,
  cards,
}: {
  /** 这张卡的主声音;没有是 null */
  main: VoiceProfile | null;
  /** 语音情绪设成了「不变」 */
  fixedEmotion: boolean;
  card: CardRef;
  /** 当前立绘包里启用的立绘 */
  sprites: readonly PackSprite[];
  packName: string | null;
  /** 全部角色卡:「被哪些卡用」写卡名 */
  cards: CardList;
}) {
  const engine = useTimelineEngine();
  const listRef = sprites.length > 0 ? emotionListRef(sprites) : null;
  const ready = card !== null && main !== null && main.emotions.length > 0;
  const { tables, error, setTable } = usePairingTables('voice', ready ? listRef : null, main?.id);
  const table = main ? (tables?.get(main.id) ?? null) : null;

  const cardNames = useMemo(() => new Map(cards.map((c) => [c.id, c.name])), [cards]);
  const items = useMemo(() => sprites.map((s) => ({ key: s.id, label: s.label })), [sprites]);
  const choices = useMemo<Choice[]>(
    () => (main ? baseRows(main.emotions).map((e) => ({ value: e.id, label: e.label })) : []),
    [main],
  );
  const nameOf = useCallback(
    (v: string | null) => (v === null ? '—' : (main?.emotions.find((e) => e.id === v)?.label ?? '(这一段不在了)')),
    [main],
  );
  const audition = useCallback<Audition>(
    (rowId, label) => (main ? <ListenButton key={`${label}\u0000${rowId}`} profile={main} rowId={rowId} label={label} /> : null),
    [main],
  );

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">配对表{packName && main ? ` · ${packName} × ${main.name}` : ''}</span>
        {table && <span className="sp-group-note">{usedByText(table.cards)}</span>}
      </div>
      {engine === 'legacy' && <div className="sp-group-note">{LEGACY_NOTE}</div>}
      {fixedEmotion && (
        <div className="sp-group-note">语音情绪设成了「不变」:每句都用排第一的那段念,这张表现在用不上。</div>
      )}
      {!card ? (
        <div className="sp-empty">先选一张角色卡。</div>
      ) : listRef === null ? (
        <div className="sp-empty">这张卡没有立绘,语音按表情名挑语气,用不到配对表。</div>
      ) : !main ? (
        <div className="sp-empty">这张卡还没有音色:在上面选一个,才有配对表。</div>
      ) : main.emotions.length === 0 ? (
        <div className="sp-empty">「{main.name}」还没有语气(参考音频),没得配。</div>
      ) : error ? (
        <span className="pl-error">配对表读不到:{error}</span>
      ) : !tables ? (
        <span className="sp-group-note">读取中…</span>
      ) : (
        <PairingTable
          follower="voice"
          listRef={listRef}
          target={main.id}
          table={table}
          onTable={setTable}
          items={items}
          choices={choices}
          nameOf={nameOf}
          cardNames={cardNames}
          audition={audition}
          emptyText="这张卡的立绘包和音色还没有配对表:用「补上缺的」配一次。"
          sameNote="全部同一段,建议换声音。"
        />
      )}
    </div>
  );
}

/** 用这一段语气念一句固定的短句(和插件页情绪表的 ▶ 一样);语音机没开时在旁边写原因,不弹窗 */
function ListenButton({ profile, rowId, label }: { profile: VoiceProfile; rowId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = profile.emotions.find((e) => e.id === rowId);
  const text = sampleIn(DEFAULT_VOICE_SAMPLE, sampleLangOf(profile.text_lang));

  const listen = async () => {
    if (!row) return;
    // 在点击里解锁:合成要几秒,等回来就不算用户手势了
    audioBus.unlock();
    setBusy(true);
    setError(null);
    try {
      const r = await debugApi.speak({ profile_id: profile.id, emotion: row.label, emotion_id: row.id, text });
      await voicePlayer.playBuffer(r.audio);
    } catch (e) {
      setError(`念不了:${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn small"
        disabled={!row || busy}
        title={row ? `用「${row.label}」念:${text}` : '这一段不在了'}
        onClick={() => void listen()}
      >
        {busy ? '合成中…' : label}
      </button>
      {error && <span className="pl-error pg-full">{error}</span>}
    </>
  );
}

// ─────────────────────────── CG ───────────────────────────

export function CgPairingGroup({
  card,
  sprites,
  packName,
  assets,
  cards,
}: {
  card: CardRef;
  /** 当前立绘包里启用的立绘 */
  sprites: readonly PackSprite[];
  packName: string | null;
  /** 这张卡绑的场景包里的素材(含停用的) */
  assets: readonly SceneAsset[];
  cards: CardList;
}) {
  const engine = useTimelineEngine();
  const listRef = sprites.length > 0 ? emotionListRef(sprites) : null;
  const groups = useMemo(() => pairableCgs(assets), [assets]);
  const { tables, error, setTable } = usePairingTables('cg', card && groups.length > 0 ? listRef : null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const cardNames = useMemo(() => new Map(cards.map((c) => [c.id, c.name])), [cards]);
  const items = useMemo(() => sprites.map((s) => ({ key: s.id, label: s.label })), [sprites]);
  const words = useMemo(() => variantWordRows(groups), [groups]);
  const nameOf = useCallback(
    (v: string | null) => {
      if (v === null) return '构图本身';
      const a = assets.find((x) => x.id === v);
      if (!a) return '(这张差分不在了)';
      return a.enabled && a.has_file ? a.label : `${a.label}(停用了或没传图)`;
    },
    [assets],
  );
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">配对表 · CG{packName ? ` · ${packName}` : ''}</span>
      </div>
      {engine === 'legacy' && <div className="sp-group-note">{LEGACY_NOTE}</div>}
      {!card ? (
        <div className="sp-empty">先在右栏选一张角色卡。</div>
      ) : listRef === null ? (
        <div className="sp-empty">这张卡没有立绘,CG 差分按表情名找,用不到配对表。</div>
      ) : groups.length === 0 ? (
        <div className="sp-empty">场景包里的 CG 还没有差分(启用、传了图的),不用配。</div>
      ) : error ? (
        <span className="pl-error">配对表读不到:{error}</span>
      ) : !tables ? (
        <span className="sp-group-note">读取中…</span>
      ) : (
        <div className="pl-sprite-list">
          {groups.map((g) => {
            const table = tables.get(g.cg.id) ?? null;
            const missing = missingItems(items, table?.cells ?? null).length;
            const isOpen = open.has(g.cg.id);
            return (
              <div key={g.cg.id} className="pl-sprite vp-profile">
                <button className="vp-head" onClick={() => toggle(g.cg.id)} aria-expanded={isOpen}>
                  <b>{g.cg.label}</b>
                  <span className="sp-group-note">
                    {g.variants.length} 张差分 · {table ? usedByText(table.cards) : '还没有配对表'}
                    {table && missing > 0 ? ` · 缺 ${missing} 格` : ''}
                  </span>
                  <span className="vp-caret">{isOpen ? '收起' : '展开'}</span>
                </button>
                {isOpen && (
                  <PairingTable
                    follower="cg"
                    listRef={listRef}
                    target={g.cg.id}
                    table={table}
                    onTable={setTable}
                    items={items}
                    choices={[
                      { value: null, label: '构图本身' },
                      ...g.variants.map((v) => ({ value: v.id, label: v.label })),
                    ]}
                    nameOf={nameOf}
                    cardNames={cardNames}
                    emptyText="这个构图还没有配对表:用「补上缺的」配一次。"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {card && listRef !== null && words.length > 0 && (
        <div className="pl-field">
          <span className="conn-label">差分自己认的词</span>
          <span className="sp-group-note">差分的名字和别名。这里只读,想改去上面的 CG 列表改差分的别名。</span>
          <div className="pg-table">
            {words.map((w) => (
              <div key={[w.label, ...w.aliases].join('\u0001')} className="pg-row">
                <span className="pg-item" title={w.label}>
                  {w.label}
                </span>
                <span className="pg-meta">{w.aliases.length > 0 ? `也认:${w.aliases.join('、')}` : '只认名字'}</span>
                <span className="pg-end pg-meta">{w.count} 个构图有</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── 一张表 ───────────────────────────

function PairingTable({
  follower,
  listRef,
  target,
  table,
  onTable,
  items,
  choices,
  nameOf,
  cardNames,
  audition,
  emptyText,
  sameNote,
}: {
  follower: PairingFollower;
  listRef: string;
  /** 声音的 id / 构图的 id */
  target: string;
  /** 还没有表是 null */
  table: PairingTableOut | null;
  onTable: (t: PairingTableOut) => void;
  /** 名单里启用的立绘,按顺序 */
  items: readonly Item[];
  /** 下拉里能选的(语音只有基础的语气;CG 是构图本身和各张差分) */
  choices: readonly Choice[];
  nameOf: (value: string | null) => string;
  cardNames: ReadonlyMap<string, string>;
  audition?: Audition;
  emptyText: string;
  /** 整列都是同一段时加的那句(语音才有) */
  sameNote?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // 共用的表改之前问一句:at = 问的那一行在哪(某一行 / 某条建议 / 全部采纳)
  const [confirm, setConfirm] = useState<{ at: string; what: string; edits: readonly Edit[] } | null>(null);

  const cellOf = useMemo(() => new Map((table?.cells ?? []).map((c) => [c.item, c])), [table]);
  const missing = missingItems(items, table?.cells ?? null);
  const warning = table ? sharedEditWarning(table.cards, cardNames) : null;
  const itemName = (key: string) => items.find((i) => i.key === key)?.label ?? '(停用的立绘)';

  const apply = async (edits: readonly Edit[]) => {
    if (!table) return;
    setConfirm(null);
    setBusy('保存中');
    setError(null);
    setNote(null);
    let t = table;
    try {
      for (const e of edits) {
        const cell = await savePairingCell(t, e.item, e.value, e.source);
        t = withCell(t, cell);
        onTable(t);
      }
    } catch (err) {
      setError(`没改成:${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  /** 改之前:这张表被不止一张卡用就先问 */
  const request = (edits: readonly Edit[], what: string, at: string) => {
    if (edits.length === 0) return;
    if (warning) setConfirm({ at, what, edits });
    else void apply(edits);
  };

  const confirmAt = (at: string): ReactNode =>
    confirm?.at === at && warning ? (
      <div className="pg-confirm">
        <span>
          {warning}。{confirm.what}
        </span>
        <button className="btn small" disabled={busy !== null} onClick={() => void apply(confirm.edits)}>
          改
        </button>
        <button className="btn small" onClick={() => setConfirm(null)}>
          算了
        </button>
      </div>
    ) : null;

  const fill = async () => {
    setBusy('补配中');
    setError(null);
    setNote(null);
    try {
      const r = await fillPairingTable(follower, listRef, target);
      // 表可能是这次才建的:整张重读,拿到 id、被哪些卡用
      const [fresh] = await debugApi.pairings(follower, listRef, target);
      if (fresh) onTable(fresh);
      setNote(fillSummary(follower, r));
    } catch (e) {
      setError(`没补上:${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const fillRow = (
    <div className="pl-row">
      <button
        className="btn small"
        disabled={busy !== null || (table !== null && missing.length === 0)}
        onClick={() => void fill()}
      >
        补上缺的
      </button>
      <span className="sp-group-note">
        {busy
          ? `${busy}…`
          : table && missing.length === 0
            ? '没有缺的格子。'
            : `${table ? `缺 ${missing.length} 格(多半是后加的立绘)。` : ''}名字对上的直接配;对不上的${
                follower === 'cg' ? '先用构图本身' : '让本地模型先挑一段'
              },标「待重配」。`}
      </span>
    </div>
  );

  if (!table) {
    return (
      <div className="pg-block">
        <div className="sp-empty">{emptyText}</div>
        {fillRow}
        {note && <span className="sp-group-note">{note}</span>}
        {error && <span className="pl-error">{error}</span>}
      </div>
    );
  }

  const shown = items.flatMap((i) => cellOf.get(i.key) ?? []);
  return (
    <div className="pg-block">
      {sameNote && allSameRow(shown) && <div className="sp-group-note">{sameNote}</div>}
      <div className="pg-table">
        {items.map((it) => {
          const cell = cellOf.get(it.key);
          return (
            <div key={it.key} className="pg-row">
              <span className="pg-item" title={it.label}>
                {it.label}
              </span>
              <select
                className="text-input pg-select"
                value={cell ? encode(cell.value) : MISSING}
                disabled={busy !== null}
                aria-label={`「${it.label}」配哪一个`}
                onChange={(e) => {
                  const value = decode(e.target.value);
                  if (cell && cell.value === value) return;
                  request(
                    [{ item: it.key, value, source: 'player' }],
                    `「${it.label}」改成「${nameOf(value)}」。`,
                    `row:${it.key}`,
                  );
                }}
              >
                {!cell && (
                  <option value={MISSING} disabled>
                    还没配
                  </option>
                )}
                {rowChoices(choices, cell ? cell.value : undefined, nameOf).map((c) => (
                  <option key={encode(c.value)} value={encode(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>
              {audition && cell?.value && audition(cell.value, '▶')}
              {cell && <span className="pg-meta">{pairingSourceName(cell.source, follower)}</span>}
              {cell &&
                cellFlags(cell).map((f) => (
                  <span key={f} className="pg-flag">
                    {f}
                  </span>
                ))}
              {confirmAt(`row:${it.key}`)}
            </div>
          );
        })}
      </div>
      {fillRow}
      {note && <span className="sp-group-note">{note}</span>}
      {error && <span className="pl-error">{error}</span>}
      <RePair
        table={table}
        itemName={itemName}
        nameOf={nameOf}
        audition={audition}
        busy={busy !== null}
        request={request}
        confirmAt={confirmAt}
      />
    </div>
  );
}

// ─────────────────────────── 让模型重配 ───────────────────────────

/**
 * 「让模型重配」:先读发出去的字数和原文(不花钱),点了按钮才发(花钱);
 * 回来的只列成建议清单「现在 → 建议」,每条能试听、采纳,也能全部采纳。不直接改表
 */
function RePair({
  table,
  itemName,
  nameOf,
  audition,
  busy,
  request,
  confirmAt,
}: {
  table: PairingTableOut;
  itemName: (key: string) => string;
  nameOf: (value: string | null) => string;
  audition?: Audition;
  busy: boolean;
  request: (edits: readonly Edit[], what: string, at: string) => void;
  confirmAt: (at: string) => ReactNode;
}) {
  // 字符串是读不到 / 没配成的原因
  const [estimate, setEstimate] = useState<{ id: string; value: PairingEstimate | string } | null>(null);
  const [asked, setAsked] = useState<{ id: string; value: PairingSuggestOut | string } | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    debugApi
      .pairingEstimate(table.id)
      .then((e) => alive && setEstimate({ id: table.id, value: e }))
      .catch((e: unknown) => alive && setEstimate({ id: table.id, value: errText(e) }));
    return () => {
      alive = false;
    };
  }, [table.id]);

  const est = estimate?.id === table.id ? estimate.value : null;
  const result = asked?.id === table.id ? asked.value : null;
  const got = result !== null && typeof result !== 'string' ? result : null;
  const rows = got ? suggestionRows(openSuggestions(got.suggestions, table.cells), itemName, nameOf) : [];

  /** 花钱的请求:只在玩家点了按钮以后发 */
  const ask = async () => {
    const id = table.id;
    setAsking(true);
    try {
      const r = await debugApi.suggestPairings(id);
      setAsked({ id, value: r });
    } catch (e) {
      setAsked({ id, value: `没配成:${errText(e)}` });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="pg-block">
      <div className="pl-row">
        <button
          className="btn small"
          disabled={busy || asking || est === null || typeof est === 'string'}
          onClick={() => void ask()}
        >
          {asking ? '模型在配…' : '让模型重配'}
        </button>
        <span className="sp-group-note">
          {est === null
            ? '估算中…'
            : typeof est === 'string'
              ? `重配不了:${est}`
              : `约 ${est.chars} 字,用你当前的聊天连接。点了才发;回来的先列成建议,你采纳了才改。`}
        </span>
      </div>
      {est !== null && typeof est !== 'string' && (
        <details className="wi-advanced">
          <summary>看看发出去的是什么</summary>
          <pre className="pl-preview">{est.prompt}</pre>
        </details>
      )}
      {typeof result === 'string' && <span className="pl-error">{result}</span>}
      {got &&
        (got.suggestions.length === 0 ? (
          <span className="sp-group-note">模型配的和现在一样,没有要改的。</span>
        ) : rows.length === 0 ? (
          <span className="sp-group-note">建议都采纳了。</span>
        ) : (
          <>
            <span className="sp-group-note">
              模型建议改 {rows.length} 格(还没生效,点「采纳」才改,来源记「聊天模型配的」):
            </span>
            <div className="pg-table">
              {rows.map((r) => (
                <div key={r.item} className="pg-row">
                  <span className="pg-item" title={r.name}>
                    {r.name}
                  </span>
                  <span className="pg-meta">
                    {r.from} → {r.to}
                  </span>
                  {audition && r.current && audition(r.current, '听现在')}
                  {audition && r.suggested && audition(r.suggested, '听建议')}
                  <span className="pg-end">
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        request(
                          [{ item: r.item, value: r.suggested, source: 'chat' }],
                          `「${r.name}」采纳建议,改成「${r.to}」。`,
                          `sug:${r.item}`,
                        )
                      }
                    >
                      采纳
                    </button>
                  </span>
                  {confirmAt(`sug:${r.item}`)}
                </div>
              ))}
            </div>
            <div className="pl-row">
              <button
                className="btn small"
                disabled={busy}
                onClick={() =>
                  request(
                    rows.map((r) => ({ item: r.item, value: r.suggested, source: 'chat' as const })),
                    `采纳全部 ${rows.length} 条建议。`,
                    'sug:all',
                  )
                }
              >
                全部采纳
              </button>
            </div>
            {confirmAt('sug:all')}
          </>
        ))}
      {got && got.unanswered.length > 0 && (
        <span className="sp-group-note">模型漏了这几张,照旧:{got.unanswered.map(itemName).join('、')}</span>
      )}
    </div>
  );
}
