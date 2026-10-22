/**
 * 搬进 core/assembly.ts 以前 DebugApp 里的组装写法,原样留着当对照:core/assembly.test.ts 拿它和
 * pluginAssemblyPass 逐项比 —— 第 2 步(10-16)有意改的两条规则(玩家块不受 Jev 影响、外语块的精简版
 * 看这次有没有发标签块)在测试里写明,别的一样都不许变。
 * 库里真发出去的提示词改由 python -m app.replay prompts --compare-sent 和存下的基线比。
 */

import type { PresetOrderEntry, TavernPreset } from '../lib/presetParser';
import { anyJev, jevLangPrompt, jevOrder, jevTagKinds, type JevKinds } from '../plugins/jev';
import { LANG_BLOCK_ID } from '../plugins/lang';
import { BLOCK_OF, JEV_KINDS } from '../plugins/registry';
import type { TagKind } from '../vn/script';

/**
 * 外语块要不要换成不提标签的版本(旧规则):有在用 Jev 的,而且开着的标签插件块(含玩家台词)全是 Jev 的。
 * 还有 AI 模式的块开着时用原版 —— 原版里写了标签放哪
 */
const wantsTagFreeLang = (k: JevKinds, order: readonly PresetOrderEntry[]) =>
  anyJev(k) && !JEV_KINDS.some((x) => !k[x] && order.some((o) => o.enabled && o.identifier === BLOCK_OF[x]));

export function legacyAssemblyPass(
  preset: TavernPreset | null,
  order: PresetOrderEntry[],
  jevKinds: JevKinds,
  vnKinds: readonly TagKind[],
) {
  const jevOn = anyJev(jevKinds);
  const assemblyOrder = jevOn ? jevOrder(order, jevKinds) : order;
  const tagFreeLang = wantsTagFreeLang(jevKinds, order);
  const assemblyPreset =
    tagFreeLang && preset
      ? {
          ...preset,
          prompts: preset.prompts.map((p) =>
            p.identifier === LANG_BLOCK_ID ? { ...p, content: jevLangPrompt(p.content, vnKinds) } : p,
          ),
        }
      : preset;
  return { preset: assemblyPreset, order: assemblyOrder, stripKinds: jevOn ? jevTagKinds(jevKinds, vnKinds) : null };
}
