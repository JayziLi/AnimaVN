/**
 * 视觉小说原来的算法:光标停在第 beatIndex 条第 line 句时,舞台上是什么样(立绘、背景、音乐、CG),
 * 从第一条回复一路累计过来。从 VNScreen 原样搬来(素材架构第 1a 期),规则一个字没改;形态从 ctx.forms 问。
 *
 * 时间线(timeline.ts)逐句给出同样的结果。这一份只留给测试和回放检查对照,第 1 期结束后删掉。
 */
import type { SceneAsset } from '../lib/api';
import { applySceneTag, cgFrameFor, initialScene, type SceneState } from '../plugins/scene';
import { spriteLabelAfter } from '../plugins/voice';
import type { TagHit } from '../vn/script';
import type { Beat } from './beats';
import type { LineState, Pos, TimelineCtx } from './timeline';

export function legacyCursorState(beats: readonly Beat[], beatIndex: number, line: number, ctx: TimelineCtx): LineState {
  // 到当前这句为止已经生效的标签,按出现顺序。当前这条只算到正在播的这句为止;
  // 写在末尾的(-1)要等下一条回复才生效
  const hitsSoFar: TagHit[] = [];
  for (let i = 0; i <= beatIndex; i++) {
    const p = beats[i].parsed;
    if (!p) continue;
    for (const h of p.hits) {
      if (i === beatIndex && (h.lineIndex === -1 || h.lineIndex > line)) continue;
      hitsSoFar.push(h);
    }
  }
  const spriteLabel = spriteLabelAfter(hitsSoFar, ctx.emotion, ctx.sprites[0]?.label ?? null);
  const lens = ctx.forms;
  const beatId = beatIndex >= 0 ? (beats[beatIndex]?.entry.id ?? null) : null;
  const form = lens && beatId ? lens.formFor(beatId, line) : null;
  const shownLabel = lens && beatId && form !== null ? lens.labelIn(spriteLabel, form) : spriteLabel;

  // 形态切换开着时每张 CG 只在它标的形态里出:写在不能出的句子上的 CG 标签不算;
  // 切到不能出的形态那一刻收起,再切回来也不带回,等下一个 CG 标签
  let state: SceneState = initialScene(ctx.sceneAssets);
  let cgFrom: Pos | null = null;
  const cutAt = (to: Pos) => {
    const cg = state.cg;
    if (lens && cg && cgFrom && lens.switchedAway(cg, cgFrom, to)) state = { ...state, cg: null };
  };
  for (let i = 0; i <= beatIndex; i++) {
    const b = beats[i];
    for (const h of b.parsed?.hits ?? []) {
      if (i === beatIndex && (h.lineIndex === -1 || h.lineIndex > line)) continue;
      if (h.kind === 'cg' && lens) {
        const ln = h.lineIndex === -1 ? Number.MAX_SAFE_INTEGER : h.lineIndex;
        const at = lens.pos(b.entry.id, ln);
        cutAt(at);
        const next = applySceneTag(state, h, ctx.sceneAssets);
        if (next.cg && next.cg !== state.cg) {
          if (!lens.cgOk(next.cg, lens.formFor(b.entry.id, ln))) continue;
          cgFrom = at;
        }
        state = next;
        continue;
      }
      state = applySceneTag(state, h, ctx.sceneAssets);
    }
  }
  if (lens && beatId) {
    cutAt(lens.pos(beatId, line));
    if (state.cg && !lens.cgOk(state.cg, lens.formFor(beatId, line))) state = { ...state, cg: null };
  }
  // CG:画面上那张跟着这句的表情换(差分的名字是表情名,用形态换算前的);没有对应的用构图本身那张
  const cgFrame: SceneAsset | null = state.cg ? cgFrameFor(state.cg, ctx.sceneAssets, spriteLabel) : null;
  return { spriteLabel, shownLabel, form, scene: state, cgFrame };
}

/** 这条回复第一句之前生效的表情(语音、历史用):之前各条的全部立绘标签依次生效,含写在末尾的 */
export function legacyEmotionBefore(beats: readonly Beat[], beatIndex: number, ctx: TimelineCtx): string | null {
  const prior: TagHit[] = [];
  for (let i = 0; i < beatIndex; i++) prior.push(...(beats[i].parsed?.hits ?? []));
  return spriteLabelAfter(prior, ctx.emotion, ctx.sprites[0]?.label ?? null);
}
