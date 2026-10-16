/**
 * 一条 AI 回复切成一句一句:Jev 标注合进原文以后的那份(view)和宏展开以后的原文(raw)进来,
 * 出来每句的说话人、标签和声线档。视觉小说(VNScreen 的 beats)和回放检查(debug/replay)用的是这同一份。
 */
import { lineTones, looseLines, type JevView } from '../plugins/jevNotes';
import { parseBilingual } from '../plugins/lang';
import type { ParsedReply, TagKind } from './script';

export interface SplitReply {
  parsed: ParsedReply;
  /** Jev 判的每句的档(卡带登记的两档题);一句都没判是 null */
  tones: readonly (string | null)[] | null;
}

export function splitReply(
  view: JevView,
  raw: string,
  o: { charName: string; userName: string; tags: readonly TagKind[]; streaming: boolean },
): SplitReply {
  // 外语插件:日中交替写的回复,日语挂到它下面那句中文上;没有日语的和原来一样。
  // 立绘是 Jev 标的分支按严格规则认说话人;Jev 没判过的句子(还在判、原文改过)照切句的认法。
  // 哪几句没判过按合并后的原文算(宏展开前):切句的边界不看说话人,先切一遍拿句尾
  const strict = view.kinds.includes('sprite');
  let parsed = parseBilingual(raw, { ...o, strict });
  const ends = strict || view.tones ? (raw === view.text ? parsed.ends : parseBilingual(view.text, o).ends) : null;
  if (strict && ends) {
    const loose = looseLines(view, ends);
    if (loose.size > 0) parsed = parseBilingual(raw, { ...o, strict, loose });
  }
  // Jev 判的档记在标注上,按同样的句尾落到每句
  const tones = ends ? lineTones(view, ends) : null;
  return { parsed, tones };
}
