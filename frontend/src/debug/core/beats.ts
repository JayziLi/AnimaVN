/**
 * 每条回复切成一句一句:合 Jev 标注、展开宏、切句(vn/splitReply.ts)。视觉小说、存档缩略图、Jev 的起始表情
 * 共用这一份(素材架构第 1a 期从 VNScreen 原样搬来)。
 * 按条缓存:流式时每来一个字条目都会变,没变的条目直接用缓存,只重切正在写的那条。
 */
import { currentText, type ChatEntry } from '../lib/chatEntry';
import { substituteMacros, type MacroContext } from '../lib/macros';
import { entryView } from '../plugins/jevNotes';
import type { ParsedReply, TagKind } from '../vn/script';
import { splitReply } from '../vn/splitReply';

export interface Beat {
  entry: ChatEntry;
  /** 用户消息为 null */
  parsed: ParsedReply | null;
  /** 展开宏之后、切句之前的原文 —— 插话截断按它算位置 */
  raw: string;
  /** Jev 判的每句的档(卡带登记的两档题),语音换版本用;一句都没判是 null */
  tones?: readonly (string | null)[] | null;
}

interface CachedBeat {
  raw: string;
  judged: readonly number[] | null;
  cfg: string;
  parsed: ParsedReply;
  tones: Beat['tones'];
}

/** 一处用一份(组件里放 useRef(newBeatCache()));键是「条目:分支:是不是在流式」,只增不删,和原来一样 */
export type BeatCache = Map<string, CachedBeat>;
export const newBeatCache = (): BeatCache => new Map();

export function parseBeats(o: {
  entries: readonly ChatEntry[];
  tagKinds: readonly TagKind[];
  macros: MacroContext;
  charName: string;
  userName: string;
  cache: BeatCache;
}): Beat[] {
  // 名字或标签的认法变了,缓存里切好的都不能用
  const kinds = o.tagKinds.map((k) => `${k.kind}\u0001${String(k.pattern)}\u0001${k.prefix}`);
  const cfg = [o.charName, o.userName, ...kinds].join('\u0000');
  return o.entries.map((entry) => {
    if (entry.role === 'user') return { entry, parsed: null, raw: currentText(entry) };
    // 原文 + Jev 另外存的标注(plugins/jevNotes.ts)
    const view = entryView(entry, o.tagKinds);
    const raw = substituteMacros(view.text, o.macros, { seed: `${entry.id}:${entry.swipeIndex}` });
    const key = `${entry.id}:${entry.swipeIndex}:${entry.streaming ? 1 : 0}`;
    const hit = o.cache.get(key);
    if (hit && hit.raw === raw && hit.judged === view.judged && hit.cfg === cfg) {
      return { entry, parsed: hit.parsed, raw, tones: hit.tones };
    }
    const { parsed, tones } = splitReply(view, raw, {
      charName: o.charName,
      userName: o.userName,
      tags: o.tagKinds,
      streaming: Boolean(entry.streaming),
    });
    o.cache.set(key, { raw, judged: view.judged, cfg, parsed, tones });
    return { entry, parsed, raw, tones };
  });
}
