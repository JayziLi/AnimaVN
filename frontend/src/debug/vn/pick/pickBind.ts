/**
 * 选角色页右边那几条素材要的数据:这张卡绑着哪个立绘包、场景包、声音、预设、人设,和上次对话。
 * 全是库里真有的名字,不编。这些随时会在菜单里被改,所以不像 pickDetail.ts 那样缓存到下次进来:
 * 每次进选角色页拉一份「全局表」(包名、声音名这些),选中谁再拉谁那几项,拉过的记在这一次打开里。
 * 哪一项拉不到(旧后端、网络抖)就当没绑,不挡着别的。
 */

import {
  debugApi,
  type CardSceneParts,
  type CardSpritePacks,
  type CardVoices,
  type ChatSummary,
  type DebugPersona,
  type ScenePack,
  type SpritePack,
  type StoredPreset,
  type VoiceProfile,
} from '../../lib/api';
import { normalizeBindings, personaForCard, type PersonaBindings, PERSONA_BINDING_KEY } from '../../lib/personaBinding';
import { normalizePresetBindings, presetForCard, type PresetBindings, PRESET_BINDING_KEY } from '../../lib/presetBinding';
import type { PickBind } from './pickLogic';

/** 一次进选角色页拉一份、各张卡共用的表 */
export interface PickGlobals {
  spritePacks: SpritePack[];
  scenePacks: ScenePack[];
  voices: VoiceProfile[];
  presets: StoredPreset[];
  personas: DebugPersona[];
  presetBind: PresetBindings;
  personaBind: PersonaBindings;
}

const settled = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

export async function loadPickGlobals(): Promise<PickGlobals> {
  const [spritePacks, scenePacks, voices, presets, personas, presetRaw, personaRaw] = await Promise.all([
    settled(debugApi.listSpritePacks(), [] as SpritePack[]),
    settled(debugApi.listScenePacks(), [] as ScenePack[]),
    settled(debugApi.listVoices(), [] as VoiceProfile[]),
    settled(debugApi.listPresets(), [] as StoredPreset[]),
    settled(debugApi.listPersonas(), [] as DebugPersona[]),
    settled(debugApi.getSetting<unknown>(PRESET_BINDING_KEY), null),
    settled(debugApi.getSetting<unknown>(PERSONA_BINDING_KEY), null),
  ]);
  return {
    spritePacks,
    scenePacks,
    voices,
    presets,
    personas,
    presetBind: normalizePresetBindings(presetRaw),
    personaBind: normalizeBindings(personaRaw),
  };
}

/** 拉回来的原样,拼成 PickBind 前的样子(纯函数 buildPickBind 吃它,好测) */
export interface PickBindRaw {
  cardId: string;
  spritePacks: CardSpritePacks | null;
  scenePacks: CardSceneParts | null;
  voices: CardVoices | null;
  lastChat: ChatSummary | null;
}

/** 几个包合起来写成一个名字:一个就是它,几个是「第一个 等 N 个」 */
function packName(ids: readonly string[], byId: Map<string, ScenePack>): string | null {
  const names = ids.map((id) => byId.get(id)?.name).filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 个`;
}

export function buildPickBind(raw: PickBindRaw, g: PickGlobals): PickBind {
  const spritePack = raw.spritePacks?.current ? (g.spritePacks.find((p) => p.id === raw.spritePacks?.current)?.name ?? null) : null;

  const sceneById = new Map(g.scenePacks.map((p) => [p.id, p]));
  const bgIds = (raw.scenePacks?.bg ?? []).filter((id) => sceneById.has(id));
  const bgmIds = (raw.scenePacks?.bgm ?? []).filter((id) => sceneById.has(id));
  const named = bgIds.length > 0 ? bgIds : bgmIds;
  const sum = (ids: string[], pick: (p: ScenePack) => number) => ids.reduce((n, id) => n + pick(sceneById.get(id) as ScenePack), 0);
  const sceneName = packName(named, sceneById);
  const scene = sceneName
    ? {
        name: sceneName,
        bg: sum(bgIds, (p) => p.bg_count),
        bgm: sum(bgmIds, (p) => p.bgm_count),
        // CG 跟着出背景的那几个包算
        cg: sum(bgIds, (p) => p.cg_count ?? 0),
      }
    : null;

  const voice = raw.voices?.main ? (g.voices.find((v) => v.id === raw.voices?.main)?.name ?? null) : null;

  const presetId = presetForCard(
    g.presetBind,
    raw.cardId,
    g.presets.map((p) => p.id),
  );
  const preset = presetId ? (g.presets.find((p) => p.id === presetId)?.name ?? null) : null;

  const personaHit = personaForCard(
    g.personaBind,
    raw.cardId,
    g.personas.map((p) => p.id),
  );
  const persona = personaHit ? (g.personas.find((p) => p.id === personaHit.id)?.name ?? null) : null;

  const lastChat = raw.lastChat ? { at: raw.lastChat.updated_at, count: raw.lastChat.message_count } : null;
  return { spritePack, scene, voice, preset, persona, lastChat };
}

/** 这张卡右边那几项;lastChatId 是卡上记着的「上次打开的对话」,没有就不拉对话 */
export async function loadPickBind(cardId: string, lastChatId: string | null, g: PickGlobals): Promise<PickBind> {
  const [spritePacks, scenePacks, voices, chats] = await Promise.all([
    settled<CardSpritePacks | null>(debugApi.getCardSpritePacks(cardId), null),
    settled<CardSceneParts | null>(debugApi.getCardScenePacks(cardId), null),
    settled<CardVoices | null>(debugApi.getCardVoices(cardId), null),
    lastChatId ? settled<ChatSummary[]>(debugApi.listChats(cardId), []) : Promise.resolve([] as ChatSummary[]),
  ]);
  const lastChat = lastChatId ? (chats.find((c) => c.id === lastChatId) ?? null) : null;
  return buildPickBind({ cardId, spritePacks, scenePacks, voices, lastChat }, g);
}
