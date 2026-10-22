/**
 * 插件抽屉角色组「背景 / BGM / CG」(第 2 步 D5,画布 V6Bg):页头(包名 · 几张,AI 写 / Jev 标)→ 常用(门槛、标签格式)
 * → 高级(这道题的问法、「不换」的说明、CG 的「不显示 CG」说明、提示词模板、CG 配对表)→ 去卡编辑器 / 素材管理。
 * 场景包、CG 包和里面的素材都在卡编辑器、素材管理里改。快速预览(背景)在 D6 加。
 */

import { useState } from 'react';
import type { JevDefaults } from '../../../lib/api';
import {
  SCENE,
  SWITCH_THRESHOLD,
  initialScene,
  sceneMacros,
  sceneTagExample,
  validateSceneTemplate,
  type SceneKindKey,
  type ScenePluginConfig,
} from '../../../plugins/scene';
import type { ScenePluginState } from '../../../plugins/useScenePlugin';
import { errText, type Notify } from '../../pluginRunner';
import { loadSampleScene, SAMPLE_SCENE_PACK } from '../sampleScene';
import type { JevControls } from '../../JevSettings';
import { CgPairingGroup } from '../../PairingGroup';
import { SettingRow } from '../../settings/SettingRow';
import { headTags } from '../cardView';
import { Advanced, PageFooter, PageHead, Section, type AdvTab } from '../frame';
import type { TipKey } from '../tips';
import type { CardView } from '../useCardView';
import { inUseOf, jevKeyMissing, type AdvOpen, type BlockControls, type PageLinks, type PresetControls } from './pageModel';
import { ScenePreview } from './ScenePreview';
import { AskTab } from './AskTab';
import { askRequest, questionOf } from '../jevAsk';
import { JevKeyNote, ModeSwitch, TabTitle, TagFormatRow, TemplateTab } from './shared';

const TEXT: Record<
  SceneKindKey,
  { title: string; question: string; format: TipKey; macros: [string, string]; exampleMacro: string; library: string }
> = {
  bg: { title: '背景', question: '场景题', format: 'bg_format', macros: ['backgrounds', 'current_bg'], exampleMacro: 'bg_tag', library: '素材管理 · 背景' },
  bgm: { title: 'BGM', question: '音乐题', format: 'bgm_format', macros: ['bgms', 'current_bgm'], exampleMacro: 'bgm_tag', library: '素材管理 · BGM' },
  cg: { title: 'CG', question: 'CG 题', format: 'cg_format', macros: ['cgs', 'current_cg'], exampleMacro: 'cg_tag', library: '素材管理 · CG 包' },
};

const countOf = (kind: SceneKindKey, f: NonNullable<CardView['facts']>) => f.scene[kind];

export function ScenePage(p: {
  kind: SceneKindKey;
  view: CardView;
  card: { id: string; name: string } | null;
  /** 看的是调试台当前那张卡:宏的展开用对话进行到现在的(sceneMacros) */
  isCurrent: boolean;
  scene: ScenePluginState;
  block: BlockControls;
  preset: PresetControls;
  jev: JevControls;
  /** 调试台当前那张卡的插件宏({{backgrounds}}、{{current_bg}} …) */
  currentMacros: Record<string, string>;
  cards: readonly { id: string; name: string }[];
  links: PageLinks;
  advOpen: AdvOpen;
  /** 快速预览(只有背景页):最近几句台词、发给 Jev 的改过的问法 */
  recentLines: readonly string[];
  jevPrompts: Record<string, string>;
  userName: string;
  notify: Notify;
}) {
  const { kind, view, card, scene, jev } = p;
  const [loading, setLoading] = useState(false);
  const text = TEXT[kind];
  const config = scene.configs[kind];
  const change = (next: ScenePluginConfig) => scene.changeConfig(kind, next);
  const changeJev = (patch: Partial<ScenePluginConfig['jev']>) => change({ ...config, jev: { ...config.jev, ...patch } });
  const facts = view.facts;
  const name = card?.name || '这张卡';
  // 背景 / BGM 页:这张卡一个都没绑时,可以一键载入示例场景包先试效果(当背景和 BGM 一起绑)
  const sample = async () => {
    if (!card) return;
    setLoading(true);
    try {
      p.notify('ok', await loadSampleScene(card.id));
      view.reload();
      await scene.refreshPacks();
      if (p.isCurrent) await scene.reloadCard();
    } catch (e) {
      p.notify('error', errText(e));
    } finally {
      setLoading(false);
    }
  };
  const defaults: JevDefaults | null = jev.defaults;
  const keep = defaults?.keep ?? '不换';
  const off = defaults?.cg_off ?? '不显示CG';
  // 看的不是当前卡:宏按这张卡的素材、从头算(还没聊的样子)
  const macros = p.isCurrent
    ? p.currentMacros
    : sceneMacros(scene.configs, facts?.scene.packName !== null, view.assets, initialScene(view.assets));
  const [listMacro, currentMacro] = text.macros;

  const tabs: AdvTab[] = [
    { id: 'ask', name: `${text.question}的问法`, badge: config.jev.prompt !== null ? '改过' : undefined },
    { id: 'keep', name: `「${keep}」的说明`, badge: config.jev.keepPrompt !== null ? '改过' : undefined },
    ...(kind === 'cg' ? [{ id: 'off', name: `「${off}」的说明`, badge: config.jev.offPrompt !== null ? '改过' : undefined }] : []),
    {
      id: 'template',
      name: '提示词模板',
      badge: config.blockPrompt !== SCENE[kind].defaults.blockPrompt ? '改过' : undefined,
    },
    ...(kind === 'cg' ? [{ id: 'pairings', name: '配对表' }] : []),
  ];

  return (
    <>
      <PageHead
        title={text.title}
        inUse={facts ? inUseOf(name, countOf(kind, facts) > 0) : null}
        tags={facts ? headTags(kind, facts, []) : []}
        right={<ModeSwitch name={text.title} mode={config.mode} onChange={(mode) => change({ ...config, mode })} />}
        note={jevKeyMissing(config.mode, jev) ? <JevKeyNote jev={jev} /> : undefined}
      />

      {kind !== 'cg' && card && facts && countOf(kind, facts) === 0 && (
        <div className="dw-empty">
          <span className="dw-empty-text">
            {name}还没有{kind === 'bg' ? '背景' : 'BGM'}
          </span>
          <button type="button" className="dw-inline-link" onClick={() => p.links.studio(kind)}>
            去卡编辑器加
          </button>
          <button type="button" className="dw-inline-link" onClick={() => p.links.library(kind)}>
            去素材管理挑一套
          </button>
          <span className="dw-flex" />
          <button
            type="button"
            className="btn small"
            disabled={loading}
            onClick={() => void sample()}
            title="随仓库附带的免费素材:四个校园场景、四首曲子,可以先用来试效果"
          >
            {loading ? '载入中…' : `载入${SAMPLE_SCENE_PACK.name}`}
          </button>
        </div>
      )}

      {kind === 'bg' && card && facts && countOf(kind, facts) > 0 && (
        <Section
          title="快速预览"
          tip={config.mode === 'jev' ? 'preview_bg' : 'bg_preview_ai'}
          collapsible
          storageKey="preview.bg"
        >
          <ScenePreview
            key={`${card.id}:${config.mode}`}
            mode={config.mode}
            card={card}
            bgs={view.bgs}
            bgms={view.bgms}
            recentLines={p.recentLines}
            jev={jev}
            prompt={p.jevPrompts}
            userName={p.userName}
            thresholds={{ bg: config.jev.threshold, bgm: scene.configs.bgm.jev.threshold }}
          />
        </Section>
      )}

      <Section title="常用">
        {config.mode === 'jev' && (
          <SettingRow
            label="门槛"
            tip="threshold"
            control={{
              kind: 'slider',
              min: SWITCH_THRESHOLD.min,
              max: SWITCH_THRESHOLD.max,
              step: 0.05,
              low: '多换',
              high: '少换',
              format: (v) => v.toFixed(2),
            }}
            value={config.jev.threshold}
            default={SWITCH_THRESHOLD.default}
            onChange={(threshold) => changeJev({ threshold })}
          />
        )}
        <TagFormatRow
          tip={text.format}
          value={config.tagTemplate}
          validate={(t) => validateSceneTemplate(kind, t)}
          onChange={(tagTemplate) => change({ ...config, tagTemplate })}
        />
      </Section>

      <Advanced
        key={kind}
        pageId={kind}
        open={p.advOpen}
        tabs={tabs}
        render={(tab) => {
          if (tab === 'ask' || tab === 'keep' || tab === 'off') {
            const spec =
              tab === 'ask'
                ? { title: `${text.question}的问法`, key: kind, value: config.jev.prompt, set: (v: string | null) => changeJev({ prompt: v }) }
                : tab === 'keep'
                  ? {
                      title: `选项「${keep}」的说明`,
                      key: `${kind}_keep`,
                      value: config.jev.keepPrompt,
                      set: (v: string | null) => changeJev({ keepPrompt: v }),
                    }
                  : { title: `选项「${off}」的说明`, key: 'cg_off', value: config.jev.offPrompt, set: (v: string | null) => changeJev({ offPrompt: v }) };
            return (
              <AskTab
                key={tab}
                anchor={tab === 'ask' ? `pl-prompt-${kind}` : undefined}
                title={spec.title}
                tip={tab === 'ask' ? 'adv_ask' : undefined}
                promptKey={spec.key}
                value={spec.value}
                defaults={defaults}
                onChange={spec.set}
                question={questionOf(kind)}
                sampleNote={p.recentLines[0] ? `拿${name}最近一句代入` : '拿一句示例代入'}
                build={(over) =>
                  askRequest({
                    kind,
                    char: name,
                    user: p.userName,
                    line: p.recentLines[0] ?? '',
                    sprites: view.sprites,
                    bgs: view.bgs,
                    bgms: view.bgms,
                    cgs: view.cgs,
                    thresholds: {
                      speaker: jev.config.speakerThreshold,
                      bg: scene.configs.bg.jev.threshold,
                      bgm: scene.configs.bgm.jev.threshold,
                      cg: scene.configs.cg.jev.threshold,
                    },
                    prompts: { ...p.jevPrompts, ...over },
                  })
                }
              />
            );
          }
          if (tab === 'template') {
            return (
              <TemplateTab
                anchor={`pl-prompt-${kind}`}
                config={config}
                onChangeConfig={change}
                defaultPrompt={SCENE[kind].defaults.blockPrompt}
                example={{ macro: text.exampleMacro, value: sceneTagExample(kind, config.tagTemplate) }}
                previews={[
                  { name: listMacro, value: macros[listMacro] ?? '' },
                  { name: currentMacro, value: macros[currentMacro] ?? '' },
                ]}
                block={p.block}
                preset={p.preset}
              />
            );
          }
          return (
            <div className="dw-tab-stack">
              <TabTitle title="每张立绘配哪张 CG 差分" tip="adv_pairings" />
              <CgPairingGroup
                card={card}
                sprites={view.sprites}
                packName={view.spritePack?.name ?? null}
                assets={view.assets}
                cards={p.cards}
              />
            </div>
          );
        }}
      />

      <PageFooter
        links={[
          { text: `卡编辑器 · ${name}的${text.title}`, onClick: () => p.links.studio(kind) },
          { text: text.library, onClick: () => p.links.library(kind) },
        ]}
      />
    </>
  );
}
