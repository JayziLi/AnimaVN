/**
 * 卡编辑器(全屏页)共用的类型。编辑的永远是「当前这张卡」;素材页的每一栏(立绘、声音……)
 * 由 DebugApp 的 renderSlot 填,包编辑器改完内容经 PackSync 通知 DebugApp,当前卡正在用的包马上同步进游戏。
 */

import type { PackSprite, SceneAsset, SpriteLayout } from '../lib/api';

/** 顶栏的两个页签:资料(卡、预设、人设) / 素材(绑定的包) */
export type StudioTab = 'profile' | 'assets';

/** 素材页左栏的一行 = 一栏。ai 只有装了生图卡带才有 */
export type SlotKey = 'sprite' | 'voice' | 'bg' | 'bgm' | 'cg' | 'ai';

/** 导入完成后顶上那条提示(第 3 段的导入器给) */
export interface ImportNotice {
  title: string;
  detail: string;
  /** 还没认出来的文件(暂存目录里的相对路径) */
  unknown: string[];
  jobId: string | null;
  /** 一句一条的导入报告(提示条悬停时看);旧的提示没有 */
  report?: string[];
}

/** 卡编辑器开在哪:哪个页签、素材页的哪一栏、要不要带导入提示 */
export interface StudioRoute {
  tab: StudioTab;
  slot: SlotKey;
  notice?: ImportNotice | null;
}

/** 包编辑器改完内容后通知 DebugApp,当前卡正在用的包就同步到游戏里 */
export interface PackSync {
  /** → spritePacks.changeSprites */
  sprites(packId: string, list: PackSprite[]): void;
  /** → spriteLayout.adopt(只改内存;写库由编辑器自己做) */
  layout(packId: string, layout: SpriteLayout): void;
  /** → scene.changeAssets(场景包或 CG 包) */
  scene(packId: string, list: SceneAsset[]): void;
  /** → 刷新对应的包列表 */
  packs(kind: 'sprite' | 'scene' | 'cg' | 'voice'): void;
}

/** 左栏一行:ok = 绑了东西;empty = 还没有(画成虚线圈 + 号) */
export type SlotState = 'ok' | 'empty';

export interface SlotRow {
  key: SlotKey;
  name: string;
  /** 副标题:「2 套服装 · 玉衡星」「未绑定」这类 */
  sub: string;
  state: SlotState;
}

export type Notify = (kind: 'ok' | 'error', message: string) => void;
