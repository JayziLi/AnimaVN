/**
 * 「⋯ → 导出这个包(.animapack)」那一项(素材管理顶上、卡编辑器立绘 / 背景 / BGM / CG 栏共用):
 * 点了直接存文件,存好了提示「已存成 …」。同一个包还在导时再点不重复导。
 */

import { debugApi } from '../../lib/api';
import type { MenuItem } from '../../studio/ui';
import type { Notify } from '../../studio/types';
import { PACK_EXPORT_LABEL, packExportNote, packKindOf } from './exportModel';

const running = new Set<string>();

export function packExportItem(kind: 'sprite' | 'bg' | 'bgm' | 'cg', packId: string, notify: Notify): MenuItem {
  const k = packKindOf(kind);
  return {
    label: PACK_EXPORT_LABEL,
    note: packExportNote(k),
    onClick: () => {
      const key = `${k}:${packId}`;
      if (running.has(key)) return;
      running.add(key);
      debugApi
        .exportPack(k, packId)
        .then(
          (saved) => notify('ok', `已存成 ${saved.name}`),
          (e: unknown) => notify('error', `导出失败:${e instanceof Error ? e.message : String(e)}`),
        )
        .finally(() => running.delete(key));
    },
  };
}
