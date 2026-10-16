/**
 * CG 栏(导入的现成 CG)和 CG 包编辑器里的几样小算法:哪些包在这一栏、构图和它的表情差分怎么分组和排、
 * 舞台上显示哪一张、旁白那句怎么写、差分在游戏里换不换得到、上传时起名避开哪些名字。
 *
 * 一个 CG 包里是一张张「构图」(parent_id 为空),每张构图下面可以挂几张「表情差分」(parent_id = 构图 id,
 * 名字是立绘的差分名)。游戏里角色说话时按她当时的表情换成名字对得上的那张,对不上就显示构图本身
 * (plugins/scene.ts 的 cgFrameFor);竖屏焦点只看构图的,差分跟着构图走。
 * 后端的列表按 sort 排,构图和差分混在一起;这里分组时各自保持列表里的先后。
 */

import type { CgPack, SceneAsset } from '../../lib/api';
import { resolveByLabel } from '../../plugins/common';
import { cgFrameFor, cgsOf, cgVariantsOf } from '../../plugins/scene';

/**
 * CG 栏的包页签:这张卡绑着的、导入的(generated = false)CG 包,按绑定顺序。
 * AI 生成的(生图收藏建的)归「AI 生成」那一栏。包列表里还没有的(刚建、列表还没刷新)看不出来源,
 * 只认这一栏自己刚建的那几个(created)
 */
export function importedCgPackIds(
  bound: readonly string[],
  packs: readonly Pick<CgPack, 'id' | 'generated'>[],
  created: ReadonlySet<string> = new Set(),
): string[] {
  return bound.filter((id) => {
    const pack = packs.find((p) => p.id === id);
    return pack ? !pack.generated : created.has(id);
  });
}

/** 这张卡另外绑着几个 AI 生成的 CG 包(CG 栏里不显示,空状态时提一句) */
export function generatedBoundCount(bound: readonly string[], packs: readonly Pick<CgPack, 'id' | 'generated'>[]): number {
  return bound.filter((id) => packs.find((p) => p.id === id)?.generated === true).length;
}

/** 一张构图和挂在它下面的表情差分 */
export interface CgGroup {
  cg: SceneAsset;
  variants: SceneAsset[];
}

/** 包里的构图按列表顺序,每张带上自己的差分(差分也按列表顺序) */
export function groupCgs(list: readonly SceneAsset[]): CgGroup[] {
  return cgsOf(list).map((cg) => ({ cg, variants: cgVariantsOf(list, cg.id) }));
}

/** 一个包里构图几张、差分几张 */
export function cgCounts(list: readonly SceneAsset[]): { cgs: number; variants: number } {
  const cgs = cgsOf(list).length;
  const variants = list.filter((a) => a.kind === 'cg' && a.parent_id).length;
  return { cgs, variants };
}

/** 包页签的副标题:「12 个构图 · 30 张差分」(没有差分就不写后半截) */
export function cgPackSub({ cgs, variants }: { cgs: number; variants: number }): string {
  return `${cgs} 个构图${variants > 0 ? ` · ${variants} 张差分` : ''}`;
}

/** 构图网格每格名字下面那行:「3 张差分」/「没有差分」 */
export function variantCountLabel(n: number): string {
  return n > 0 ? `${n} 张差分` : '没有差分';
}

/** 包页签、「从素材库选」的小缩略图用哪张:第一张启用的、有图的构图;都停用了就第一张有图的 */
export function coverOf(list: readonly SceneAsset[]): SceneAsset | null {
  const cgs = cgsOf(list).filter((a) => a.has_file);
  return cgs.find((a) => a.enabled) ?? cgs[0] ?? null;
}

/** 选中的是哪张构图,以及(可选)它下面的哪张差分 */
export interface CgPick {
  cgId: string;
  variantId: string | null;
}

/**
 * 按选的(pick)找出构图和差分:构图不在了退到第一张构图;差分不在了(删了、换了构图)就是构图本身。
 * 包里一张构图都没有是 null
 */
export function resolvePick(
  list: readonly SceneAsset[],
  pick: CgPick | null,
): { cg: SceneAsset; variant: SceneAsset | null } | null {
  const cgs = cgsOf(list);
  const cg = (pick && cgs.find((a) => a.id === pick.cgId)) || cgs[0];
  if (!cg) return null;
  const variant = pick?.variantId && pick.cgId === cg.id ? (cgVariantsOf(list, cg.id).find((v) => v.id === pick.variantId) ?? null) : null;
  return { cg, variant };
}

/**
 * 舞台上显示的那张:选了差分就是它;否则是构图本身 —— 构图还没传图时退到第一张有图的差分(和游戏里一样,
 * cgFrameFor 不带表情)
 */
export function stageFrameOf(list: readonly SceneAsset[], cg: SceneAsset, variant: SceneAsset | null): SceneAsset {
  return variant ?? cgFrameFor(cg, list, null);
}

/** 旁白那句最多这么多字(连省略号) */
const NARRATION_MAX = 40;
/** 描述开头的「场面:」「地点:」这类小标题(冒号前最多 6 个字、不带标点和空白) */
const LEAD_KEY = /^[^:：,，。、|｜\s]{1,6}[:：]\s*/;

/**
 * 实机预览对话框里的旁白:构图描述的第一行、第一段(描述常写成「场面|在做什么|不算|场景参考」,取「|」前面那段),
 * 去掉开头「场面:」这类小标题,截到 max 字以内,截了就以「…」结尾。没写描述就用构图名
 */
export function cgNarration(cg: Pick<SceneAsset, 'label' | 'description'>, max = NARRATION_MAX): string {
  const line = cg.description.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  // 只有小标题、没写内容的那段跳过
  const text =
    line
      .split(/[|｜]/)
      .map((s) => s.trim().replace(LEAD_KEY, '').replace(/\s+/g, ' ').trim())
      .find((s) => s !== '') ?? cg.label.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 构图按新顺序排(ids = 全部构图的 id):每张构图后面跟着它的差分;ids 里没有的构图接在最后(不会丢)。
 * 后端排序只回构图,排完用它把列表换成新顺序
 */
export function orderCgs(list: readonly SceneAsset[], ids: readonly string[]): SceneAsset[] {
  const groups = groupCgs(list);
  const byId = new Map(groups.map((g) => [g.cg.id, g]));
  const ordered = [
    ...ids.map((id) => byId.get(id)).filter((g): g is CgGroup => g !== undefined),
    ...groups.filter((g) => !ids.includes(g.cg.id)),
  ];
  const grouped = new Set(groups.flatMap((g) => [g.cg.id, ...g.variants.map((v) => v.id)]));
  // 构图不在了的差分(不该有)、不是 CG 的行原样留在最后
  const rest = list.filter((a) => !grouped.has(a.id));
  return [...ordered.flatMap((g) => [g.cg, ...g.variants]), ...rest];
}

/** 后端回来的几行换进列表(按 id);列表里没有的不加 */
export function replaceRows(list: readonly SceneAsset[], rows: readonly SceneAsset[]): SceneAsset[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.map((a) => byId.get(a.id) ?? a);
}

/** 删掉一张构图:它的差分一起去掉(后端也是连着删的);删的是差分就只去掉那一张 */
export function withoutCg(list: readonly SceneAsset[], id: string): SceneAsset[] {
  return list.filter((a) => a.id !== id && a.parent_id !== id);
}

/**
 * 这张差分在游戏里换得到吗:当前服装某个差分名对得上它的名字或别名(和 cgFrameFor 一样按 resolveByLabel 找)。
 * 不知道差分名(素材管理页、这张卡没立绘)时当换得到
 */
export function variantReachable(variant: Pick<SceneAsset, 'label' | 'aliases'>, emotions: readonly string[]): boolean {
  return emotions.length === 0 || emotions.some((e) => resolveByLabel(e, [variant]) !== null);
}

/** 还没配差分的表情(按立绘里的顺序) */
export function freeEmotions(emotions: readonly string[], variants: readonly Pick<SceneAsset, 'label' | 'aliases'>[]): string[] {
  return emotions.filter((e) => resolveByLabel(e, variants) === null);
}

/** 「添加差分」填名字那一栏的说明:有没配差分的表情就列几个 */
export function variantPromptLabel(free: readonly string[]): string {
  if (free.length === 0) return '表情名(和立绘的差分名一样:说话时是这个表情,就换成这张)';
  const shown = free.slice(0, 6).join('、');
  return `表情名(还没配差分的:${shown}${free.length > 6 ? ` 等 ${free.length} 个` : ''})`;
}

/**
 * 上传时起名要避开的名字(小写):构图只和构图比,差分只和同一张构图的差分比(和后端 _check_unique 一样)。
 * parentId = null 是构图
 */
export function takenNames(list: readonly SceneAsset[], parentId: string | null): Set<string> {
  return new Set(
    list
      .filter((a) => a.kind === 'cg' && (a.parent_id ?? null) === parentId)
      .flatMap((a) => [a.label, ...a.aliases])
      .map((n) => n.toLowerCase()),
  );
}
