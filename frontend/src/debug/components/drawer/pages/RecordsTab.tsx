/**
 * 「高级 · 认词记录」页签(第 2 步 D7,画布 V6SpriteRecords):看的那张卡当前名单(立绘包;没立绘是内置表情)的全部记录。
 * 顶上「{卡} · {包} · N 条」、找一个词、全部 / 模型猜的;一行 = AI 写的词 · 换成哪张(下拉,改了来源变「你改的」)·
 * 谁定的 ·「⋯」里删除。超过 50 条先显示 50 条。改和删走 vn/useWordRecords.ts,游戏里马上按新的认。
 * 没有「用过几次」那一列(库里没记)。
 */

import { useEffect, useMemo, useState } from 'react';
import { debugApi, type PackSprite, type WordRecordOut } from '../../../lib/api';
import { emotionCandidates } from '../../../plugins/emotionMatch';
import { facesByCanvas } from '../../../plugins/spriteLayout';
import { sortRecords } from '../../../plugins/pairingView';
import { FaceThumb } from '../../../studio/FaceThumb';
import { forgetWordRecord, saveWordRecord } from '../../../vn/useWordRecords';
import { useTimelineEngine } from '../../../vn/useTimelineEngine';
import { DeleteButton } from '../../pluginFields';
import { errText } from '../../pluginRunner';
import { filterRecords, firstPage, recordWho } from '../recordsView';
import { Tip } from '../Tip';

export function RecordsTab({
  cardName,
  listRef,
  sprites,
  allSprites,
  packName,
  focus,
}: {
  cardName: string;
  listRef: string;
  /** 启用的立绘(下拉的选项);空 = 内置表情 */
  sprites: readonly PackSprite[];
  /** 当前包里的全部立绘(停用的也找得到名字) */
  allSprites: readonly PackSprite[];
  packName: string | null;
  /** 快速预览里点了「改这条记录」:搜这个词、把这一行标出来 */
  focus: { word: string; nonce: number } | null;
}) {
  const engine = useTimelineEngine();
  const candidates = useMemo(() => emotionCandidates(sprites), [sprites]);
  const faces = useMemo(() => facesByCanvas(allSprites), [allSprites]);
  const builtin = sprites.length === 0;

  const [loaded, setLoaded] = useState<{ listRef: string; records: WordRecordOut[] } | null>(null);
  const [loadError, setLoadError] = useState<{ listRef: string; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    debugApi
      .emotionRecords(listRef)
      // 读到的时候排一次(模型猜的在前);改了、删了不重排,免得刚改的那行跳走
      .then((r) => alive && setLoaded({ listRef, records: sortRecords(r.records) }))
      .catch((e: unknown) => alive && setLoadError({ listRef, text: errText(e) }));
    return () => {
      alive = false;
    };
  }, [listRef]);
  const records = loaded?.listRef === listRef ? loaded.records : null;
  const error = loadError?.listRef === listRef ? loadError.text : null;

  const [query, setQuery] = useState('');
  const [onlyGuessed, setOnlyGuessed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ word: string; text: string } | null>(null);
  const focusWord = focus?.word ?? null;
  const focusNonce = focus?.nonce ?? null;
  useEffect(() => {
    if (focusWord === null) return;
    setQuery(focusWord);
    setOnlyGuessed(false);
  }, [focusWord, focusNonce]);

  const nameOf = (item: string) => {
    const c = candidates.find((x) => x.key === item);
    if (c) return c.label;
    const s = allSprites.find((x) => x.id === item);
    return s ? `${s.label}(停用了)` : '(这一项不在了)';
  };

  const change = async (r: WordRecordOut, item: string) => {
    setBusy(r.word);
    setRowError(null);
    try {
      const saved = await saveWordRecord(listRef, r.word, item);
      setLoaded((cur) =>
        cur && cur.listRef === listRef ? { listRef, records: cur.records.map((x) => (x.word === r.word ? saved : x)) } : cur,
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
      setLoaded((cur) => (cur && cur.listRef === listRef ? { listRef, records: cur.records.filter((x) => x.word !== r.word) } : cur));
      setMenu(null);
    } catch (e) {
      setRowError({ word: r.word, text: `没删成:${errText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const guessed = records?.filter((r) => r.guessed).length ?? 0;
  const list = records ? filterRecords(records, query, onlyGuessed) : [];
  const { shown, rest } = firstPage(list, showAll);

  return (
    <div className="dw-tab-stack dw-records">
      <div className="dw-records-head">
        <span className="dw-muted">
          {cardName} · {builtin ? '内置表情' : (packName ?? '立绘包')} · {records ? `${records.length} 条` : '…'}
        </span>
        <Tip k="adv_records" />
        <span className="dw-flex" />
        <input
          className="text-input dw-search"
          type="search"
          value={query}
          placeholder="找一个词"
          aria-label="找一个词"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="set-seg" role="radiogroup" aria-label="筛选">
          <button type="button" role="radio" aria-checked={!onlyGuessed} className={onlyGuessed ? '' : 'on'} onClick={() => setOnlyGuessed(false)}>
            全部
          </button>
          <button type="button" role="radio" aria-checked={onlyGuessed} className={onlyGuessed ? 'on' : ''} onClick={() => setOnlyGuessed(true)}>
            模型猜的 {guessed}
          </button>
        </span>
      </div>
      {engine === 'legacy' && (
        <div className="dw-muted">表情认法现在是「旧算法」,这些记录还不起作用(全局 · 表情认法里换成「认词记录」)。</div>
      )}
      {error ? (
        <div className="dw-bad">认词记录读不到:{error}</div>
      ) : !records ? (
        <div className="dw-muted">读取中…</div>
      ) : records.length === 0 ? (
        <div className="dw-muted">还没有记录:名字对不上的词认过一次就记在这里。</div>
      ) : (
        <div className="dw-rec-table" role="table" aria-label="认词记录">
          <div className="dw-rec-row head" role="row">
            <span role="columnheader">AI 写的词</span>
            <span role="columnheader">换成哪张</span>
            <span role="columnheader" className="dw-rec-who">
              谁定的 <Tip k="records_source" />
            </span>
            <span />
          </div>
          {shown.length === 0 && <div className="dw-muted dw-rec-empty">没有对得上的词</div>}
          {shown.map((r) => {
            const known = candidates.some((c) => c.key === r.item);
            const sprite = allSprites.find((s) => s.id === r.item) ?? null;
            return (
              <div key={r.word} className={`dw-rec-row${r.word === focusWord ? ' on' : ''}`} role="row">
                <span className="dw-rec-word" title={r.word}>
                  「{r.word}」
                </span>
                <span className="dw-rec-pick">
                  {!builtin && <FaceThumb sprite={sprite} face={sprite ? (faces.get(sprite.id) ?? null) : null} className="dw-face-26" />}
                  <select
                    className="text-input dw-rec-select"
                    value={r.item}
                    disabled={busy !== null}
                    aria-label={`「${r.word}」换成哪张`}
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
                </span>
                <span className={`dw-rec-who src-${r.source}${r.guessed ? ' guessed' : ''}`}>{recordWho(r)}</span>
                <span className="dw-rec-menu">
                  {menu === r.word ? (
                    <DeleteButton disabled={busy !== null} onConfirm={() => void remove(r)} />
                  ) : (
                    <button type="button" className="dw-dots" aria-label={`「${r.word}」更多`} onClick={() => setMenu(r.word)}>
                      ⋯
                    </button>
                  )}
                </span>
                {rowError?.word === r.word && <span className="dw-bad dw-rec-error">{rowError.text}</span>}
              </div>
            );
          })}
          {rest > 0 && (
            <button type="button" className="dw-inline-link dw-rec-more" onClick={() => setShowAll(true)}>
              还有 {rest} 条
            </button>
          )}
        </div>
      )}
    </div>
  );
}
