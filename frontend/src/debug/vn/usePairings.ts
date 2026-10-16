/**
 * 配对表(plugins/pairings.ts 的缓存,整个页面共用一份):表情认法选了认词记录时,语音按它挑那一行语气、CG 按它挑那一张差分。
 * 返回这份名单的表(target → 立绘 id → 配的那一行 / 那张差分),还没读到是 null;读到以后换成新的表,用到它的 useMemo 跟着重算。
 * enabled 关着时不读、返回 null(开关在旧算法上,或者还没读到)
 * 第 1d 期:检查器、配对页改一格走 savePairingCell,补配走 fillPairingTable(先发请求,成了再更新缓存),
 * 用到这份名单的 hook 都订阅着,跟着拿到新的表。视觉小说里这句的立绘在表里没有格子时走 fillMissingCell(当场补一次)
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  debugApi,
  type PairingCellOut,
  type PairingFillOut,
  type PairingFollower,
  type PairingTableOut,
} from '../lib/api';
import { PairingFiller, PairingStore, type PairTables } from '../plugins/pairings';

export const pairingStore = new PairingStore((follower, listRef) => debugApi.pairings(follower, listRef));

/** 改配对表的一格(采纳聊天模型的建议时 source 传 chat):后端改好以后马上按它走 */
export async function savePairingCell(
  table: Pick<PairingTableOut, 'id' | 'follower' | 'list_ref' | 'target'>,
  item: string,
  value: string | null,
  source: 'player' | 'chat' = 'player',
): Promise<PairingCellOut> {
  const cell = await debugApi.putPairingCell(table.id, item, { value, source });
  pairingStore.putCell(table.follower, table.list_ref, table.target, cell.item, cell.value);
  return cell;
}

/** 缺格补配:这张表缺的格子当场补上,补回来的马上按它走 */
export async function fillPairingTable(
  follower: PairingFollower,
  listRef: string,
  target: string,
): Promise<PairingFillOut> {
  const r = await debugApi.fillPairings({ follower, list_ref: listRef, target });
  pairingStore.addCells(follower, listRef, target, r.added);
  return r;
}

const filler = new PairingFiller(fillPairingTable);

/**
 * 缺格补配(设计 1.6.5 第 3 步):这句的立绘(item)在这张表里还没有格子时调。同一张表一次只发一个请求、
 * 补过的不再发、没补上的过一分钟再试(plugins/pairings.ts 的 PairingFiller);补回来的格子进缓存,用到这张表的跟着换新的
 */
export function fillMissingCell(follower: PairingFollower, listRef: string, target: string, item: string): void {
  filler.want(follower, listRef, target, item);
}

/** 不发请求、只读已经读到的(Jev 的起始表情用,和 useWordRecords 的 cachedRecordsResolver 一样);还没读到是 null */
export function cachedPairs(follower: PairingFollower, listRef: string): PairTables | null {
  return pairingStore.tables(follower, listRef);
}

export function usePairings(follower: PairingFollower, listRef: string, enabled: boolean): PairTables | null {
  // 读到、别处改了一格、补配回来都会换成新的表
  const tables = useSyncExternalStore(pairingStore.subscribe, () => pairingStore.tables(follower, listRef));

  useEffect(() => {
    if (enabled) pairingStore.sync(follower, listRef);
  }, [enabled, follower, listRef, tables]);

  return enabled ? tables : null;
}
