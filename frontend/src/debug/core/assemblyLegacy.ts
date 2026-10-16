/**
 * 搬进 core/assembly.ts 以前 DebugApp 里的组装写法,原样留着当对照:core/assembly.test.ts 和提示词快照
 * (replay/promptSnapshot.ts)拿它和 pluginAssemblyPass 逐项比。自动补块稳定以后(第 2 期结束)删掉。
 */

import type { PresetOrderEntry, TavernPreset } from '../lib/presetParser';
import { anyJev, jevLangPrompt, jevOrder, jevTagKinds, wantsTagFreeLang, type JevKinds } from '../plugins/jev';
import { LANG_BLOCK_ID } from '../plugins/lang';
import type { TagKind } from '../vn/script';

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
