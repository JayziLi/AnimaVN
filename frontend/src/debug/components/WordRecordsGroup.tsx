/**
 * 插件页立绘页的「认词记录」(素材架构设计 1.4,第 1d 期):这张卡当前名单(当前立绘包;没有立绘是内置表情)的全部记录。
 * 一行一条:词 → 认成哪张(下拉,改了来源变「你改的」)、来源、小标、删除。「模型猜的」排前面。
 * 改和删走 vn/useWordRecords.ts 的 saveWordRecord / forgetWordRecord:先发请求,成了再更新整个页面共用的缓存,游戏里马上按新的认。
 */
import { useEffect, useMemo, useState } from 'react';
import { debugApi, type PackSprite, type WordRecordOut } from '../lib/api';
import { enabledOnly } from '../plugins/common';
import { emotionCandidates, emotionListRef } from '../plugins/emotionMatch';
import { recordFlags, recordSourceName, sortRecords } from '../plugins/pairingView';
import { forgetWordRecord, saveWordRecord } from '../vn/useWordRecords';
import { useTimelineEngine } from '../vn/useTimelineEngine';
import { DeleteButton } from './pluginFields';
import { errText } from './pluginRunner';

export function WordRecordsGroup({
  card,
  sprites,
  pack,
}: {
  card: { id: string; name: string } | null;
  /** 当前立绘包里的立绘(含停用的);空 = 这张卡用内置表情 */
  sprites: readonly PackSprite[];
  pack: { name: string; card_count: number } | null;
}) {
  const engine = useTimelineEngine();
  const enabled = useMemo(() => enabledOnly(sprites), [sprites]);
  const listRef = emotionListRef(enabled);
  const candidates = useMemo(() => emotionCandidates(enabled), [enabled]);
  const builtin = enabled.length === 0;

  const [loaded, setLoaded] = useState<{ listRef: string; records: WordRecordOut[] } | null>(null);
  const [loadError, setLoadError] = useState<{ listRef: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ word: string; text: string } | null>(null);

  const cardId = card?.id ?? null;
  useEffect(() => {
    if (cardId === null) return;
    let alive = true;
    debugApi
      .emotionRecords(listRef)
      // 读到的时候排一次;改了、删了不重排,免得刚改的那行跳走
      .then((r) => alive && setLoaded({ listRef, records: sortRecords(r.records) }))
      .catch((e: unknown) => alive && setLoadError({ listRef, text: errText(e) }));
    return () => {
      alive = false;
    };
  }, [cardId, listRef]);

  // 换了名单(换包、换卡)以后,上一份的结果不算
  const records = loaded?.listRef === listRef ? loaded.records : null;
  const error = loadError?.listRef === listRef ? loadError.text : null;

  /** 名单里一项的名字:停用的立绘也找得到名字 */
  const nameOf = (item: string) => {
    const c = candidates.find((x) => x.key === item);
    if (c) return c.label;
    const s = sprites.find((x) => x.id === item);
    return s ? `${s.label}(停用了)` : '(这一项不在了)';
  };

  const change = async (r: WordRecordOut, item: string) => {
    setBusy(r.word);
    setRowError(null);
    try {
      const saved = await saveWordRecord(listRef, r.word, item);
      setLoaded((cur) =>
        cur && cur.listRef === listRef
          ? { listRef, records: cur.records.map((x) => (x.word === r.word ? saved : x)) }
          : cur,
      );
    } catch (e) {
      setRowError({ word: r.word, text: `没改成:${errText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: WordRecordOut) => {
    setBusy(r.word);
    setRowError(null);
    try {
      await forgetWordRecord(listRef, r.word);
      setLoaded((cur) =>
        cur && cur.listRef === listRef ? { listRef, records: cur.records.filter((x) => x.word !== r.word) } : cur,
      );
    } catch (e) {
      setRowError({ word: r.word, text: `没删成:${errText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const guessed = records?.filter((r) => r.guessed).length ?? 0;

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">认词记录{builtin ? ' · 内置表情' : pack ? ` · ${pack.name}` : ''}</span>
        <span className="sp-group-note">
          AI 写的词和表情的名字、别名都对不上时,认过一次就记在这里,以后照着认。觉得认错了就换成别的表情(来源变「你改的」),
          或者删掉(下次出现时重新认)。「模型猜的」排在前面。
          {builtin
            ? '这张卡没有立绘,用的是内置表情的记录,没立绘的卡都共用这一份。'
            : pack && pack.card_count > 1
              ? `这个包有 ${pack.card_count} 张卡在用,它们共用这份记录。`
              : ''}
        </span>
      </div>
      {engine === 'legacy' && (
        <div className="sp-group-note">
          表情认法现在是「旧算法」,这些记录还不起作用;在视觉小说的 设置 → 数据 换成「认词记录」才按它们认。
        </div>
      )}
      {!card ? (
        <div className="sp-empty">先在右栏选一张角色卡。</div>
      ) : error ? (
        <span className="pl-error">认词记录读不到:{error}</span>
      ) : !records ? (
        <span className="sp-group-note">读取中…</span>
      ) : records.length === 0 ? (
        <div className="sp-empty">还没有记录:名字对不上的词认过一次就记在这里。</div>
      ) : (
        <>
          <span className="sp-group-note">
            共 {records.length} 条{guessed > 0 ? `,其中模型猜的 ${guessed} 条` : ''}。
          </span>
          <div className="pg-table">
            {records.map((r) => {
              const known = candidates.some((c) => c.key === r.item);
              return (
                <div key={r.word} className="pg-row">
                  <span className="pg-item" title={r.word}>
                    {r.word}
                  </span>
                  <span className="pg-meta">认成</span>
                  <select
                    className="text-input pg-select"
                    value={r.item}
                    disabled={busy !== null}
                    aria-label={`「${r.word}」认成哪张`}
                    onChange={(e) => void change(r, e.target.value)}
                  >
                    {!known && (
                      <option value={r.item} disabled>
                        {nameOf(r.item)}
                      </option>
                    )}
                    {candidates.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <span className="pg-meta">{recordSourceName(r.source)}</span>
                  {recordFlags(r).map((f) => (
                    <span key={f} className="pg-flag">
                      {f}
                    </span>
                  ))}
                  <span className="pg-end">
                    {busy === r.word && <span className="spinner tiny" />}
                    <DeleteButton disabled={busy !== null} onConfirm={() => void remove(r)} />
                  </span>
                  {rowError?.word === r.word && <span className="pl-error pg-full">{rowError.text}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
