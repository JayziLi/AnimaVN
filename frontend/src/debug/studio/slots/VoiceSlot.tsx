/**
 * 卡编辑器素材页的「声音」栏(照 V4AttachVoice.png):顶上一行是这张卡挂的声音(主声音在前、备用在后)+「＋」+「⋯」,
 * 下面整块交给 VoiceEditor(试听、情绪参考、右栏)。
 *
 * 绑定走 DebugApp 的 useVoicePlugin(插件抽屉的「语音」页看的也是这一份),改完它自己刷新声音列表。
 * 新建声音、导入 refs.json 在素材管理的「声音」页;名字、权重这些在 VoiceEditor 的「声音设置」里改。
 * 主声音念这张卡角色自己的台词,情绪跟着差分换;备用声音念卡里别的角色、只用默认情绪 ——
 * 所以只有主声音才拿差分去对情绪。
 */

import { useEffect, useState } from 'react';
import { debugApi } from '../../lib/api';
import type { VoicePluginState } from '../../plugins/useVoicePlugin';
import { switchMainVoice } from '../../plugins/voice';
import { VoiceEditor } from '../editors/VoiceEditor';
import { Icon } from '../icons';
import {
  Btn,
  Chip,
  Inspector,
  InspectorHead,
  ListDialog,
  MoreMenu,
  PackTabs,
  PromptDialog,
  Section,
  SlotIcon,
  TypeLabel,
} from '../ui';
import type { Notify } from '../types';
import { bindAdd, bindRemove, pickSelected, voiceChoices, voiceTabs } from './voiceSlotModel';
import '../editors/voiceEditor.css';

export interface VoiceSlotProps {
  voice: VoicePluginState;
  cardName: string;
  /** 当前服装启用的差分名(空 = 这张卡没立绘,对照内置基础表情) */
  spriteLabels: readonly string[];
  notify: Notify;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VoiceSlot({ voice, cardName, spriteLabels, notify }: VoiceSlotProps) {
  const { binding, profiles, connections, bind, refresh } = voice;
  // 插件页、别的设备也可能改过,进这一栏时刷新一次
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tabs = voiceTabs(binding, profiles, connections);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = pickSelected(tabs, picked);
  const tab = tabs.find((t) => t.id === selected) ?? null;
  const [dialog, setDialog] = useState<'pick' | 'rename' | null>(null);
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? '这个声音';

  const add = async (id: string) => {
    setDialog(null);
    const next = bindAdd(binding, id);
    if (!(await bind(next))) return;
    setPicked(id);
    notify('ok', next.main === id ? `「${nameOf(id)}」设为主声音` : `「${nameOf(id)}」加成备用声音`);
  };
  const makeMain = async (id: string) => {
    const old = binding.main;
    if (!(await bind(switchMainVoice(binding, id)))) return;
    notify('ok', old ? `「${nameOf(id)}」设为主声音,「${nameOf(old)}」改成备用` : `「${nameOf(id)}」设为主声音`);
  };
  const unbind = async (id: string) => {
    if (!(await bind(bindRemove(binding, id)))) return;
    setPicked(null);
    notify('ok', `「${nameOf(id)}」不再挂在这张卡上(声音本身还在声音列表里)`);
  };
  const rename = async (id: string, name: string) => {
    setDialog(null);
    try {
      await debugApi.updateVoice(id, { name });
    } catch (e) {
      notify('error', errText(e));
    }
    await refresh();
  };

  const dialogs = (
    <>
      {dialog === 'pick' && (
        <VoicePicker voice={voice} cardName={cardName} onPick={(id) => void add(id)} onCancel={() => setDialog(null)} />
      )}
      {dialog === 'rename' && tab && (
        <PromptDialog
          title="重命名声音"
          label="声音名(念台词时,说话人对上名字或别名就用这个声音)"
          initial={nameOf(tab.id)}
          onCancel={() => setDialog(null)}
          onSubmit={(v) => void rename(tab.id, v)}
        />
      )}
    </>
  );

  if (!tab) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot="voice" />
          </div>
          <div className="st-pending vo-empty">
            <SlotIcon slot="voice" size={28} />
            <span className="vo-empty-title">还没有声音 · 从声音列表选一个</span>
            <Btn icon="plus" onClick={() => setDialog('pick')}>
              从声音列表选
            </Btn>
          </div>
        </main>
        <Inspector label="声音栏说明" head={<InspectorHead title="声音" />}>
          <Section title="主声音和备用声音" first />
          <p className="vo-help">
            主声音念「{cardName || '这张卡'}」自己的台词,情绪跟着差分换:每张差分用名字对得上的那一行参考音频念。
          </p>
          <p className="vo-help">
            备用声音念卡里别的角色:台词前写了「名字：」、名字或别名对得上才念,只用它的默认情绪。同一个人换语言的版本也挂成备用,随时能换上来。
          </p>
          <Section title="声音从哪来" />
          <p className="vo-help">
            声音列表里没有合适的,去素材管理 · 声音里新建,或导入语音机上的 refs.json。
          </p>
        </Inspector>
        {dialogs}
      </>
    );
  }

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot="voice" />
      <PackTabs
        label="这张卡挂的声音"
        items={tabs.map((t) => ({ id: t.id, icon: 'mic', name: t.name, sub: t.sub, selected: t.id === tab.id }))}
        onSelect={setPicked}
        onAdd={() => setDialog('pick')}
        addLabel="添加声音(日语版,或者配角的声音)"
      />
      <span className="st-flex" />
      <MoreMenu
        label="更多:设为主声音、重命名、解除绑定"
        items={[
          { label: '设为主声音', disabled: tab.main, onClick: () => void makeMain(tab.id) },
          { label: '重命名', onClick: () => setDialog('rename') },
          { label: '解除绑定', danger: true, onClick: () => void unbind(tab.id) },
        ]}
      />
    </div>
  );

  return (
    <>
      <VoiceEditor
        voiceId={tab.id}
        name={profiles.find((p) => p.id === tab.id)?.name}
        header={header}
        spriteLabels={tab.main ? spriteLabels : null}
        onChanged={() => void refresh()}
        notify={notify}
      />
      {dialogs}
    </>
  );
}

/** 「＋」:从声音列表挑一个挂到这张卡上(名字和卡相近的排前面,已经挂着的放最后、不能再选) */
function VoicePicker({
  voice,
  cardName,
  onPick,
  onCancel,
}: {
  voice: VoicePluginState;
  cardName: string;
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  const choices = voiceChoices(voice.profiles, voice.connections, voice.binding, cardName);
  const asMain = !voice.binding.main;
  return (
    <ListDialog title={asMain ? '选一个主声音' : '添加声音'} onCancel={onCancel}>
      <p className="vo-pick-note">
        {asMain
          ? `选中的声音念「${cardName || '这张卡'}」自己的台词,情绪跟着差分换。`
          : '加成备用声音:念卡里别的角色(台词前写了「名字：」、名字或别名对得上才念)。要换主声音,挂上以后在「⋯」里设为主声音。'}
      </p>
      {choices.length === 0 ? (
        <div className="vo-pick-empty">声音列表是空的。去素材管理 · 声音里新建,或导入语音机上的 refs.json。</div>
      ) : (
        <div className="vo-pick-list" role="list">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className="vo-pick"
              disabled={c.bound !== null}
              onClick={() => onPick(c.id)}
            >
              <span className="st-packtab-icon">
                <Icon name="mic" size={17} />
              </span>
              <span className="vo-pick-text">
                <span className="vo-pick-name">{c.name}</span>
                <span className="vo-pick-sub">{c.sub}</span>
              </span>
              {c.bound ? <Chip>{c.bound === 'main' ? '主声音' : '备用'}</Chip> : c.near && <Chip>名字相近</Chip>}
            </button>
          ))}
        </div>
      )}
    </ListDialog>
  );
}
