/**
 * 插件抽屉角色组「语音」(第 2 步 D5,画布 V6Voice):页头(主声音、用哪台语音服务)→ 常用(文字和语音、最多等、
 * 语音情绪)→ 高级(缓存、配对表)→ 去卡编辑器 / 素材管理 / 游戏设置。快速预览在 D6 加。
 * 总开关在左栏这一行的行尾;声音、情绪行、调参在卡编辑器和素材管理;语音服务在全局组。
 */

import { useCallback, useEffect, useState } from 'react';
import { debugApi } from '../../../lib/api';
import { DEFAULT_VOICE_CONFIG, MAX_WAIT_MAX, MAX_WAIT_MIN, normalizeVoiceConfig } from '../../../plugins/voice';
import type { VoicePluginState } from '../../../plugins/useVoicePlugin';
import { VoicePairingGroup } from '../../PairingGroup';
import { DeleteButton } from '../../pluginFields';
import { errText, formatSize, type Notify } from '../../pluginRunner';
import { SettingRow } from '../../settings/SettingRow';
import { headTags } from '../cardView';
import { Advanced, PageFooter, PageHead, Section } from '../frame';
import { Tip } from '../Tip';
import type { CardView } from '../useCardView';
import { inUseOf, type AdvOpen, type PageLinks } from './pageModel';
import { TabTitle } from './shared';
import { VoicePreview } from './VoicePreview';

type CacheStats = { count: number; bytes: number; limit_bytes: number };

/** 念过的句子存在后端:几句、多大,能清空 */
function CacheTab({ stats, onCleared, notify }: { stats: CacheStats | null; onCleared: () => void; notify: Notify }) {
  const clear = async () => {
    try {
      await debugApi.clearTtsCache();
    } catch (e) {
      notify('error', errText(e));
    }
    onCleared();
  };
  return (
    <div className="dw-tab-stack">
      <TabTitle
        title={stats ? `${stats.count} 句 · ${stats.bytes ? formatSize(stats.bytes) : '0 KB'} / 上限 ${formatSize(stats.limit_bytes)}` : '…'}
        tip="adv_cache"
        right={<DeleteButton disabled={!stats?.count} label="清空缓存" onConfirm={() => void clear()} />}
      />
    </div>
  );
}

export function VoicePage(p: {
  view: CardView;
  card: { id: string; name: string } | null;
  voice: VoicePluginState;
  cards: readonly { id: string; name: string }[];
  links: PageLinks;
  advOpen: AdvOpen;
  notify: Notify;
}) {
  const { view, card, voice, notify } = p;
  const { config, changeConfig } = voice;
  const facts = view.facts;
  const name = card?.name || '这张卡';

  // 缓存的条数页签上也写
  const [stats, setStats] = useState<CacheStats | null>(null);
  const loadStats = useCallback(() => {
    debugApi
      .ttsCacheStats()
      .then(setStats)
      .catch((e: unknown) => notify('error', `缓存统计读取失败: ${errText(e)}`));
  }, [notify]);
  useEffect(loadStats, [loadStats]);

  return (
    <>
      <PageHead
        title="语音"
        inUse={facts ? inUseOf(name, facts.mainVoice !== null) : null}
        tags={facts ? headTags('voice', facts, voice.connections) : []}
        note={
          config.enabled ? undefined : (
            <>
              语音关着,左栏这一行的开关打开才念
              <Tip k="voice_switch" />
            </>
          )
        }
      />

      {card && facts && (
        <Section title="快速预览" tip="voice_preview" collapsible storageKey="preview.voice">
          {facts.mainVoice && config.enabled ? (
            <VoicePreview key={facts.mainVoice.id} main={facts.mainVoice} />
          ) : (
            <div className="dw-line">
              {facts.mainVoice ? '语音关着,打开左栏这一行的开关再试' : `${name}还没有主声音`}
              {!facts.mainVoice && (
                <>
                  {' · '}
                  <button type="button" className="dw-inline-link" onClick={() => p.links.studio('voice')}>
                    去卡编辑器选一个
                  </button>
                </>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="常用">
        <SettingRow
          label="文字和语音"
          tip="text_voice"
          control={{
            kind: 'segmented',
            options: [
              { value: 'text', label: '先出文字' },
              { value: 'wait', label: '等语音' },
            ],
          }}
          value={config.waitForVoice ? 'wait' : 'text'}
          default="text"
          onChange={(v) => changeConfig({ ...config, waitForVoice: v === 'wait' })}
        />
        <SettingRow
          label="最多等"
          tip="max_wait"
          control={{ kind: 'slider', min: MAX_WAIT_MIN, max: MAX_WAIT_MAX, step: 1, format: (v) => `${v} 秒` }}
          value={config.maxWaitSec}
          default={DEFAULT_VOICE_CONFIG.maxWaitSec}
          disabled={!config.waitForVoice}
          onChange={(v) => changeConfig(normalizeVoiceConfig({ ...config, maxWaitSec: v }))}
        />
        <SettingRow
          label="语音情绪"
          tip="voice_emotion"
          control={{
            kind: 'segmented',
            options: [
              { value: 'follow', label: '跟着表情' },
              { value: 'fixed', label: '不变' },
            ],
          }}
          value={config.fixedEmotion ? 'fixed' : 'follow'}
          default="follow"
          onChange={(v) => changeConfig({ ...config, fixedEmotion: v === 'fixed' })}
        />
      </Section>

      <Advanced
        pageId="voice"
        open={p.advOpen}
        tabs={[
          { id: 'cache', name: '缓存', badge: stats ? stats.count.toLocaleString() : undefined },
          { id: 'pairings', name: '配对表' },
        ]}
        render={(tab) =>
          tab === 'cache' ? (
            <CacheTab stats={stats} onCleared={loadStats} notify={notify} />
          ) : (
            <div className="dw-tab-stack">
              <TabTitle title="每张立绘念主声音的哪段语气" tip="adv_pairings" />
              <VoicePairingGroup
                main={facts?.mainVoice ?? null}
                fixedEmotion={config.fixedEmotion}
                card={card}
                sprites={view.sprites}
                packName={view.spritePack?.name ?? null}
                cards={p.cards}
              />
            </div>
          )
        }
      />

      <PageFooter
        links={[
          { text: `卡编辑器 · ${name}的声音`, onClick: () => p.links.studio('voice') },
          { text: '素材管理 · 声音', onClick: () => p.links.library('voice') },
          ...(p.links.gameSettings ? [{ text: '游戏设置 · 音量', onClick: p.links.gameSettings }] : []),
        ]}
      />
    </>
  );
}
