/**
 * 表情认法选了「认词记录」时认表情(plugins/wordRecords.ts 的缓存,整个页面共用一份):名字和别名对上 → 认词记录 →
 * 后端模型认一次并记下来。返回一个查询函数,有新结果时换成新函数,用到它的 useMemo 会跟着重算。
 * enabled 关着时不读不问(开关在旧算法上,或者还没读到)
 * 第 1d 期:检查器、认词记录页改 / 删一条走 saveWordRecord / forgetWordRecord(先发请求,成了再更新缓存),
 * 用到这份名单的 hook 都订阅着,跟着换新函数
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { debugApi, type WordRecordOut } from '../lib/api';
import { resolveByLabel } from '../plugins/common';
import { matchTag, MAX_TAG_LEN, normTag, type EmotionCandidate, type TagResolver } from '../plugins/emotionMatch';
import { recordEntryOf, WordRecordStore } from '../plugins/wordRecords';

export const wordRecordStore = new WordRecordStore({
  records: (listRef) => debugApi.emotionRecords(listRef).then((r) => r.records),
  resolve: (listRef, words) => debugApi.emotionResolve({ list_ref: listRef, words }).then((r) => r.results),
});

/** 以后这个词都认成名单里的这一项(来源「你改的」):后端改好以后马上按它认 */
export async function saveWordRecord(listRef: string, word: string, item: string): Promise<WordRecordOut> {
  const r = await debugApi.putWordRecord({ list_ref: listRef, word, item });
  // 后端会去掉首尾空白,按它回的词记
  wordRecordStore.put(listRef, r.word, recordEntryOf(r));
  return r;
}

/** 删一条认词记录:这个词下次出现时重新认 */
export async function forgetWordRecord(listRef: string, word: string): Promise<void> {
  await debugApi.deleteWordRecord(listRef, word);
  wordRecordStore.remove(listRef, normTag(word));
}

/** 不发请求、只读已经读到问到的(Jev 的起始表情用,和 useEmotionMatches 的 cachedResolver 一样) */
export function cachedRecordsResolver(listRef: string, candidates: readonly EmotionCandidate[]): TagResolver {
  return (label) =>
    matchTag(label, candidates, (tag) => wordRecordStore.answer(listRef, tag), wordRecordStore.records(listRef));
}

export function useWordRecords(
  listRef: string,
  labels: readonly string[],
  candidates: readonly EmotionCandidate[],
  enabled: boolean,
): TagResolver {
  // 这份名单变过几次:读到、问到,或者别处改了 / 删了一条
  const version = useSyncExternalStore(wordRecordStore.subscribe, () => wordRecordStore.version(listRef));
  // 要认的:名字和别名对不上、长度合法的词,去重
  const words = useMemo(() => {
    const out = new Set<string>();
    for (const l of labels) {
      const tag = normTag(l);
      if (tag && tag.length <= MAX_TAG_LEN && !resolveByLabel(tag, candidates)) out.add(tag);
    }
    return [...out];
  }, [labels, candidates]);
  const keys = useMemo(() => new Set(candidates.map((c) => c.key)), [candidates]);

  useEffect(() => {
    // version 变了再调一次:一批一批问完;删了一条以后重新问那个词
    if (enabled) wordRecordStore.sync(listRef, words, keys);
  }, [enabled, listRef, words, keys, version]);

  return useCallback(
    (label: string) => cachedRecordsResolver(listRef, candidates)(label),
    // version:有新结果时换一个新函数
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listRef, candidates, version],
  );
}
