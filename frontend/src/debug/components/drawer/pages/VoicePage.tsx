/**
 * 插件抽屉角色组「语音」(第 2 步 D5,画布 V6Voice):页头(音色、用哪台语音服务)→ 常用(音色、文字和语音、
 * 最多等、语音情绪)→ 高级(缓存、配对表)→ 去卡编辑器 / 素材管理 / 游戏设置。快速预览在 D6 加。
 * 总开关在左栏这一行的行尾;情绪行、调参在卡编辑器和素材管理;语音服务在全局组。
 * 「主声音」10-25/26 改叫「音色」,下拉里是库里全部的声音,不分她的 / 别人的;选了整个替换掉,不留备用
 * (「现在我们不搞配角」)——这点和立绘 / 场景包 / CG 一样,替换逻辑在 PluginsDrawer 的 onReplaceVoice。
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
import { Advanced, PageFooter, PageHead, PageShell, Section } from '../frame';
import { Tip } from '../Tip';
import type { CardView } from '../useCardView';
import { inUseOf, type AdvOpen, type PageLinks } from './pageModel';
import { PackSwapRow, TabTitle } from './shared';
import { VoicePreview, VoiceStagePreview } from './VoicePreview';
import { useDrawerSkin } from '../skinContext';
import type { SpriteStage } from '../../../plugins/spriteLayout';

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
        title={
          stats ? `${stats.count} 句 · ${stats.bytes ? formatSize(stats.bytes) : '0 KB'} / 上限 ${formatSize(stats.limit_bytes)}` : '…'
        }
        tip="adv_cache"
        right={<DeleteButton disabled={!stats?.count} label="清空缓存" onConfirm={() => void clear()} />}
      />
    </div>
  );
}

export function VoicePage(p: {
  view: CardView;
  card: { id: string; name: string } | null;
  /** 看的就是当前聊天这张卡 */
  isCurrent: boolean;
  voice: VoicePluginState;
  cards: readonly { id: string; name: string }[];
  links: PageLinks;
  advOpen: AdvOpen;
  notify: Notify;
  /** 游戏皮的实机预览:所有角色共用的构图、最近几句台词(看的是当前卡才有) */
  stage: SpriteStage;
  recentLines: readonly string[];
  /** 素材直接换:选了一个音色(或「不念」= null),整个替换掉这张卡的声音绑定 */
  onReplaceVoice: (id: string | null) => void;
}) {
  const { view, card, voice, notify } = p;
  const { config, changeConfig } = voice;
  const facts = view.facts;
  const name = card?.name || '这张卡';
  const { game } = useDrawerSkin();

  // 缓存的条数页签上也写
  const [stats, setStats] = useState<CacheStats | null>(null);
  const loadStats = useCallback(() => {
    debugApi
      .ttsCacheStats()
      .then(setStats)
      .catch((e: unknown) => notify('error', `缓存统计读取失败: ${errText(e)}`));
  }, [notify]);
  useEffect(loadStats, [loadStats]);

  const head = (
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
  );

  const preview =
    card && facts ? (
      game ? (
        facts.mainVoice && config.enabled ? (
          <VoiceStagePreview
            key={facts.mainVoice.id}
            main={facts.mainVoice}
            card={card}
            sprites={view.sprites}
            packId={facts.spritePack?.id ?? null}
            stage={p.stage}
            background={view.bgs[0] ?? null}
            recentLines={p.recentLines}
          />
        ) : (
          <div className="dw-line">{facts.mainVoice ? '语音关着,打开页头的开关再试' : `${name}还没有音色,在右边「音色」里选一个`}</div>
        )
      ) : (
        <Section title="快速预览" tip="voice_preview" collapsible storageKey="preview.voice">
          {facts.mainVoice && config.enabled ? (
            <VoicePreview key={facts.mainVoice.id} main={facts.mainVoice} />
          ) : (
            <div className="dw-line">
              {facts.mainVoice ? '语音关着,打开左栏这一行的开关再试' : `${name}还没有音色,在下面「音色」里选一个`}
            </div>
          )}
        </Section>
      )
    ) : null;

  const common = (
    <Section title="常用" en="Common">
      {card && (
        <PackSwapRow
          label="音色"
          tip="main_voice"
          ariaLabel={`「${name}」的音色`}
          options={voice.profiles.map((v) => ({ id: v.id, name: v.name }))}
          value={facts?.mainVoice?.id ?? null}
          voidChoice="不念"
          onPick={p.onReplaceVoice}
        />
      )}
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
  );

  const advanced = (
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
            <TabTitle title="每张立绘念音色的哪段语气" tip="adv_pairings" />
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
  );

  const footer = (
    <PageFooter
      links={[
        { text: `卡编辑器 · ${name}的声音`, onClick: () => p.links.studio('voice') },
        { text: '素材管理 · 声音', onClick: () => p.links.library('voice') },
        ...(p.links.gameSettings ? [{ text: '游戏设置 · 音量', onClick: p.links.gameSettings }] : []),
      ]}
    />
  );

  return <PageShell title="语音" head={head} preview={preview} common={common} advanced={advanced} footer={footer} />;
}
