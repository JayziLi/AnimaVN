/**
 * 卡编辑器「声音」栏的纯函数:顶上「音色」下拉框里列什么、选了以后写成什么绑定。
 *
 * 10-27 用户定:一张卡只用一个音色(不做主 / 备用、不做绑定),库里全部声音列在一起,选了整个替换。
 * 卡里原来存着的备用声音(extras)不主动删,界面上不显示,下次换音色时随替换清掉。
 */

import type { CardVoices, TtsApiType, TtsConnection, VoiceProfile } from '../../lib/api';

export const ENGINE_NAME: Record<TtsApiType, string> = { gpt_sovits: 'GPT-SoVITS', indextts: 'IndexTTS-2.5' };

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

export interface VoiceOption {
  id: string;
  name: string;
  /** 「GPT-SoVITS · 台式机 · 12 种情绪」 */
  sub: string;
}

/** 「音色」下拉框:库里全部的声音,按声音列表的顺序,不分她的 / 别人的 */
export function voiceOptions(profiles: readonly VoiceProfile[], connections: readonly TtsConnection[]): VoiceOption[] {
  return profiles.map((p) => ({
    id: p.id,
    name: p.name,
    sub: [...engineOf(p, connections), `${p.emotions.length} 种情绪`].join(' · '),
  }));
}

/** 选了一个音色(null = 不念):整个替换,备用声音清空 */
export function soloVoice(id: string | null): CardVoices {
  return { main: id, extras: [] };
}

// ---- 下面两个卡编辑器已经不用了:调试台网页素材管理的「绑定到角色卡…」(library/libraryModel)和删声音时(DebugApp)还在用 ----

/** 加一个声音:还没有主声音就当主声音,有了就加成备用(已经挂着的不动) */
export function bindAdd(binding: CardVoices, id: string): CardVoices {
  if (binding.main === id || binding.extras.includes(id)) return binding;
  return binding.main ? { main: binding.main, extras: [...binding.extras, id] } : { main: id, extras: binding.extras };
}

/** 拿掉一个声音:拿掉主声音时不把备用的顶上去 —— 备用声音念的是别的角色,悄悄换上去会让角色换了声音 */
export function bindRemove(binding: CardVoices, id: string): CardVoices {
  return {
    main: binding.main === id ? null : binding.main,
    extras: binding.extras.filter((x) => x !== id),
  };
}
