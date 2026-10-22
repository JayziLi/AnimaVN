/**
 * 抽屉里拼 Jev 请求(第 2 步 D6 / D7):快速预览「问 Jev」和「高级 · 问法」的「Jev 实际收到的」用同一套拼法。
 * 都只判一句(targets [0]),只带这道题要的候选:问表情只带表情名单,问场景只带背景……
 * 场景当作还在第一张背景、放它的默认曲(还没聊的样子);CG 题当作画面上是第一张 CG、在第一张背景那里。
 */

import type { SceneAsset } from '../../lib/api';
import { BUILTIN_EMOTIONS } from '../../plugins/emotions';
import type { AnnotateChoice, AnnotateRequest } from '../../plugins/jevRun';

export type AskKind = 'emotion' | 'bg' | 'bgm' | 'cg';

export const choiceOf = (x: { label: string; aliases: readonly string[]; description?: string }): AnnotateChoice => ({
  label: x.label,
  aliases: [...x.aliases],
  description: x.description ?? '',
});

/** 没写的那句用这个 */
export const SAMPLE_LINE = '「今天也辛苦啦,要不要一起去外面走走?」';

export interface AskInput {
  kind: AskKind;
  char: string;
  user: string;
  line: string;
  /** 启用的立绘(空 = 内置表情)、背景、BGM、CG 构图 */
  sprites: readonly { label: string; aliases: readonly string[]; description?: string }[];
  bgs: readonly SceneAsset[];
  bgms: readonly SceneAsset[];
  cgs: readonly SceneAsset[];
  thresholds: { speaker: number; bg: number; bgm: number; cg: number };
  prompts: Record<string, string>;
}

/** 这道题对应回来的题名(第 1 句) */
export const questionOf = (kind: AskKind): string => (kind === 'emotion' ? 'e1' : `${kind}1`);

/** 拼一个只问这道题的请求;素材不够、Jev 不会问这道题时是 null */
export function askRequest(i: AskInput): AnnotateRequest | null {
  const here = i.bgs[0] ?? null;
  const hereBgm = (here?.bgm_id ? i.bgms.find((m) => m.id === here.bgm_id) : null) ?? i.bgms[0] ?? null;
  const base: AnnotateRequest = {
    char: i.char,
    user: i.user,
    prev: '',
    lines: [{ text: i.line.trim() || SAMPLE_LINE, speaker: i.kind === 'bg' || i.kind === 'bgm' ? null : i.char }],
    targets: [0],
    emotions: [],
    bgs: [],
    bgms: [],
    cgs: [],
    scene: { bg: null, bgm: null, bg_changed: false, bgm_changed: false, cg: null, place: '' },
    ask_speaker: false,
    thresholds: i.thresholds,
    prompts: i.prompts,
  };
  switch (i.kind) {
    case 'emotion':
      return { ...base, ask_speaker: true, emotions: (i.sprites.length > 0 ? i.sprites : BUILTIN_EMOTIONS).map(choiceOf) };
    case 'bg':
      if (i.bgs.length < 2) return null;
      return {
        ...base,
        bgs: i.bgs.map(choiceOf),
        bgms: i.bgms.map(choiceOf),
        scene: { ...base.scene, bg: here?.label ?? null, bgm: hereBgm?.label ?? null },
      };
    case 'bgm':
      if (i.bgms.length < 2) return null;
      return { ...base, bgms: i.bgms.map(choiceOf), scene: { ...base.scene, bgm: hereBgm?.label ?? null } };
    case 'cg':
      if (i.cgs.length === 0) return null;
      return {
        ...base,
        cgs: i.cgs.map(choiceOf),
        scene: {
          ...base.scene,
          cg: i.cgs[0].label,
          place: here ? (here.description.trim() ? `${here.label}(${here.description.trim()})` : here.label) : '',
        },
      };
  }
}
