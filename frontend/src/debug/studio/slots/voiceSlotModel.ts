/**
 * 卡编辑器「声音」栏的纯函数:页签(主声音 + 备用声音)、挂上 / 拿掉一个声音、「＋」弹出来的声音列表怎么排。
 *
 * 主声音念这张卡角色自己的台词;备用声音念卡里别的角色(台词前写了「名字：」、名字或别名对得上才念),
 * 只用它的默认情绪(plugins/voice.ts 的 planVoiceLines)。
 */

import type { CardVoices, TtsApiType, TtsConnection, VoiceProfile } from '../../lib/api';

export const ENGINE_NAME: Record<TtsApiType, string> = { gpt_sovits: 'GPT-SoVITS', indextts: 'IndexTTS-2.5' };

/** 声音列表还没读到时页签上先写这个 */
const PENDING = '…';

export interface VoiceTab {
  id: string;
  name: string;
  /** 「GPT-SoVITS · 台式机 · 主声音」/「… · 备用」 */
  sub: string;
  main: boolean;
}

/**
 * 「引擎 · 连接名」;连接名里已经写了引擎名(「5090 · GPT-SoVITS」、默认建出来的「GPT-SoVITS」)时只写连接名,
 * 不重复;连接找不到就都不写
 */
function engineOf(p: Pick<VoiceProfile, 'connection_id'> | undefined, connections: readonly TtsConnection[]): string[] {
  const c = p && connections.find((x) => x.id === p.connection_id);
  if (!c) return [];
  const engine = ENGINE_NAME[c.api_type];
  const name = c.name.trim();
  if (!name) return [engine];
  return name.toLowerCase().includes(engine.toLowerCase()) ? [name] : [engine, name];
}

/** 页签:主声音在前,备用声音按绑定的顺序接在后面 */
export function voiceTabs(
  binding: CardVoices,
  profiles: readonly VoiceProfile[],
  connections: readonly TtsConnection[],
): VoiceTab[] {
  const ids = [...(binding.main ? [binding.main] : []), ...binding.extras.filter((x) => x !== binding.main)];
  return ids.map((id) => {
    const p = profiles.find((x) => x.id === id);
    const main = id === binding.main;
    return {
      id,
      name: p?.name ?? PENDING,
      sub: [...engineOf(p, connections), main ? '主声音' : '备用'].join(' · '),
      main,
    };
  });
}

/** 「＋」挑了一个声音:还没有主声音就当主声音,有了就加成备用(已经挂着的不动) */
export function bindAdd(binding: CardVoices, id: string): CardVoices {
  if (binding.main === id || binding.extras.includes(id)) return binding;
  return binding.main ? { main: binding.main, extras: [...binding.extras, id] } : { main: id, extras: binding.extras };
}

/** 解除绑定:拿掉主声音时不把备用的顶上去 —— 备用声音念的是别的角色,悄悄换上去会让角色换了声音 */
export function bindRemove(binding: CardVoices, id: string): CardVoices {
  return {
    main: binding.main === id ? null : binding.main,
    extras: binding.extras.filter((x) => x !== id),
  };
}

/** 选中的页签:想看的那个还挂着就是它,否则第一个;一个都没有是 null */
export function pickSelected(tabs: readonly VoiceTab[], wanted: string | null): string | null {
  return tabs.find((t) => t.id === wanted)?.id ?? tabs[0]?.id ?? null;
}

export interface VoiceChoice {
  id: string;
  name: string;
  /** 「GPT-SoVITS · 台式机 · 12 种情绪 · 被 2 张卡用」 */
  sub: string;
  /** 名字和这张卡相近(「刻晴」和「刻晴(日语)」) */
  near: boolean;
  /** 已经挂在这张卡上:主声音 / 备用;没挂是 null */
  bound: 'main' | 'extra' | null;
}

/** 比名字用:去掉括号里的版本说明和空白,不分大小写 */
const baseName = (s: string) =>
  s
    .replace(/[(（[【][^)）\]】]*[)）\]】]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

function nearName(voiceName: string, cardName: string): boolean {
  const a = baseName(voiceName);
  const b = baseName(cardName);
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

/**
 * 「＋」弹出来的声音列表:没挂的在前(名字和这张卡相近的排最前,其余按名字),
 * 已经挂着的放最后、标出是主声音还是备用
 */
export function voiceChoices(
  profiles: readonly VoiceProfile[],
  connections: readonly TtsConnection[],
  binding: CardVoices,
  cardName: string,
): VoiceChoice[] {
  const list = profiles.map((p): VoiceChoice => {
    const bound = p.id === binding.main ? 'main' : binding.extras.includes(p.id) ? 'extra' : null;
    const used = p.card_count > 0 ? `被 ${p.card_count} 张卡用` : '没有卡在用';
    return {
      id: p.id,
      name: p.name,
      sub: [...engineOf(p, connections), `${p.emotions.length} 种情绪`, used].join(' · '),
      near: nearName(p.name, cardName),
      bound,
    };
  });
  const rank = (c: VoiceChoice) => (c.bound ? 2 : c.near ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh'));
}
