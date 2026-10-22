/**
 * 「高级 · 认词记录」页签(第 2 步 D7,画布 V6SpriteRecords)的纯逻辑:谁定的怎么叫、搜一个词、只看模型猜的、先显示 50 条。
 */

import type { WordRecordOut } from '../../lib/api';

/** 一页先显示这么多条,多的写「还有 N 条」 */
export const RECORDS_PAGE = 50;

/** 「谁定的」那一列 */
export function recordWho(r: Pick<WordRecordOut, 'source' | 'guessed'>): string {
  switch (r.source) {
    case 'player':
      return '你改的';
    case 'model':
      return r.guessed ? '模型猜的' : '模型认的';
    case 'migrated':
      return '以前留下的';
    case 'rename':
      return '改名留下的';
    default:
      return r.source;
  }
}

/** 搜一个词(词里含这几个字,不分大小写)、只看模型猜的 */
export function filterRecords(records: readonly WordRecordOut[], query: string, onlyGuessed: boolean): WordRecordOut[] {
  const q = query.trim().toLowerCase();
  return records.filter((r) => (!onlyGuessed || r.guessed) && (!q || r.word.toLowerCase().includes(q)));
}

/** 先显示 limit 条;rest 是没显示的条数 */
export function firstPage<T>(list: readonly T[], showAll: boolean, limit = RECORDS_PAGE): { shown: readonly T[]; rest: number } {
  if (showAll || list.length <= limit) return { shown: list, rest: 0 };
  return { shown: list.slice(0, limit), rest: list.length - limit };
}
