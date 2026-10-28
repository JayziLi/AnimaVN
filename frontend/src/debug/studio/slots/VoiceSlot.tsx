/**
 * 卡编辑器素材页的「声音」栏:顶上一行「音色」下拉框(库里全部的声音列在一起,带「不念」),选了马上整个替换掉原来的;
 * 下面整块交给 VoiceEditor,只编辑当前这一个音色(参考音频、情绪对照、试听、右栏)。
 *
 * 10-27 用户定「不做绑定了」:一张卡只用一个音色,不留备用声音。选的时候写 {main: id, extras: []}
 * (插件页「音色」下拉用的是同一个写法),卡里原来存着的备用声音随这次替换清掉,界面上不再显示。
 * 写库走 DebugApp 的 useVoicePlugin(插件抽屉的「语音」页看的也是这一份),改完它自己刷新声音列表。
 * 新建声音、导入 refs.json 在素材管理的「声音」页;名字、权重这些在 VoiceEditor 的「声音设置」里改。
 * 音色念这张卡角色自己的台词,情绪跟着差分换,所以拿差分去对情绪。
 */

import { useEffect, useMemo, useState } from 'react';
import type { PackSprite, SceneAsset, SpriteLayout } from '../../lib/api';
import type { SpriteStage } from '../../plugins/spriteLayout';
import type { VoicePluginState } from '../../plugins/useVoicePlugin';
import { VoiceEditor, type BenchStage } from '../editors/VoiceEditor';
import { Inspector, InspectorHead, PackSwap, Section, SlotIcon, TypeLabel } from '../ui';
import type { Notify } from '../types';
import { soloVoice, voiceOptions } from './voiceSlotModel';
import '../editors/voiceEditor.css';

export interface VoiceSlotProps {
  voice: VoicePluginState;
  cardName: string;
  /** 当前服装启用的差分名(空 = 这张卡没立绘,对照内置基础表情) */
  spriteLabels: readonly string[];
  notify: Notify;
  /**
   * 试听台左边的小舞台(设计稿 studio.html C):当前服装启用的差分、立绘摆法、共用构图、这张卡的背景(用第一张有图的)。
   * 不给 = 试听台没有舞台
   */
  stage?: { sprites: readonly PackSprite[]; layout: SpriteLayout; stage: SpriteStage; backgrounds: readonly SceneAsset[] };
}

export function VoiceSlot({ voice, cardName, spriteLabels, notify, stage }: VoiceSlotProps) {
  const { binding, profiles, connections, bind, refresh } = voice;
  // 插件页、别的设备也可能改过,进这一栏时刷新一次
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const options = useMemo(() => voiceOptions(profiles, connections), [profiles, connections]);
  const who = cardName.trim() || '这张卡';
  const benchStage = useMemo<BenchStage | null>(
    () =>
      stage
        ? {
            sprites: stage.sprites,
            layout: stage.layout,
            stage: stage.stage,
            background: stage.backgrounds.find((b) => b.has_file) ?? null,
            speaker: cardName.trim() || '她',
          }
        : null,
    [stage, cardName],
  );
  const [busy, setBusy] = useState(false);

  /** 选了一个音色(null = 不念):整个替换,备用声音一起清掉 */
  const pick = async (id: string | null) => {
    if (busy) return;
    setBusy(true);
    const ok = await bind(soloVoice(id));
    setBusy(false);
    if (!ok) return;
    const name = id ? (profiles.find((p) => p.id === id)?.name ?? '这个声音') : null;
    notify('ok', name ? `「${who}」换上「${name}」` : `「${who}」不念了`);
  };

  const swap = (
    <PackSwap
      label="音色"
      ariaLabel={`「${who}」的音色`}
      options={options}
      value={binding.main}
      voidLabel="不念"
      disabled={busy}
      onPick={(id) => void pick(id)}
    />
  );

  if (!binding.main) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot="voice" />
            {swap}
          </div>
          <div className="st-pending vo-empty">
            <SlotIcon slot="voice" size={28} />
            <span className="vo-empty-title">
              {options.length > 0 ? '还没选音色 · 从上面的下拉框选一个' : '声音列表是空的 · 先去素材管理建一个'}
            </span>
          </div>
        </main>
        <Inspector label="声音栏说明" head={<InspectorHead title="声音" />}>
          <Section title="音色" first />
          <p className="vo-help">
            音色念「{who}」的台词,情绪跟着差分换:每张差分用名字对得上的那一行参考音频念。一张卡只用一个音色,选了就整个换掉原来的。
          </p>
          <Section title="声音从哪来" />
          <p className="vo-help">
            声音列表里没有合适的,去素材管理 · 声音里新建,或导入语音机上的 refs.json。
          </p>
        </Inspector>
      </>
    );
  }

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot="voice" />
      {swap}
    </div>
  );

  return (
    <VoiceEditor
      voiceId={binding.main}
      name={profiles.find((p) => p.id === binding.main)?.name}
      header={header}
      spriteLabels={spriteLabels}
      onChanged={() => void refresh()}
      notify={notify}
      benchStage={benchStage}
    />
  );
}
