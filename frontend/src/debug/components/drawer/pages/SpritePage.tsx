/**
 * 插件抽屉角色组「立绘」(第 2 步 D5,画布 V6Sprite):页头(AI 写 / Jev 标)→ 常用(标签格式、人物大小、头的高度)
 * → 高级(问法、提示词模板、认词记录、配对表)→ 去卡编辑器 / 素材管理。快速预览在 D6 加。
 * 立绘表、立绘包、位置和特效都在卡编辑器、素材管理里改;这里只有一张卡什么都没绑时的「载入示例 Sylvie」。
 */

import { useState } from 'react';
import { debugApi, type VoiceProfile } from '../../../lib/api';
import { DEFAULT_BLOCK_PROMPT, spriteMacros, tagExample, validateTemplate, type SpritePluginConfig } from '../../../plugins/sprite';
import { DEFAULT_SPRITE_STAGE, FACE_SIZE_RANGE, FACE_TOP_RANGE, type SpriteStage } from '../../../plugins/spriteLayout';
import type { JevControls } from '../../JevSettings';
import { CgPairingGroup, VoicePairingGroup } from '../../PairingGroup';
import { errText, type Notify } from '../../pluginRunner';
import { SettingRow } from '../../settings/SettingRow';
import { headTags } from '../cardView';
import { Advanced, PageFooter, PageHead, Section } from '../frame';
import type { CardView } from '../useCardView';
import { inUseOf, jevKeyMissing, type AdvOpen, type BlockControls, type PageLinks, type PresetControls } from './pageModel';
import { JevKeyNote, ModeSwitch, TabTitle, TagFormatRow, TemplateTab } from './shared';
import { SpritePreview } from './SpritePreview';
import { AskTab } from './AskTab';
import { RecordsTab } from './RecordsTab';
import { askRequest, questionOf } from '../jevAsk';

/** 示例立绘:Ren'Py 官方示例游戏 The Question 里的 Sylvie(MIT 授权,见 public/vn/CREDITS.txt) */
const SAMPLE_SPRITES = [
  { file: 'sylvie-blue-normal.png', label: '平静', aliases: ['normal'], description: '平常的样子' },
  { file: 'sylvie-blue-smile.png', label: '微笑', aliases: ['smile'], description: '温和地笑，心情不错' },
  { file: 'sylvie-blue-giggle.png', label: '偷笑', aliases: ['giggle'], description: '忍不住笑出来，被逗乐或者有点害羞' },
  { file: 'sylvie-blue-surprised.png', label: '惊讶', aliases: ['surprised'], description: '吃惊、意外' },
];
/** 示例立绘包的名字:载入过就直接挂上,不再建一个 */
const SAMPLE_SPRITE_PACK = '示例 · Sylvie';

const pct = (v: number) => v.toFixed(2);

/** 看的那张卡挂上示例立绘包并换过去(没有就先建一个) */
async function loadSample(cardId: string): Promise<string> {
  const [packs, bound] = await Promise.all([debugApi.listSpritePacks(), debugApi.getCardSpritePacks(cardId)]);
  const existing = packs.find((p) => p.name === SAMPLE_SPRITE_PACK);
  let packId = existing?.id;
  if (!packId) {
    const created = await debugApi.createSpritePack(SAMPLE_SPRITE_PACK, "Ren'Py 示例游戏里的 Sylvie,随仓库附带,可以先用来试效果");
    for (const s of SAMPLE_SPRITES) {
      const res = await fetch(`/vn/sample-sprites/${s.file}`);
      if (!res.ok) throw new Error(`示例图 ${s.file} 下载失败`);
      const row = await debugApi.createSprite(created.id, { label: s.label, aliases: s.aliases, description: s.description });
      await debugApi.uploadSpriteImage(created.id, row.id, await res.blob());
    }
    packId = created.id;
  }
  const ids = bound.pack_ids.includes(packId) ? bound.pack_ids : [...bound.pack_ids, packId];
  await debugApi.setCardSpritePacks(cardId, ids, packId);
  return existing ? `「${SAMPLE_SPRITE_PACK}」已经有了,已挂上并换成它` : `已载入示例立绘包:${SAMPLE_SPRITES.length} 个表情`;
}

export function SpritePage(p: {
  view: CardView;
  card: { id: string; name: string } | null;
  config: SpritePluginConfig;
  onChangeConfig: (next: SpritePluginConfig) => void;
  stage: SpriteStage;
  onChangeStage: (next: SpriteStage) => void;
  block: BlockControls;
  preset: PresetControls;
  jev: JevControls;
  /** 配对表:语音情绪设成了「不变」 */
  fixedEmotion: boolean;
  /** 配对表写「被哪些卡用」 */
  cards: readonly { id: string; name: string }[];
  links: PageLinks;
  advOpen: AdvOpen;
  notify: Notify;
  /** 看的那张卡换了立绘包以后(载入示例) */
  onSpritesChanged: () => void;
  /** 快速预览:最近几句台词、AI 写过的表情词(看的是当前卡时才有) */
  recent: { lines: readonly string[]; words: readonly string[] };
  /** 发给 Jev 的改过的问法 */
  jevPrompts: Record<string, string>;
  userName: string;
}) {
  const { view, card, config, onChangeConfig, jev } = p;
  const facts = view.facts;
  const name = card?.name || '这张卡';
  const [busy, setBusy] = useState(false);
  const macros = spriteMacros(config, view.sprites);
  const packName = view.spritePack?.name ?? null;
  const main: VoiceProfile | null = facts?.mainVoice ?? null;
  // 快速预览里点「改这条记录」:打开高级 · 认词记录,选中那个词(比外面要求的新就用它)
  const [jump, setJump] = useState<{ word: string; nonce: number } | null>(null);
  const advOpen =
    jump && (!p.advOpen || jump.nonce > p.advOpen.nonce) ? { tab: 'records', nonce: jump.nonce } : p.advOpen;

  const sample = async () => {
    if (!card) return;
    setBusy(true);
    try {
      p.notify('ok', await loadSample(card.id));
      view.reload();
      p.onSpritesChanged();
    } catch (e) {
      p.notify('error', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="立绘"
        inUse={facts ? inUseOf(name, facts.sprites > 0) : null}
        tags={facts ? headTags('sprite', facts, []) : []}
        right={<ModeSwitch name="立绘" mode={config.mode} onChange={(mode) => onChangeConfig({ ...config, mode })} />}
        note={jevKeyMissing(config.mode, jev) ? <JevKeyNote jev={jev} /> : undefined}
      />

      {card && facts && facts.sprites === 0 && (
        <div className="dw-empty">
          <span className="dw-empty-text">{name}还没有立绘</span>
          <button type="button" className="dw-inline-link" onClick={() => p.links.studio('sprite')}>
            去卡编辑器加
          </button>
          <button type="button" className="dw-inline-link" onClick={() => p.links.library('sprite')}>
            去素材管理挑一套
          </button>
          <span className="dw-flex" />
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => void sample()}
            title="Ren'Py 示例游戏里的角色 Sylvie,四个表情,可以先用来试效果"
          >
            {busy ? '载入中…' : '载入示例 Sylvie'}
          </button>
        </div>
      )}

      {card && facts && facts.sprites > 0 && (
        <Section
          title="快速预览"
          tip={config.mode === 'jev' ? 'sprite_preview_jev' : 'sprite_preview_ai'}
          collapsible
          storageKey="preview.sprite"
        >
          <SpritePreview
            key={`${card.id}:${config.mode}`}
            mode={config.mode}
            card={card}
            sprites={view.sprites}
            listRef={facts.listRef}
            recentLines={p.recent.lines}
            recentWords={p.recent.words}
            jev={jev}
            prompt={p.jevPrompts}
            userName={p.userName}
            speakerThreshold={jev.config.speakerThreshold}
            onEditRecord={(word) => setJump({ word, nonce: Date.now() })}
          />
        </Section>
      )}

      <Section title="常用">
        <TagFormatRow
          tip="tag_format"
          value={config.tagTemplate}
          validate={validateTemplate}
          onChange={(tagTemplate) => onChangeConfig({ ...config, tagTemplate })}
        />
        <SettingRow
          label="人物大小"
          tip="face_size"
          control={{ kind: 'slider', min: FACE_SIZE_RANGE.min, max: FACE_SIZE_RANGE.max, step: 0.005, format: pct }}
          value={p.stage.faceSize}
          default={DEFAULT_SPRITE_STAGE.faceSize}
          onChange={(faceSize) => p.onChangeStage({ ...p.stage, faceSize })}
        />
        <SettingRow
          label="头的高度"
          tip="head_top"
          control={{ kind: 'slider', min: FACE_TOP_RANGE.min, max: FACE_TOP_RANGE.max, step: 0.005, format: pct }}
          value={p.stage.faceTop}
          default={DEFAULT_SPRITE_STAGE.faceTop}
          onChange={(faceTop) => p.onChangeStage({ ...p.stage, faceTop })}
        />
      </Section>

      <Advanced
        pageId="sprite"
        open={advOpen}
        tabs={[
          { id: 'ask', name: '问法', badge: config.jev.emotionPrompt !== null ? '改过' : undefined },
          { id: 'template', name: '提示词模板', badge: config.blockPrompt !== DEFAULT_BLOCK_PROMPT ? '改过' : undefined },
          { id: 'records', name: '认词记录' },
          { id: 'pairings', name: '配对表' },
        ]}
        render={(tab) => {
          if (tab === 'ask') {
            return (
              <AskTab
                anchor="pl-prompt-sprite"
                title="表情题的问法"
                tip="adv_ask"
                promptKey="emotion"
                value={config.jev.emotionPrompt}
                defaults={jev.defaults}
                onChange={(v) => onChangeConfig({ ...config, jev: { ...config.jev, emotionPrompt: v } })}
                question={questionOf('emotion')}
                sampleNote={p.recent.lines[0] ? `拿${name}最近一句代入` : '拿一句示例代入'}
                build={(over) =>
                  askRequest({
                    kind: 'emotion',
                    char: name,
                    user: p.userName,
                    line: p.recent.lines[0] ?? '',
                    sprites: view.sprites,
                    bgs: [],
                    bgms: [],
                    cgs: [],
                    thresholds: { speaker: jev.config.speakerThreshold, bg: 0.6, bgm: 0.6, cg: 0.6 },
                    prompts: { ...p.jevPrompts, ...over },
                  })
                }
              />
            );
          }
          if (tab === 'template') {
            return (
              <TemplateTab
                anchor="pl-prompt-sprite"
                config={config}
                onChangeConfig={onChangeConfig}
                defaultPrompt={DEFAULT_BLOCK_PROMPT}
                example={{ macro: 'sprite_tag', value: tagExample(config.tagTemplate) }}
                previews={[
                  { name: 'sprites', value: macros.sprites },
                  { name: 'sprite_examples', value: macros.sprite_examples },
                ]}
                block={p.block}
                preset={p.preset}
              />
            );
          }
          if (tab === 'records') {
            return facts ? (
              <RecordsTab
                cardName={name}
                listRef={facts.listRef}
                sprites={view.sprites}
                allSprites={view.allSprites}
                packName={packName}
                focus={jump}
              />
            ) : (
              <div className="dw-muted">读取中…</div>
            );
          }
          return (
            <div className="dw-tab-stack">
              <TabTitle title="每张立绘念哪段语气、配哪张 CG 差分" tip="adv_pairings" />
              <VoicePairingGroup
                main={main}
                fixedEmotion={p.fixedEmotion}
                card={card}
                sprites={view.sprites}
                packName={packName}
                cards={p.cards}
              />
              <CgPairingGroup card={card} sprites={view.sprites} packName={packName} assets={view.assets} cards={p.cards} />
            </div>
          );
        }}
      />

      <PageFooter
        links={[
          { text: `卡编辑器 · ${name}的立绘`, onClick: () => p.links.studio('sprite') },
          { text: '素材管理 · 立绘包', onClick: () => p.links.library('sprite') },
        ]}
      />
    </>
  );
}
