/**
 * 语音插件在调试台里的全部状态:插件配置、语音服务、声音列表、当前卡用哪些声音。
 *
 * 配置和其他插件一样:先改内存,停手半秒再写库。卡的绑定跟着当前卡走,换卡时重新拉;
 * 切得快时旧请求可能后到,只收当前这张卡的结果。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { debugApi, type CardVoices, type TtsConnection, type VoiceProfile } from '../lib/api';
import { voicePlayer } from '../vn/voice';
import {
  DEFAULT_VOICE_CONFIG,
  VOICE_SETTING_KEY,
  castOf,
  normalizeVoiceConfig,
  voiceSignature,
  type VoiceCast,
  type VoicePluginConfig,
} from './voice';
import { usePluginConfig } from './usePluginConfig';

type Notify = (kind: 'ok' | 'error', message: string) => void;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const NO_VOICES: CardVoices = { main: null, extras: [] };

export interface VoicePluginState {
  config: VoicePluginConfig;
  changeConfig: (next: VoicePluginConfig) => void;
  connections: TtsConnection[];
  profiles: VoiceProfile[];
  /** 重新拉语音服务和声音列表(抽屉里改完之后) */
  refresh: () => Promise<void>;
  /** 当前卡用哪些声音(id) */
  binding: CardVoices;
  /** 改当前卡的绑定;失败时已经弹过提示,返回 false */
  bind: (next: CardVoices) => Promise<boolean>;
  /** 当前卡的声音,已经对上声音档案 */
  cast: VoiceCast;
}

export function useVoicePlugin(cardId: string | null, notify: Notify): VoicePluginState {
  const { config, change: changeConfig } = usePluginConfig<VoicePluginConfig>(
    VOICE_SETTING_KEY,
    normalizeVoiceConfig,
    DEFAULT_VOICE_CONFIG,
    notify,
  );

  const [connections, setConnections] = useState<TtsConnection[]>([]);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  // 每个声音上次的设置:改过参数、参考之后,视觉小说里已经合成好的句子要作废重念
  const signatures = useRef<Map<string, string> | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([debugApi.listTtsConnections(), debugApi.listVoices()]);
      setConnections(c);
      setProfiles(p);
      const next = new Map(p.map((v) => [v.id, voiceSignature(v, c)]));
      const prev = signatures.current;
      signatures.current = next;
      if (prev) {
        const changed = new Set([...next].filter(([id, sig]) => prev.get(id) !== sig).map(([id]) => id));
        if (changed.size > 0) voicePlayer.forget(changed);
      }
    } catch (e) {
      notify('error', `语音配置读取失败: ${errText(e)}`);
    }
  }, [notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [binding, setBinding] = useState<CardVoices>(NO_VOICES);
  const cardRef = useRef<string | null>(null);

  useEffect(() => {
    cardRef.current = cardId;
    setBinding(NO_VOICES);
    if (!cardId) return;
    debugApi
      .getCardVoices(cardId)
      .then((b) => {
        if (cardRef.current === cardId) setBinding(b);
      })
      .catch((e: unknown) => notify('error', `卡的声音读取失败: ${errText(e)}`));
  }, [cardId, notify]);

  const bind = async (next: CardVoices) => {
    if (!cardId) return false;
    let ok = true;
    try {
      const saved = await debugApi.setCardVoices(cardId, next);
      if (cardRef.current === cardId) setBinding(saved);
    } catch (e) {
      ok = false;
      notify('error', `绑定声音失败: ${errText(e)}`);
    }
    await refresh();
    return ok;
  };

  const cast = useMemo(() => castOf(profiles, binding.main, binding.extras), [profiles, binding]);

  return { config, changeConfig, connections, profiles, refresh, binding, bind, cast };
}
