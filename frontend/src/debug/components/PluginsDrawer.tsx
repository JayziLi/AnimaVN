import { useEffect, useMemo, useRef, useState } from 'react';
import {
  debugApi,
  sceneFileUrl,
  sceneThumbUrl,
  spriteImageUrl,
  type PackSprite,
  type SpriteEffect,
  type EmotionStatus,
  type SceneAsset,
  type SceneAssetPatch,
  type SceneKind,
} from '../lib/api';
import { enabledOnly, type BlockState, type PluginConfig } from '../plugins/common';
import { labelFromFile, uniqueLabel } from '../lib/assetNames';
import type { LangPluginConfig } from '../plugins/lang';
import type { PlayerPluginConfig } from '../plugins/player';
import { navItems, type BlockPluginId } from '../plugins/registry';
import {
  SCENE,
  SWITCH_THRESHOLD,
  CG_OFF_WORD,
  backgroundsOf,
  bgmsOf,
  cgVariantsOf,
  cgsOf,
  sceneTagExample,
  validateSceneTemplate,
  type SceneKindKey,
  type ScenePluginConfig,
} from '../plugins/scene';
import {
  DEFAULT_BLOCK_PROMPT,
  spriteMacros,
  tagExample,
  validateTemplate,
  type SpritePluginConfig,
} from '../plugins/sprite';
import type { ScenePluginState } from '../plugins/useScenePlugin';
import type { SpriteLayoutState } from '../plugins/useSpriteLayout';
import type { SpritePackState } from '../plugins/useSpritePacks';
import type { VoicePluginState } from '../plugins/useVoicePlugin';
import { bgmPlayer, useBgm } from '../vn/bgm';
import { CommitField, DeleteButton } from './pluginFields';
import { JevCommon, ModeBar, OFF_NOTE, PowerSwitch, PromptField, ThresholdField, type JevControls, type Power } from './JevSettings';
import type { PluginSwitches, SwitchKind } from '../plugins/switches';
import { LangPanel } from './LangPanel';
import { PlayerPanel } from './PlayerPanel';
import { SpritePosition } from './SpritePosition';
import { SpriteFxFields } from './SpriteFxFields';
import { SpriteBubble } from '../vn/SpriteBubble';
import { MOTION_FRAMES, playFxSound } from '../plugins/spriteFx';
import type { CartridgePanel, SpliceState } from '../plugins/cartridges';
import { cgForms } from '../plugins/forms';
import { text as defaultText } from '../plugins/texts';
import { errText, formatSize, useRunner } from './pluginRunner';
import { VoicePanel } from './VoicePanel';
import { WordRecordsGroup } from './WordRecordsGroup';
import { CgPairingGroup } from './PairingGroup';

/**
 * 插件抽屉 —— 左边是插件列表,右边是选中插件的配置。
 *
 * 每个插件都是同一个结构:提示词块(写进预设)、标签格式、提示词模板、素材表。
 * 立绘的素材在立绘包里,卡挂一个或几个包、游戏里随时换;背景、BGM、CG 的素材在场景包里,
 * 卡绑定一个包(三页共用顶上的场景包选择器)。语音的素材是语音服务那台机器上的模型和参考音频,这里只存路径,
 * 见 VoicePanel。
 */

/** 一个插件块在当前预设里的状态,以及对它的操作。块的正文就是插件的提示词模板,这里不管 */
export interface BlockControls {
  state: BlockState;
  onInsert: () => void;
  onToggle: () => void;
  /** 从当前预设里拿掉这一块 */
  onRemove: () => void;
}

/** 有提示词块的插件(插件总表 plugins/registry.ts 里有 blockId 的那几行) */
export type PluginKey = BlockPluginId;
/**
 * 抽屉左边列的一页:插件总表的 id(语音没有提示词块,所以不在 PluginKey 里),
 * 或者卡带那一页的 key(plugins/cartridges.ts 的 CartridgePanel)
 */
export type PluginSection = string;
/** 打开到哪个插件;有提示词模板的滚到模板那儿。nonce 变了就再跳一次 */
export interface PluginFocus {
  section: PluginSection;
  nonce: number;
}

interface Props {
  presetName: string | null;
  presetDirty: boolean;
  presetBusy: boolean;
  onSavePreset: () => void;

  card: { id: string; name: string } | null;

  sprite: {
    config: SpritePluginConfig;
    onChangeConfig: (next: SpritePluginConfig) => void;
    block: BlockControls;
    /** 这张卡挂的立绘包、当前包和它的立绘 */
    packs: SpritePackState;
    /** 立绘在游戏里怎么摆 */
    layout: SpriteLayoutState;
  };
  /** 全部角色卡,立绘位置预览里拿来对照 */
  cards: { id: string; name: string }[];

  scene: ScenePluginState;
  sceneBlocks: Record<SceneKindKey, BlockControls>;
  /** 插件宏的当前展开结果({{backgrounds}}、{{current_bg}} …),预览用 */
  sceneMacros: Record<string, string>;

  voice: VoicePluginState;
  /** 拆句拼接(卡带的 useSplice):插件页里它那一页 */
  splice: SpliceState;
  /** 别的卡带在插件页里的页(插图卡带的「生图」…);拆句拼接那一页在 splice 里 */
  panels?: readonly CartridgePanel[];
  /** 插件开关(plugins/switches.ts):立绘 / 背景 / 音乐 / CG / AI 出图页右上角的小开关 */
  switches: { value: PluginSwitches; onChange: (next: PluginSwitches) => void };

  /** 外语插件:日语配音、中文字幕 */
  lang: {
    config: LangPluginConfig;
    onChangeConfig: (next: LangPluginConfig) => void;
    block: BlockControls;
  };

  /** 玩家台词插件:模型替玩家写的台词弹成选项 */
  player: {
    config: PlayerPluginConfig;
    onChangeConfig: (next: PlayerPluginConfig) => void;
    block: BlockControls;
  };

  /** Jev 标注:立绘 / 背景 / BGM / 玩家台词每个插件可以选让 Jev 标(几个插件共用的设置在这里) */
  jev: JevControls;

  /** 从左栏点插件块跳过来:打开到这个插件,滚到提示词模板(语音没有模板,只切过去) */
  focus: PluginFocus | null;

  notify: (kind: 'ok' | 'error', message: string) => void;
  onClose: () => void;
}

/** 示例立绘:Ren'Py 官方示例游戏 The Question 里的 Sylvie(MIT 授权,见 public/vn/CREDITS.txt) */
const SAMPLE_SPRITES = [
  { file: 'sylvie-blue-normal.png', label: '平静', aliases: ['normal'], description: '平常的样子' },
  { file: 'sylvie-blue-smile.png', label: '微笑', aliases: ['smile'], description: '温和地笑，心情不错' },
  { file: 'sylvie-blue-giggle.png', label: '偷笑', aliases: ['giggle'], description: '忍不住笑出来，被逗乐或者有点害羞' },
  { file: 'sylvie-blue-surprised.png', label: '惊讶', aliases: ['surprised'], description: '吃惊、意外' },
];

/**
 * 示例场景包:背景来自 Ren'Py 示例游戏(MIT),音乐是 Kevin MacLeod 的曲子(CC BY 4.0),
 * 出处见 public/vn/CREDITS.txt
 */
const SAMPLE_PACK = {
  name: '示例 · 校园',
  description: '随仓库附带的免费授权素材,可以先用来试效果',
  bgms: [
    { file: 'bgm/carefree.mp3', label: '日常', aliases: ['daily'], description: '轻快的日常曲（Carefree）' },
    { file: 'bgm/wallpaper.mp3', label: '温馨', aliases: ['warm'], description: '温暖、放松（Wallpaper）' },
    { file: 'bgm/investigations.mp3', label: '紧张', aliases: ['tense'], description: '悬疑、紧张、有点不安（Investigations）' },
    { file: 'bgm/sad-trio.mp3', label: '伤感', aliases: ['sad'], description: '安静的伤感、回忆（Sad Trio）' },
  ],
  bgs: [
    { file: 'bg/uni.jpg', label: '校园', aliases: ['campus'], description: '大学校园的林荫道，白天', bgm: '日常', focus: 50 },
    { file: 'bg/lecturehall.jpg', label: '教室', aliases: ['classroom'], description: '阶梯教室', bgm: '日常', focus: 50 },
    { file: 'bg/club.jpg', label: '活动室', aliases: ['club'], description: '社团活动室，室内', bgm: '温馨', focus: 50 },
    { file: 'bg/meadow.jpg', label: '草地', aliases: ['meadow'], description: '郊外开阔的草地，安静', bgm: '温馨', focus: 50 },
  ],
};

/** 这张卡当前立绘包的名字;没挂包是 null */
const currentPackName = (packs: SpritePackState) => packs.packs.find((p) => p.id === packs.packId)?.name ?? null;

/** 一个插件的总开关(plugins/switches.ts) */
const powerOf = (sw: Props['switches'], kind: SwitchKind): Power => ({
  on: sw.value[kind],
  onChange: (on) => sw.onChange({ ...sw.value, [kind]: on }),
});

export function PluginsDrawer(props: Props) {
  const { focus } = props;
  const [section, setSection] = useState<PluginSection>(focus?.section ?? 'sprite');
  const { refreshPacks } = props.scene;
  // 卡带的页:拆句拼接那一页 + 别的卡带给的
  const cartridgePanels = useMemo(
    () => [props.splice.panel, ...(props.panels ?? [])].filter((p): p is CartridgePanel => p !== null),
    [props.splice.panel, props.panels],
  );

  // 左栏点了插件块:切到那个插件,把提示词模板滚进视野并闪一下,光标放进去
  useEffect(() => {
    if (!focus) return;
    setSection(focus.section);
    let clear: number | undefined;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`pl-prompt-${focus.section}`);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.classList.add('pl-flash');
      el.querySelector('textarea')?.focus({ preventScroll: true });
      clear = window.setTimeout(() => el.classList.remove('pl-flash'), 1600);
    }, 60);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(clear);
    };
  }, [focus]);

  // 场景包的数量、素材数这些在别处(别的设备)也可能变,进背景 / BGM / CG 页时刷新一次
  useEffect(() => {
    if (section === 'bg' || section === 'bgm' || section === 'cg') void refreshPacks();
  }, [section, refreshPacks]);

  return (
    <div className="conn-drawer sp-drawer">
      <div className="conn-drawer-head">
        <span className="conn-drawer-title">插件 · PLUGINS</span>
        <span className="conn-drawer-sub">给视觉小说界面用的素材和提示词</span>
        <div style={{ flex: 1 }} />
        <button className="panel-collapse" onClick={props.onClose} title="关闭">
          ✕
        </button>
      </div>

      <div className="sp-main">
        <div className="sp-nav">
          {/* 左栏照插件总表(plugins/registry.ts)的先后列 */}
          {navItems(cartridgePanels).map((p) => (
            <button
              key={p.id}
              className={`sp-nav-item${section === p.id ? ' active' : ''}`}
              onClick={() => setSection(p.id)}
            >
              <span>{p.name}</span>
              {p.beta && <span className="pl-beta">BETA</span>}
            </button>
          ))}
        </div>

        <div className="sp-body">
          {section === 'sprite' && <SpriteSection {...props} />}
          {(section === 'bg' || section === 'bgm' || section === 'cg') && (
            <SceneSection key={section} kind={section} {...props} />
          )}
          {section === 'voice' && (
            <VoicePanel
              voice={props.voice}
              card={props.card}
              sprites={enabledOnly(props.sprite.packs.sprites)}
              packName={currentPackName(props.sprite.packs)}
              cards={props.cards}
              notify={props.notify}
            />
          )}
          {(() => {
            const panel = cartridgePanels.find((p) => p.key === section);
            if (!panel) return null;
            const power = panel.power ? powerOf(props.switches, panel.power) : null;
            return (
              <>
                {/* 卡带页没有 AI / Jev 二选一:有开关的,顶上单放一行 */}
                {power && (
                  <div className="pl-powerbar">
                    <span className={power.on ? 'sp-group-note' : 'pl-error'}>
                      {power.on ? `${panel.title}开着` : OFF_NOTE}
                    </span>
                    <PowerSwitch name={panel.title} {...power} />
                  </div>
                )}
                {panel.render({ profiles: props.voice.profiles })}
              </>
            );
          })()}
          {section === 'lang' && (
            <LangPanel
              config={props.lang.config}
              onChangeConfig={props.lang.onChangeConfig}
              blockGroup={
                <BlockGroup
                  what="外语"
                  block={props.lang.block}
                  presetName={props.presetName}
                  presetDirty={props.presetDirty}
                  presetBusy={props.presetBusy}
                  onSavePreset={props.onSavePreset}
                />
              }
            />
          )}
          {section === 'player' && <PlayerSection {...props} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── 玩家台词 ───────────────────────────

/** 玩家台词:AI 按块写 <我>,或者 Jev 认出玩家说的台词(见 PlayerPanel / plugins/jev.ts) */
function PlayerSection({ player, jev, notify, presetName, presetDirty, presetBusy, onSavePreset }: Props) {
  const { config, onChangeConfig } = player;
  return (
    <>
      <ModeBar
        name="玩家台词"
        kind="player"
        mode={config.mode}
        onChangeMode={(mode) => onChangeConfig({ ...config, mode })}
        jev={jev}
        aiNote="AI 按「玩家台词」块在玩家说的每一句前写 <我>"
        jevNote="LLM 只写正文,哪句是玩家说的由 Jev 判断后补上;「玩家台词 · 插件」块不发"
      />
      {config.mode === 'jev' ? (
        <>
          <JevCommon jev={jev} notify={notify} />
          <div className="sp-group">
            <div className="sp-group-head">
              <span className="sp-group-title">弹成选项</span>
              <span className="sp-group-note">
                模型替玩家写的台词,Jev 认出来以后怎么显示。「谁说的」这道题的问法和门槛在上面的通用设置里。
              </span>
            </div>
            <label className="vp-check">
              <input
                type="checkbox"
                checked={config.jev.popup}
                onChange={(e) => onChangeConfig({ ...config, jev: { ...config.jev, popup: e.target.checked } })}
              />
              Jev 认出的玩家台词弹成选项
            </label>
            <span className="sp-group-note">
              开:翻到这句先弹一个选项,选中后以玩家的名义显示,不念、不切立绘。关:照常显示成旁白的样子,名牌留空、不念。
            </span>
          </div>
        </>
      ) : (
        <PlayerPanel
          config={config}
          onChangeConfig={onChangeConfig}
          blockGroup={
            <BlockGroup
              what="玩家台词"
              block={player.block}
              presetName={presetName}
              presetDirty={presetDirty}
              presetBusy={presetBusy}
              onSavePreset={onSavePreset}
            />
          }
        />
      )}
    </>
  );
}

// ─────────────────────────── 三个插件共用的几块 ───────────────────────────

const BLOCK_STATE_TEXT: Record<BlockState, (what: string) => string> = {
  'no-preset': () => '还没有选预设',
  missing: (what) => `当前预设里还没有${what}块`,
  off: () => '已加入,但在编排里关着 —— 发送时不会带上',
  on: () => '已开启 —— 每次发送都会带上这块',
};

/** 「提示词块」一组:块在当前预设里的状态、加入 / 开关 / 移出、保存预设 */
function BlockGroup({
  what,
  block,
  presetName,
  presetDirty,
  presetBusy,
  onSavePreset,
}: {
  what: string;
  block: BlockControls;
  presetName: string | null;
  presetDirty: boolean;
  presetBusy: boolean;
  onSavePreset: () => void;
}) {
  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">提示词块</span>
        <span className="sp-group-note">
          作为一个新块加进预设,在左栏标着「插件」,可以开关、拖动位置;正文就是下面的提示词模板,
          所有预设共用这一份,不能在预设里单独改。预设里原有的块不会被改动。
        </span>
      </div>
      <div className={`pl-status ${block.state}`}>
        <span className="pl-status-dot" />
        <span className="pl-status-text">
          {presetName && <b>「{presetName}」</b>}
          {BLOCK_STATE_TEXT[block.state](what)}
        </span>
        {block.state === 'missing' && (
          <button className="btn small accent" onClick={block.onInsert}>
            加入当前预设
          </button>
        )}
        {(block.state === 'on' || block.state === 'off') && (
          <>
            <button className="btn small" onClick={block.onToggle}>
              {block.state === 'on' ? '关闭' : '开启'}
            </button>
            <DeleteButton disabled={false} label="移出预设" onConfirm={block.onRemove} />
          </>
        )}
      </div>
      {presetDirty && (
        <div className="pl-row">
          <span className="sp-group-note">预设有还没保存的修改,不保存的话刷新页面就没了。</span>
          <button className="btn small accent" disabled={presetBusy} onClick={onSavePreset}>
            保存预设
          </button>
        </div>
      )}
    </div>
  );
}

/** 「标签格式」+「提示词模板」两组 */
function ConfigGroups<C extends PluginConfig>({
  anchor,
  config,
  onChangeConfig,
  validate,
  tagNote,
  sampleTag,
  defaultPrompt,
  promptNote,
  exampleMacro,
  example,
  previews,
}: {
  /** 提示词模板那一组的 id,左栏点插件块时滚到这里 */
  anchor: string;
  config: C;
  onChangeConfig: (next: C) => void;
  validate: (template: string) => string | null;
  tagNote: string;
  /** 模板 → AI 写出来的样子,比如 <sprite:微笑>「……」 */
  sampleTag: (template: string) => string;
  defaultPrompt: string;
  promptNote: React.ReactNode;
  /** {{sprite_tag}} 这类宏的名字和展开结果 */
  exampleMacro: string;
  example: string;
  /** 列表类宏的当前展开结果 */
  previews: { name: string; value: string }[];
}) {
  // 模板允许暂时是半成品(正在打字),合法了才往外交
  const [templateDraft, setTemplateDraft] = useState(config.tagTemplate);
  // 外面的配置变了(设置从后端读回来晚于抽屉打开、点了恢复默认)要跟上:不然显示的是旧模板,
  // 下一次按键就拿旧模板改一个字存回去,把读回来的自定义模板盖掉。自己打的合法模板交出去以后
  // 两边一样,这里不会动它
  useEffect(() => setTemplateDraft(config.tagTemplate), [config.tagTemplate]);
  const templateError = validate(templateDraft);

  return (
    <>
      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">标签格式</span>
          <span className="sp-group-note">{tagNote} 全局通用,手机和电脑同步。</span>
        </div>
        <input
          className="text-input pl-wide"
          value={templateDraft}
          spellCheck={false}
          onChange={(e) => {
            setTemplateDraft(e.target.value);
            if (validate(e.target.value) === null) {
              onChangeConfig({ ...config, tagTemplate: e.target.value });
            }
          }}
        />
        {templateError ? (
          <span className="pl-error">
            {templateError}(现在仍按「{config.tagTemplate}」识别)
          </span>
        ) : (
          <span className="sp-group-note">
            AI 会这样写:<code className="pl-code">{sampleTag(templateDraft)}</code>
          </span>
        )}
      </div>

      <div className="sp-group" id={anchor}>
        <div className="sp-group-head">
          <span className="sp-group-title">提示词模板</span>
          <span className="sp-group-note">{promptNote}</span>
        </div>
        <textarea
          className="text-input pl-wide pl-textarea"
          rows={9}
          value={config.blockPrompt}
          spellCheck={false}
          onChange={(e) => onChangeConfig({ ...config, blockPrompt: e.target.value })}
        />
        <div className="pl-row">
          <span className="sp-group-note">
            {`{{${exampleMacro}}}`} → <code className="pl-code">{example}</code>
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn small"
            disabled={config.blockPrompt === defaultPrompt}
            onClick={() => onChangeConfig({ ...config, blockPrompt: defaultPrompt })}
          >
            恢复默认模板
          </button>
        </div>
        {previews.map((p) => (
          <div key={p.name}>
            <div className="sp-group-note">{`{{${p.name}}}`} 现在展开为:</div>
            <pre className="pl-preview">{p.value}</pre>
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────── 立绘 ───────────────────────────

/** 情绪识别模型装没装:对不上立绘名的标签靠它挑最像的 */
function EmotionModelStatus() {
  const [status, setStatus] = useState<EmotionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    debugApi
      .emotionStatus()
      .then((s) => alive && setStatus(s))
      .catch((e: unknown) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">情绪识别</span>
        <span className="sp-group-note">AI 写的表情对不上立绘名时,用模型挑列表里最像的一张。</span>
      </div>
      {error ? (
        <span className="pl-error">查不到模型状态:{error}</span>
      ) : !status ? (
        <span className="sp-group-note">检查中…</span>
      ) : status.ready ? (
        <span className="sp-group-note">模型已就绪({status.model})</span>
      ) : (
        <span className="pl-error">
          {status.detail}。在 AnimaBackend 里运行{' '}
          <code className="pl-code">python scripts/download_emotion_model.py</code>
          。不装也能用,只是对不上列表的表情不会切图。
        </span>
      )}
    </div>
  );
}

function SpriteSection({
  sprite,
  scene,
  cards,
  presetName,
  presetDirty,
  presetBusy,
  onSavePreset,
  card,
  notify,
  jev,
  switches,
}: Props) {
  const { config, onChangeConfig, block, packs } = sprite;
  const { sprites, packId } = packs;
  const macros = spriteMacros(config, enabledOnly(sprites));
  const pack = packs.packs.find((p) => p.id === packId) ?? null;
  const noPack = !card ? (
    <div className="sp-empty">先在右栏选一张角色卡。</div>
  ) : (
    <div className="sp-empty">这张卡还没有立绘包。在上面新建一个,或者挂一个已有的。</div>
  );

  return (
    <>
      <ModeBar
        name="立绘"
        kind="sprite"
        mode={config.mode}
        onChangeMode={(mode) => onChangeConfig({ ...config, mode })}
        jev={jev}
        aiNote="AI 按「立绘指令」块在角色的每句台词前写表情标签"
        jevNote="LLM 只写正文,每句台词是谁说的、什么表情由 Jev 判断后补上;「立绘指令 · 插件」块不发"
        power={powerOf(switches, 'sprite')}
      />

      <SpritePackBar card={card} packs={packs} notify={notify} />

      {config.mode === 'jev' ? (
        <>
          <JevCommon jev={jev} notify={notify} />
          <div className="sp-group">
            <div className="sp-group-head">
              <span className="sp-group-title">表情题</span>
              <span className="sp-group-note">
                问 Jev「这句说出口时她是什么表情」。选项是下面这个立绘包里的每张立绘,<b>说明会作为选项说明给 Jev 看</b>,
                写清楚表情是什么样的(比如「嘴角上扬,心情不错」),Jev 挑得越准。
              </span>
            </div>
            <PromptField
              label="问法"
              promptKey="emotion"
              value={config.jev.emotionPrompt}
              defaults={jev.defaults}
              placeholders={['n', 'line', 'char', 'user']}
              onChange={(v) => onChangeConfig({ ...config, jev: { ...config.jev, emotionPrompt: v } })}
            />
          </div>
        </>
      ) : (
        <>
          <BlockGroup
            what="立绘"
            block={block}
            presetName={presetName}
            presetDirty={presetDirty}
            presetBusy={presetBusy}
            onSavePreset={onSavePreset}
          />
          <ConfigGroups
            anchor="pl-prompt-sprite"
            config={config}
            onChangeConfig={onChangeConfig}
            validate={validateTemplate}
            tagNote="AI 用这个格式标出表情,视觉小说界面也按它来识别。{表情} 的位置写表情名。"
            sampleTag={(t) => `${t.replace('{表情}', sprites[0]?.label ?? '微笑')}「……」`}
            defaultPrompt={DEFAULT_BLOCK_PROMPT}
            promptNote={
              <>
                「立绘指令 · 插件」块的正文,所有预设共用,改完立即生效。{'{{sprites}}'} 会展开成当前角色卡正在用的立绘包的表情列表
                (没配立绘时是内置基础表情),{'{{sprite_tag}}'} 展开成标签示例,{'{{sprite_examples}}'} 展开成正误示范。
              </>
            }
            exampleMacro="sprite_tag"
            example={tagExample(config.tagTemplate)}
            previews={[
              { name: 'sprites', value: macros.sprites },
              { name: 'sprite_examples', value: macros.sprite_examples },
            ]}
          />

          <EmotionModelStatus />
        </>
      )}

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">位置{pack ? ` · ${pack.name}` : ''}</span>
          <span className="sp-group-note">
            所有角色按脸对齐:脸一样大、头在同一高度,换角色、换表情时人不会忽大忽小。上传立绘时自动找脸;
            不满意可以在画面上拖动、放大缩小(跟着立绘包走,包挂到别的卡上也带着),或者调所有角色共用的人物大小和头的高度。
          </span>
        </div>
        {card && packId ? (
          <SpritePosition
            key={packId}
            card={card}
            packName={pack?.name ?? ''}
            sprites={sprites}
            sceneAssets={scene.assets}
            cards={cards}
            state={sprite.layout}
          />
        ) : (
          noPack
        )}
      </div>

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">表情{pack ? ` · ${pack.name}` : ''}</span>
          <span className="sp-group-note">
            AI 写的表情名(或别名)对上哪一行,就换成那一行的图;对不上的由情绪识别模型挑最像的一行。排第一的是默认表情。
            几个包最好用同一套表情名,换包时按名字对上。不想用的点「禁用」:游戏里当它不存在,图和名字都留着,随时能再启用。
            {pack && pack.card_count > 1 && `这个包有 ${pack.card_count} 张卡在用,改动对它们都生效。`}
          </span>
        </div>
        {card && packId ? (
          <SpriteTable
            key={packId}
            packId={packId}
            sprites={sprites}
            packs={packs}
            notify={notify}
          />
        ) : (
          noPack
        )}
      </div>

      <WordRecordsGroup card={card} sprites={sprites} pack={pack} />
    </>
  );
}

/** 示例立绘包的名字:载入过就直接挂上,不再建一个 */
const SAMPLE_SPRITE_PACK = '示例 · Sylvie';

/** 这张卡的立绘包:挂着哪些、换哪个,以及挂 / 新建 / 改名 / 拿掉 / 删除 / 载入示例 */
function SpritePackBar({
  card,
  packs,
  notify,
}: {
  card: Props['card'];
  packs: SpritePackState;
  notify: Props['notify'];
}) {
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { packIds, packId, refreshPacks } = packs;
  const byId = new Map(packs.packs.map((p) => [p.id, p]));
  const pack = packId ? (byId.get(packId) ?? null) : null;
  const loose = packs.packs.filter((p) => !packIds.includes(p.id));

  // 包的立绘数、在用的卡数在别处也会变,进立绘页时刷新一次
  useEffect(() => {
    void refreshPacks();
  }, [refreshPacks]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify('error', errText(e));
    } finally {
      setBusy(null);
      await refreshPacks();
    }
  };

  /** 挂上一个包并换成它(插件页编辑的就是当前包) */
  const attach = (id: string) => packs.setPacks([...packIds, id], id);

  const submitName = () => {
    const name = draft.trim();
    if (!name) return;
    const mode = naming;
    setNaming(null);
    void act(mode === 'new' ? '新建' : '重命名', async () => {
      if (mode === 'new') {
        await attach((await debugApi.createSpritePack(name)).id);
      } else if (pack) {
        await debugApi.updateSpritePack(pack.id, { name });
      }
    });
  };

  const loadSample = () =>
    act('载入示例', async () => {
      const existing = packs.packs.find((p) => p.name === SAMPLE_SPRITE_PACK);
      if (existing) {
        if (packIds.includes(existing.id)) await packs.switchPack(existing.id);
        else await attach(existing.id);
        notify('ok', `「${SAMPLE_SPRITE_PACK}」已经有了,已换成它`);
        return;
      }
      const created = await debugApi.createSpritePack(
        SAMPLE_SPRITE_PACK,
        "Ren'Py 示例游戏里的 Sylvie,随仓库附带,可以先用来试效果",
      );
      for (const s of SAMPLE_SPRITES) {
        const res = await fetch(`/vn/sample-sprites/${s.file}`);
        if (!res.ok) throw new Error(`示例图 ${s.file} 下载失败`);
        const row = await debugApi.createSprite(created.id, {
          label: s.label,
          aliases: s.aliases,
          description: s.description,
        });
        await debugApi.uploadSpriteImage(created.id, row.id, await res.blob());
      }
      await attach(created.id);
      notify('ok', `已载入示例立绘包:${SAMPLE_SPRITES.length} 个表情`);
    });

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">立绘包{card ? ` · ${card.name || '(未命名)'}` : ''}</span>
        <span className="sp-group-note">
          一个包是一整套表情立绘。一张卡可以挂几个包,点一下就换(游戏里在菜单「角色」页换),换了以后这张卡所有对话、存档都用新的;
          同一个包也能挂在好几张卡上。下面的位置和表情改的是当前这个包。
        </span>
      </div>
      {!card ? (
        <div className="sp-empty">先在右栏选一张角色卡。</div>
      ) : (
        <>
          {packIds.length > 0 && (
            <div className="pl-row">
              {packIds.map((id) => {
                const p = byId.get(id);
                const on = id === packId;
                return (
                  <button
                    key={id}
                    className={`btn small${on ? ' accent' : ''}`}
                    aria-pressed={on}
                    disabled={!!busy}
                    onClick={() => {
                      if (!on) void act('换包', () => packs.switchPack(id));
                    }}
                    title={on ? '正在用的包' : '换成这个包'}
                  >
                    {p ? `${p.name} · ${p.sprite_count} 张` : '…'}
                  </button>
                );
              })}
            </div>
          )}
          <div className="pl-row">
            <select
              className="text-input pl-pack-select"
              value=""
              disabled={!!busy || loose.length === 0}
              onChange={(e) => {
                if (e.target.value) void act('挂上', () => attach(e.target.value));
              }}
            >
              <option value="">
                {loose.length ? '挂一个已有的立绘包…' : '没有别的立绘包了'}
              </option>
              {loose.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}({p.sprite_count} 张 · {p.card_count ? `${p.card_count} 张卡在用` : '没有卡在用'})
                </option>
              ))}
            </select>
            {busy && (
              <span className="sp-group-note">
                <span className="spinner tiny" /> {busy}…
              </span>
            )}
          </div>
          {naming ? (
            <div className="pl-row">
              <input
                className="text-input pl-pack-name"
                value={draft}
                autoFocus
                placeholder="立绘包名字,比如 夜莺"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitName();
                  if (e.key === 'Escape') setNaming(null);
                }}
              />
              <button className="btn small accent" disabled={!draft.trim()} onClick={submitName}>
                {naming === 'new' ? '新建并挂上' : '改名'}
              </button>
              <button className="btn small" onClick={() => setNaming(null)}>
                取消
              </button>
            </div>
          ) : (
            <div className="pl-row">
              <button
                className="btn small"
                disabled={!!busy}
                onClick={() => {
                  setDraft('');
                  setNaming('new');
                }}
              >
                + 新建立绘包
              </button>
              {pack && (
                <>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() => {
                      setDraft(pack.name);
                      setNaming('rename');
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    title="只是这张卡不再用它,包和里面的图都留着"
                    onClick={() =>
                      void act('拿掉', () => packs.setPacks(packIds.filter((id) => id !== pack.id)))
                    }
                  >
                    从这张卡拿掉
                  </button>
                </>
              )}
              <button
                className="btn small"
                disabled={!!busy}
                onClick={() => void loadSample()}
                title="Ren'Py 示例游戏里的角色 Sylvie,四个表情,可以先用来试效果"
              >
                载入示例立绘包
              </button>
              {pack && (
                <DeleteButton
                  disabled={!!busy}
                  label={pack.card_count > 1 ? `删除这个包(${pack.card_count} 张卡在用)` : '删除这个包'}
                  onConfirm={() =>
                    void act('删除', async () => {
                      await debugApi.deleteSpritePack(pack.id);
                      await packs.reload();
                      notify(
                        'ok',
                        pack.card_count > 1
                          ? `已删除「${pack.name}」,另外 ${pack.card_count - 1} 张卡也不再用它`
                          : `已删除「${pack.name}」`,
                      );
                    })
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SpriteTable({
  packId,
  sprites,
  packs,
  notify,
}: {
  packId: string;
  sprites: PackSprite[];
  packs: SpritePackState;
  notify: Props['notify'];
}) {
  const batchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const [busy, run] = useRunner(notify, async () => {
    packs.changeSprites(packId, await debugApi.listSprites(packId));
    await packs.refreshPacks();
  });

  /** 所有已被占用的名字(小写),新建时避开 */
  const takenNames = () =>
    new Set(sprites.flatMap((s) => [s.label, ...s.aliases]).map((n) => n.toLowerCase()));

  const addEmpty = () =>
    run('新建', async () => {
      await debugApi.createSprite(packId, { label: uniqueLabel('新表情', '表情', takenNames()) });
    });

  const batchUpload = (files: File[]) =>
    run(`上传 ${files.length} 张`, async () => {
      const taken = takenNames();
      for (const f of files) {
        const created = await debugApi.createSprite(packId, {
          label: uniqueLabel(labelFromFile(f.name), '表情', taken),
        });
        await debugApi.uploadSpriteImage(packId, created.id, f);
      }
      notify('ok', `已添加 ${files.length} 个表情,记得把名字改成 AI 好理解的词`);
    });

  const update = (spriteId: string, patch: { label?: string; aliases?: string[]; description?: string }) =>
    run('保存', async () => {
      await debugApi.updateSprite(packId, spriteId, patch);
    });

  const setEnabled = (spriteId: string, enabled: boolean) =>
    run(enabled ? '启用' : '禁用', async () => {
      await debugApi.updateSprite(packId, spriteId, { enabled });
    });

  const setEffect = (spriteId: string, effect: SpriteEffect | null) =>
    run('保存特效', async () => {
      await debugApi.updateSprite(packId, spriteId, { effect });
    });

  // 「试一下」:在这张的缩略图上跳一下、冒气泡、响一声(和视觉小说里同一套)
  const thumbs = useRef(new Map<string, HTMLButtonElement>());
  const [preview, setPreview] = useState<{ id: string; bubble: string | null; n: number } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const t = window.setTimeout(() => setPreview(null), 1500);
    return () => window.clearTimeout(t);
  }, [preview]);
  const playPreview = (spriteId: string, effect: SpriteEffect) => {
    playFxSound(effect.sound, 0.8);
    const motion = effect.motion ? MOTION_FRAMES[effect.motion] : undefined;
    const img = thumbs.current.get(spriteId)?.querySelector('img');
    if (motion && img) img.animate(motion.frames, motion.timing);
    setPreview({ id: spriteId, bubble: effect.bubble, n: (preview?.n ?? 0) + 1 });
  };

  /** 默认表情 = 排在最前面的、没禁用的那张 */
  const defaultId = sprites.find((s) => s.enabled)?.id ?? null;

  return (
    <div className="pl-sprites">
      <div className="pl-row">
        <button className="btn small" disabled={!!busy} onClick={addEmpty}>
          + 添加表情
        </button>
        <button className="btn small" disabled={!!busy} onClick={() => batchRef.current?.click()}>
          批量上传图片
        </button>
        {busy && (
          <span className="sp-group-note">
            <span className="spinner tiny" /> {busy}…
          </span>
        )}
      </div>

      <input
        ref={batchRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void batchUpload(files);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const target = replaceTarget.current;
          e.target.value = '';
          if (f && target) {
            void run('换图', async () => {
              await debugApi.uploadSpriteImage(packId, target, f);
            });
          }
        }}
      />

      {sprites.length === 0 ? (
        <div className="sp-empty">
          这个包里还没有表情。批量上传时文件名就是表情名(比如 微笑.png);没有素材的话先在上面载入示例立绘包试试。
        </div>
      ) : (
        <div className="pl-sprite-list">
          {sprites.map((s) => {
            const url = spriteImageUrl(s);
            return (
              <div key={s.id} className={`pl-sprite${s.enabled ? '' : ' off'}`}>
                <button
                  className="pl-thumb"
                  title={url ? '点击换图' : '点击上传图片'}
                  disabled={!!busy}
                  ref={(el) => {
                    if (el) thumbs.current.set(s.id, el);
                    else thumbs.current.delete(s.id);
                  }}
                  onClick={() => {
                    replaceTarget.current = s.id;
                    replaceRef.current?.click();
                  }}
                >
                  {url ? <img src={url} alt={s.label} /> : <span>上传</span>}
                  {preview?.id === s.id && preview.bubble && (
                    <SpriteBubble key={preview.n} kind={preview.bubble} style={THUMB_BUBBLE} />
                  )}
                </button>
                <LabelFields
                  noun="表情名"
                  item={s}
                  isDefault={s.id === defaultId}
                  descPlaceholder="给 AI 看的:什么时候用这个表情"
                  onCommit={(patch) => update(s.id, patch)}
                >
                  <SpriteFxFields
                    effect={s.effect}
                    disabled={!!busy}
                    onCommit={(fx) => void setEffect(s.id, fx)}
                    onPreview={(fx) => playPreview(s.id, fx)}
                  />
                </LabelFields>
                <div className="pl-actions">
                  <EnableButton
                    enabled={s.enabled}
                    disabled={!!busy}
                    onChange={(on) => void setEnabled(s.id, on)}
                  />
                  <button
                    className="btn small"
                    disabled={s.id === defaultId || !s.enabled || !!busy}
                    onClick={() =>
                      void run('排序', async () => {
                        await debugApi.reorderSprites(packId, [
                          s.id,
                          ...sprites.map((x) => x.id).filter((id) => id !== s.id),
                        ]);
                      })
                    }
                    title="挪到第一个 —— 回复里还没写标签时用它"
                  >
                    设为默认
                  </button>
                  <DeleteButton
                    disabled={!!busy}
                    onConfirm={() =>
                      void run('删除', async () => {
                        await debugApi.deleteSprite(packId, s.id);
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 缩略图上的气泡:右上角,缩略图宽的一半 */
const THUMB_BUBBLE = { right: 2, top: 2, width: 30, height: 30 } as const;

/** 禁用 / 启用:禁用的素材游戏里当作不存在,但留着,不用删 */
function EnableButton({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      className={`btn small${enabled ? '' : ' accent'}`}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      title={enabled ? '游戏里不再用它,素材留着,随时能再启用' : '重新在游戏里用它'}
    >
      {enabled ? '禁用' : '启用'}
    </button>
  );
}

/** 名字 / 别名 / 说明三格,立绘和场景素材共用 */
function LabelFields({
  noun,
  item,
  isDefault,
  descPlaceholder,
  onCommit,
  children,
}: {
  noun: string;
  item: { label: string; aliases: string[]; description: string; enabled: boolean };
  isDefault: boolean;
  descPlaceholder: string;
  onCommit: (patch: { label?: string; aliases?: string[]; description?: string }) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  return (
    <div className="pl-fields">
      <div className="pl-field-row">
        <CommitField label={noun} value={item.label} onCommit={(v) => onCommit({ label: v })} />
        {!item.enabled ? (
          <span className="pl-badge off" title="游戏里不用它">
            已禁用
          </span>
        ) : (
          isDefault && <span className="pl-badge">默认</span>
        )}
      </div>
      <CommitField
        label="别名"
        placeholder="用逗号分隔,比如 smile, 笑"
        value={item.aliases.join(', ')}
        onCommit={(v) =>
          onCommit({
            aliases: v
              .split(/[,，]/)
              .map((a) => a.trim())
              .filter(Boolean),
          })
        }
      />
      <CommitField
        label="说明"
        placeholder={descPlaceholder}
        value={item.description}
        onCommit={(v) => onCommit({ description: v })}
      />
      {children}
    </div>
  );
}

// ─────────────────────────── 背景 / BGM / CG ───────────────────────────

const SCENE_TEXT: Record<
  SceneKindKey,
  { what: string; tagNote: string; sample: string; macros: [string, string]; exampleMacro: string }
> = {
  bg: {
    what: '场景',
    tagNote: 'AI 换场景时用这个格式,视觉小说界面按它换背景。{场景} 的位置写场景名。',
    sample: '食堂',
    macros: ['backgrounds', 'current_bg'],
    exampleMacro: 'bg_tag',
  },
  bgm: {
    what: '音乐',
    tagNote: 'AI 在气氛转变时用这个格式换曲子。{音乐} 的位置写音乐名。',
    sample: '紧张',
    macros: ['bgms', 'current_bgm'],
    exampleMacro: 'bgm_tag',
  },
  cg: {
    what: 'CG',
    tagNote: `AI 进入 CG 对得上的场面、换姿势时用这个格式。{CG} 的位置写 CG 名,写「${CG_OFF_WORD}」收起 CG。`,
    // 示例的 CG 名:卡带可以给另一个(plugins/texts.ts)
    get sample() {
      return defaultText('cg.sample', '海边烟花');
    },
    macros: ['cgs', 'current_cg'],
    exampleMacro: 'cg_tag',
  },
};

const SCENE_NAME: Record<SceneKindKey, string> = { bg: '背景', bgm: 'BGM', cg: 'CG' };
const SCENE_AI_WHEN: Record<SceneKindKey, string> = {
  bg: '换场景',
  bgm: '气氛转变',
  cg: '进入 CG 场面、换姿势、场面结束',
};
const SCENE_JEV_WHAT: Record<SceneKindKey, string> = {
  bg: '场景换没换、换到哪',
  bgm: '气氛变没变、换哪首',
  cg: '每句画面上该是哪张 CG(或者不显示)',
};

function SceneSection({
  kind,
  scene,
  sceneBlocks,
  sceneMacros,
  presetName,
  presetDirty,
  presetBusy,
  onSavePreset,
  card,
  cards,
  notify,
  jev,
  sprite,
  switches,
}: Props & { kind: SceneKindKey }) {
  const text = SCENE_TEXT[kind];
  const config = scene.configs[kind];
  const [listMacro, currentMacro] = text.macros;
  const pack = scene.packs.find((p) => p.id === scene.packId) ?? null;
  // CG 页编辑的是这张卡绑的某个 CG 包(第 4 期):点上面的包名切换,默认排第一的
  const [cgEdit, setCgEdit] = useState<string | null>(null);
  const cgPackId =
    kind === 'cg' ? (cgEdit && scene.cgPackIds.includes(cgEdit) ? cgEdit : (scene.cgPackIds[0] ?? null)) : null;
  const cgPack = scene.cgPacks.find((p) => p.id === cgPackId) ?? null;
  const shared = kind === 'cg' ? cgPack : pack;

  const change = (next: ScenePluginConfig) => scene.changeConfig(kind, next);
  const changeJev = (patch: Partial<ScenePluginConfig['jev']>) =>
    change({ ...config, jev: { ...config.jev, ...patch } });
  const keep = jev.defaults?.keep ?? '不换';
  const off = jev.defaults?.cg_off ?? '不显示CG';

  return (
    <>
      <ModeBar
        name={SCENE_NAME[kind]}
        kind={kind}
        mode={config.mode}
        onChangeMode={(mode) => change({ ...config, mode })}
        jev={jev}
        aiNote={`AI 按「${SCENE[kind].blockName}」块在${SCENE_AI_WHEN[kind]}时写标签`}
        jevNote={`LLM 只写正文,${SCENE_JEV_WHAT[kind]}由 Jev 判断后补上;「${SCENE[kind].blockName}」块不发`}
        power={powerOf(switches, kind)}
      />

      {kind === 'cg' ? (
        <CgPackBar card={card} scene={scene} notify={notify} editing={cgPackId} onEdit={setCgEdit} />
      ) : (
        <PackBar card={card} scene={scene} notify={notify} />
      )}

      {config.mode === 'jev' && kind === 'cg' ? (
        <>
          <JevCommon jev={jev} notify={notify} />
          <div className="sp-group">
            <div className="sp-group-head">
              <span className="sp-group-title">出 CG / 换 CG / 收起</span>
              <span className="sp-group-note">
                每一句问 Jev 一道选择题:选项是「{keep}」「{off}」和场景包里的每张 CG(<b>说明会给 Jev 看</b>,先写{defaultText('cg.describeFirst', '场面')}和在做什么,
                地点、衣着放最后当参考)。Jev 还会看到现在的背景(名字和说明),只当参考。
                几张相似的 CG 把握加起来算:加起来够门槛就换成其中最高的那张;「{off}」的把握够门槛就收起。换场景不收 CG。
                {cgForms()?.jevNote ?? ''}画面上显示哪张差分跟着这句的表情走,不用 Jev 判。
              </span>
            </div>
            <ThresholdField
              label="门槛"
              value={config.jev.threshold}
              def={SWITCH_THRESHOLD.default}
              min={SWITCH_THRESHOLD.min}
              max={SWITCH_THRESHOLD.max}
              low="多换"
              high="少换"
              note="Jev 的把握到这么多才出 / 换 / 收起 CG。低:反应快,也容易出错图;高:换得稳,也会漏掉一些该出的"
              onChange={(v) => changeJev({ threshold: v })}
            />
            <PromptField
              label="CG 题"
              promptKey="cg"
              value={config.jev.prompt}
              defaults={jev.defaults}
              placeholders={['n', 'line', 'char', 'user']}
              onChange={(v) => changeJev({ prompt: v })}
              rows={5}
            />
            <PromptField
              label={`选项「${keep}」的说明`}
              promptKey="cg_keep"
              value={config.jev.keepPrompt}
              defaults={jev.defaults}
              placeholders={['current']}
              onChange={(v) => changeJev({ keepPrompt: v })}
              rows={2}
            />
            <PromptField
              label={`选项「${off}」的说明`}
              promptKey="cg_off"
              value={config.jev.offPrompt}
              defaults={jev.defaults}
              placeholders={['char', 'user']}
              onChange={(v) => changeJev({ offPrompt: v })}
              rows={2}
            />
          </div>
        </>
      ) : config.mode === 'jev' ? (
        <>
          <JevCommon jev={jev} notify={notify} />
          <div className="sp-group">
            <div className="sp-group-head">
              <span className="sp-group-title">{kind === 'bg' ? '换场景' : '换音乐'}</span>
              <span className="sp-group-note">
                每条回复的第一句和旁白问 Jev 一道选择题:选项是「{keep}」和场景包里的每个{text.what}
                (<b>说明会给 Jev 看</b>,{kind === 'bg' ? '写上地点和白天 / 夜晚' : '写清楚适合什么气氛'})。
                选了「{keep}」以外的、把握又够,就换。一条回复最多换一次{text.what}
                {kind === 'bgm' ? ';换背景时音乐自动换成那个背景的默认曲' : ''}。
              </span>
            </div>
            <ThresholdField
              label="门槛"
              value={config.jev.threshold}
              def={SWITCH_THRESHOLD.default}
              min={SWITCH_THRESHOLD.min}
              max={SWITCH_THRESHOLD.max}
              low="多换"
              high="少换"
              note={`Jev 的把握到这么多才换${text.what}。低:反应快,也容易换错;高:换得稳,也会漏掉一些该换的`}
              onChange={(v) => changeJev({ threshold: v })}
            />
            <PromptField
              label={kind === 'bg' ? '场景题' : '音乐题'}
              promptKey={kind}
              value={config.jev.prompt}
              defaults={jev.defaults}
              placeholders={['n', 'line', 'current', 'char', 'user']}
              onChange={(v) => changeJev({ prompt: v })}
            />
            <PromptField
              label={`选项「${keep}」的说明`}
              promptKey={`${kind}_keep`}
              value={config.jev.keepPrompt}
              defaults={jev.defaults}
              placeholders={['current', 'current_desc']}
              onChange={(v) => changeJev({ keepPrompt: v })}
              rows={2}
            />
          </div>
        </>
      ) : (
        <>
          <BlockGroup
            what={text.what}
            block={sceneBlocks[kind]}
            presetName={presetName}
            presetDirty={presetDirty}
            presetBusy={presetBusy}
            onSavePreset={onSavePreset}
          />
          <ConfigGroups
            anchor={`pl-prompt-${kind}`}
            config={config}
            onChangeConfig={change}
            validate={(t) => validateSceneTemplate(kind, t)}
            tagNote={text.tagNote}
            sampleTag={(t) => t.replace(SCENE[kind].placeholder, text.sample)}
            defaultPrompt={SCENE[kind].defaults.blockPrompt}
            promptNote={
              <>
                「{SCENE[kind].blockName}」块的正文,所有预设共用,改完立即生效。{`{{${listMacro}}}`} 展开成场景包里的{text.what}列表,
                {`{{${currentMacro}}}`} 展开成对话进行到现在的{text.what}
                {kind === 'cg' && <>,{'{{cg_off_tag}}'} 展开成收起 CG 的标签</>}。
              </>
            }
            exampleMacro={text.exampleMacro}
            example={sceneTagExample(kind, config.tagTemplate)}
            previews={[
              { name: listMacro, value: sceneMacros[listMacro] ?? '' },
              { name: currentMacro, value: sceneMacros[currentMacro] ?? '' },
            ]}
          />
        </>
      )}

      <div className="sp-group">
        <div className="sp-group-head">
          <span className="sp-group-title">
            {kind === 'bg' ? '背景' : kind === 'cg' ? 'CG' : '音乐'}
            {shared ? ` · ${shared.name}` : ''}
          </span>
          <span className="sp-group-note">
            {kind === 'bg'
              ? '排第一的是默认场景。每个场景可以指定一首默认音乐:换到这个场景时自动换上。'
              : kind === 'cg'
                ? `一张 CG = 一个构图(姿势、地点、衣着),AI / Jev 点的是它;名字和说明写清楚。每张 CG 可以挂几张差分,差分的名字用立绘的表情名(比如 ${defaultText('cg.variantExample', '害羞')}):游戏里跟着这句的表情换,没有对应的就用 CG 本身那张。CG 不换音乐,换场景也不会收起。${cgForms()?.help ?? ''}`
                : '按气氛起名(日常、温馨、紧张、伤感…),AI 看名字和说明挑曲子;真正的曲名写在说明里。'}
            不想用的点「禁用」:游戏里当它不存在,文件留在包里,随时能再启用。
            {shared && shared.card_count > 1 && `这个包有 ${shared.card_count} 张卡在用,禁用对它们都生效。`}
          </span>
        </div>
        {!card ? (
          <div className="sp-empty">先在右栏选一张角色卡。</div>
        ) : kind === 'cg' ? (
          cgPackId ? (
            <CgTable
              key={cgPackId}
              packId={cgPackId}
              scene={scene}
              emotions={enabledOnly(sprite.packs.sprites).map((x) => x.label)}
              notify={notify}
            />
          ) : (
            <div className="sp-empty">这张卡还没有 CG 包。在上面挂一个,或者新建一个。</div>
          )
        ) : !scene.packId ? (
          <div className="sp-empty">这张卡还没有绑定场景包。在上面选一个,或者新建一个。</div>
        ) : kind === 'bg' ? (
          <BgTable key={scene.packId} packId={scene.packId} scene={scene} notify={notify} />
        ) : (
          <BgmTable key={scene.packId} packId={scene.packId} scene={scene} notify={notify} />
        )}
      </div>

      {kind === 'cg' && card && (scene.cgPackIds.length > 0 || scene.packId) && (
        <CgPairingGroup
          card={card}
          sprites={enabledOnly(sprite.packs.sprites)}
          packName={currentPackName(sprite.packs)}
          assets={scene.assets}
          cards={cards}
        />
      )}
    </>
  );
}

/**
 * CG 包(第 4 期):这张卡挂了哪几个 CG 包(按顺序叠,构图重名时取排前面的)、下面编辑的是哪一个;
 * 挂上 / 拿掉 / 新建 / 重命名 / 删除。样子照立绘包那一条
 */
function CgPackBar({
  card,
  scene,
  notify,
  editing,
  onEdit,
}: {
  card: Props['card'];
  scene: ScenePluginState;
  notify: Props['notify'];
  editing: string | null;
  onEdit: (packId: string) => void;
}) {
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { cgPackIds, refreshCgPacks } = scene;
  const byId = new Map(scene.cgPacks.map((p) => [p.id, p]));
  const pack = editing ? (byId.get(editing) ?? null) : null;
  const loose = scene.cgPacks.filter((p) => !cgPackIds.includes(p.id));

  // 包的 CG 数、在用的卡数在别处也会变,进 CG 页时刷新一次
  useEffect(() => {
    void refreshCgPacks();
  }, [refreshCgPacks]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify('error', errText(e));
    } finally {
      setBusy(null);
      await refreshCgPacks();
    }
  };

  /** 挂上一个包(接在最后)并编辑它 */
  const attach = async (id: string) => {
    await scene.bindCgPacks([...cgPackIds, id]);
    onEdit(id);
  };

  const submitName = () => {
    const name = draft.trim();
    if (!name) return;
    const mode = naming;
    setNaming(null);
    void act(mode === 'new' ? '新建' : '重命名', async () => {
      if (mode === 'new') await attach((await debugApi.createCgPack(name)).id);
      else if (pack) await debugApi.updateCgPack(pack.id, { name });
    });
  };

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">CG 包{card ? ` · ${card.name || '(未命名)'}` : ''}</span>
        <span className="sp-group-note">
          一个 CG 包是一个角色在一个场景里的一组 CG,单独挂到卡上:谁挂了它,谁才会出这些 CG(借别人的场景当背景,不会连她的 CG
          一起借来)。一张卡可以挂几个,按顺序叠,几个包里有同名的 CG 时用排前面的。点包名切换下面编辑的是哪一个。
        </span>
      </div>
      {!card ? (
        <div className="sp-empty">先在右栏选一张角色卡。</div>
      ) : (
        <>
          {cgPackIds.length > 0 && (
            <div className="pl-row">
              {cgPackIds.map((id) => {
                const p = byId.get(id);
                const on = id === editing;
                return (
                  <button
                    key={id}
                    className={`btn small${on ? ' accent' : ''}`}
                    aria-pressed={on}
                    disabled={!!busy}
                    onClick={() => onEdit(id)}
                    title={on ? '下面编辑的是这个包' : '编辑这个包'}
                  >
                    {p ? `${p.name} · ${p.cg_count} 张` : '…'}
                  </button>
                );
              })}
            </div>
          )}
          <div className="pl-row">
            <select
              className="text-input pl-pack-select"
              value=""
              disabled={!!busy || loose.length === 0}
              onChange={(e) => {
                if (e.target.value) void act('挂上', () => attach(e.target.value));
              }}
            >
              <option value="">{loose.length ? '挂一个已有的 CG 包…' : '没有别的 CG 包了'}</option>
              {loose.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}({p.cg_count} 张 · {p.card_count ? `${p.card_count} 张卡在用` : '没有卡在用'})
                </option>
              ))}
            </select>
            {busy && (
              <span className="sp-group-note">
                <span className="spinner tiny" /> {busy}…
              </span>
            )}
          </div>
          {naming ? (
            <div className="pl-row">
              <input
                className="text-input pl-pack-name"
                value={draft}
                autoFocus
                placeholder="CG 包名字,比如 同居日常 · CG"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitName();
                  if (e.key === 'Escape') setNaming(null);
                }}
              />
              <button className="btn small accent" disabled={!draft.trim()} onClick={submitName}>
                {naming === 'new' ? '新建并挂上' : '改名'}
              </button>
              <button className="btn small" onClick={() => setNaming(null)}>
                取消
              </button>
            </div>
          ) : (
            <div className="pl-row">
              <button
                className="btn small"
                disabled={!!busy}
                onClick={() => {
                  setDraft('');
                  setNaming('new');
                }}
              >
                + 新建 CG 包
              </button>
              {pack && (
                <>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() => {
                      setDraft(pack.name);
                      setNaming('rename');
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    title="只是这张卡不再用它,包和里面的 CG 都留着"
                    onClick={() => void act('拿掉', () => scene.bindCgPacks(cgPackIds.filter((id) => id !== pack.id)))}
                  >
                    从这张卡拿掉
                  </button>
                  <DeleteButton
                    disabled={!!busy}
                    label={pack.card_count > 1 ? `删除这个包(${pack.card_count} 张卡在用)` : '删除这个包'}
                    onConfirm={() =>
                      void act('删除', async () => {
                        await debugApi.deleteCgPack(pack.id);
                        scene.forgetCgPack(pack.id);
                        notify(
                          'ok',
                          pack.card_count > 1
                            ? `已删除「${pack.name}」,另外 ${pack.card_count - 1} 张卡也不再用它`
                            : `已删除「${pack.name}」`,
                        );
                      })
                    }
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 场景包选择器:这张卡用哪个包,以及新建 / 重命名 / 删除 / 载入示例 */
function PackBar({
  card,
  scene,
  notify,
}: {
  card: Props['card'];
  scene: ScenePluginState;
  notify: Props['notify'];
}) {
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const pack = scene.packs.find((p) => p.id === scene.packId) ?? null;

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify('error', errText(e));
    } finally {
      setBusy(null);
      await scene.refreshPacks();
    }
  };

  const submitName = () => {
    const name = draft.trim();
    if (!name) return;
    const mode = naming;
    setNaming(null);
    void act(mode === 'new' ? '新建' : '重命名', async () => {
      if (mode === 'new') {
        const created = await debugApi.createScenePack(name);
        if (card) await scene.bindPack(created.id);
      } else if (pack) {
        await debugApi.updateScenePack(pack.id, { name });
      }
    });
  };

  const loadSample = () =>
    act('载入示例', async () => {
      const existing = scene.packs.find((p) => p.name === SAMPLE_PACK.name);
      if (existing) {
        await scene.bindPack(existing.id);
        notify('ok', `「${SAMPLE_PACK.name}」已经有了,已绑定到这张卡`);
        return;
      }
      const created = await debugApi.createScenePack(SAMPLE_PACK.name, SAMPLE_PACK.description);
      const bgmIds = new Map<string, string>();
      for (const m of SAMPLE_PACK.bgms) {
        const res = await fetch(`/vn/${m.file}`);
        if (!res.ok) throw new Error(`示例音乐 ${m.file} 下载失败`);
        const a = await debugApi.createSceneAsset(created.id, {
          kind: 'bgm',
          label: m.label,
          aliases: m.aliases,
          description: m.description,
        });
        await debugApi.uploadSceneFile(created.id, a.id, await res.blob());
        bgmIds.set(m.label, a.id);
      }
      for (const b of SAMPLE_PACK.bgs) {
        const res = await fetch(`/vn/${b.file}`);
        if (!res.ok) throw new Error(`示例背景 ${b.file} 下载失败`);
        const a = await debugApi.createSceneAsset(created.id, {
          kind: 'bg',
          label: b.label,
          aliases: b.aliases,
          description: b.description,
        });
        await debugApi.uploadSceneFile(created.id, a.id, await res.blob());
        await debugApi.updateSceneAsset(created.id, a.id, {
          bgm_id: bgmIds.get(b.bgm) ?? null,
          focus_x: b.focus,
        });
      }
      if (card) await scene.bindPack(created.id);
      notify('ok', `已载入示例场景包:${SAMPLE_PACK.bgs.length} 个场景、${SAMPLE_PACK.bgms.length} 首音乐`);
    });

  return (
    <div className="sp-group">
      <div className="sp-group-head">
        <span className="sp-group-title">场景包{card ? ` · ${card.name || '(未命名)'}` : ''}</span>
        <span className="sp-group-note">
          一组背景 + 音乐。每张卡绑一个包,同一个世界观的几张卡可以绑同一个;背景、BGM 两页共用。CG 在 CG 页单独挂 CG 包。
        </span>
      </div>
      {!card ? (
        <div className="sp-empty">先在右栏选一张角色卡。</div>
      ) : (
        <>
          <div className="pl-row">
            <select
              className="text-input pl-pack-select"
              value={scene.packId ?? ''}
              disabled={!!busy}
              onChange={(e) => void act('绑定', () => scene.bindPack(e.target.value || null))}
            >
              <option value="">不使用场景包</option>
              {scene.packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}({p.bg_count} 个场景 · {p.bgm_count} 首音乐
                  {p.cg_count && !p.cg_pack_id ? ` · ${p.cg_count} 张 CG` : ''})
                </option>
              ))}
            </select>
            {busy && (
              <span className="sp-group-note">
                <span className="spinner tiny" /> {busy}…
              </span>
            )}
          </div>
          {naming ? (
            <div className="pl-row">
              <input
                className="text-input pl-pack-name"
                value={draft}
                autoFocus
                placeholder="场景包名字,比如 罗德岛"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitName();
                  if (e.key === 'Escape') setNaming(null);
                }}
              />
              <button className="btn small accent" disabled={!draft.trim()} onClick={submitName}>
                {naming === 'new' ? '新建并绑定' : '改名'}
              </button>
              <button className="btn small" onClick={() => setNaming(null)}>
                取消
              </button>
            </div>
          ) : (
            <div className="pl-row">
              <button
                className="btn small"
                disabled={!!busy}
                onClick={() => {
                  setDraft('');
                  setNaming('new');
                }}
              >
                + 新建场景包
              </button>
              {pack && (
                <button
                  className="btn small"
                  disabled={!!busy}
                  onClick={() => {
                    setDraft(pack.name);
                    setNaming('rename');
                  }}
                >
                  重命名
                </button>
              )}
              <button
                className="btn small"
                disabled={!!busy}
                onClick={() => void loadSample()}
                title="随仓库附带的免费授权背景和音乐,可以先用来试效果"
              >
                载入示例场景包
              </button>
              {pack && (
                <DeleteButton
                  disabled={!!busy}
                  label="删除这个包"
                  onConfirm={() =>
                    void act('删除', async () => {
                      await debugApi.deleteScenePack(pack.id);
                      scene.forgetPack(pack.id);
                      notify(
                        'ok',
                        pack.card_count > 1
                          ? `已删除「${pack.name}」,另外 ${pack.card_count - 1} 张卡也一起解绑了`
                          : `已删除「${pack.name}」`,
                      );
                    })
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 背景表、音乐表、CG 表共用的增删改(CG 只管构图,差分见 CgVariants) */
/** 场景包和 CG 包(第 4 期)的素材各走各的接口,参数一样;CG 包不分类别 */
interface AssetApi {
  list: (packId: string) => Promise<SceneAsset[]>;
  create: (
    packId: string,
    payload: { kind: SceneKind; label: string; aliases?: string[]; description?: string; parent_id?: string },
  ) => Promise<SceneAsset>;
  update: (packId: string, assetId: string, patch: SceneAssetPatch) => Promise<SceneAsset>;
  remove: (packId: string, assetId: string) => Promise<void>;
  reorder: (packId: string, kind: SceneKind, ids: string[]) => Promise<SceneAsset[]>;
  upload: (packId: string, assetId: string, file: Blob) => Promise<SceneAsset>;
}

const SCENE_ASSET_API: AssetApi = {
  list: debugApi.listSceneAssets,
  create: debugApi.createSceneAsset,
  update: debugApi.updateSceneAsset,
  remove: debugApi.deleteSceneAsset,
  reorder: debugApi.reorderSceneAssets,
  upload: debugApi.uploadSceneFile,
};

const CG_ASSET_API: AssetApi = {
  list: debugApi.listCgAssets,
  create: (packId, { kind: _kind, ...payload }) => debugApi.createCgAsset(packId, payload),
  update: debugApi.updateCgAsset,
  remove: debugApi.deleteCgAsset,
  reorder: (packId, _kind, ids) => debugApi.reorderCgAssets(packId, ids),
  upload: debugApi.uploadCgFile,
};

/** CG 在 CG 包里(packId 是 CG 包),背景、音乐在场景包里 */
const assetApi = (kind: SceneKind) => (kind === 'cg' ? CG_ASSET_API : SCENE_ASSET_API);

function useAssetOps(packId: string, kind: SceneKind, scene: ScenePluginState, notify: Props['notify']) {
  const api = assetApi(kind);
  const [busy, run] = useRunner(notify, async () => {
    scene.changeAssets(packId, await api.list(packId));
    await (kind === 'cg' ? scene.refreshCgPacks() : scene.refreshPacks());
  });
  const mine = scene.assets.filter((a) => a.kind === kind && !a.parent_id && a.pack_id === packId);
  const takenNames = () =>
    new Set(mine.flatMap((a) => [a.label, ...a.aliases]).map((n) => n.toLowerCase()));
  const fallback = kind === 'bg' ? '场景' : kind === 'cg' ? 'CG' : '音乐';

  return {
    busy,
    run,
    mine,
    addEmpty: () =>
      run('新建', async () => {
        await api.create(packId, {
          kind,
          label: uniqueLabel(kind === 'bg' ? '新场景' : kind === 'cg' ? '新CG' : '新音乐', fallback, takenNames()),
        });
      }),
    batchUpload: (files: File[]) =>
      run(`上传 ${files.length} 个文件`, async () => {
        const taken = takenNames();
        for (const f of files) {
          const created = await api.create(packId, {
            kind,
            label: uniqueLabel(labelFromFile(f.name), fallback, taken),
          });
          await api.upload(packId, created.id, f);
        }
        notify('ok', `已添加 ${files.length} 个${fallback},记得把名字改成 AI 好理解的词`);
      }),
    replaceFile: (assetId: string, file: File) =>
      run('换文件', async () => {
        await api.upload(packId, assetId, file);
      }),
    update: (assetId: string, patch: SceneAssetPatch) =>
      run('保存', async () => {
        await api.update(packId, assetId, patch);
      }),
    remove: (assetId: string) =>
      run('删除', async () => {
        await api.remove(packId, assetId);
      }),
    setEnabled: (assetId: string, enabled: boolean) =>
      run(enabled ? '启用' : '禁用', async () => {
        await api.update(packId, assetId, { enabled });
      }),
    /** 默认 = 排在最前面的、没禁用的那个 */
    defaultId: mine.find((a) => a.enabled)?.id ?? null,
    makeDefault: (assetId: string) =>
      run('排序', async () => {
        await api.reorder(packId, kind, [assetId, ...mine.map((a) => a.id).filter((id) => id !== assetId)]);
      }),
  };
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac';

function BgTable({
  packId,
  scene,
  notify,
}: {
  packId: string;
  scene: ScenePluginState;
  notify: Props['notify'];
}) {
  const ops = useAssetOps(packId, 'bg', scene, notify);
  const { busy } = ops;
  const bgms = bgmsOf(scene.assets);
  const batchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  return (
    <div className="pl-sprites">
      <div className="pl-row">
        <button className="btn small" disabled={!!busy} onClick={() => void ops.addEmpty()}>
          + 添加场景
        </button>
        <button className="btn small" disabled={!!busy} onClick={() => batchRef.current?.click()}>
          批量上传图片
        </button>
        {busy && (
          <span className="sp-group-note">
            <span className="spinner tiny" /> {busy}…
          </span>
        )}
      </div>
      <input
        ref={batchRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void ops.batchUpload(files);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && replaceTarget.current) void ops.replaceFile(replaceTarget.current, f);
        }}
      />

      {ops.mine.length === 0 ? (
        <div className="sp-empty">
          还没有场景。批量上传时文件名就是场景名(比如 食堂.jpg);横图(16:9)效果最好。
        </div>
      ) : (
        <div className="pl-sprite-list">
          {backgroundsOf(ops.mine).map((a) => {
            const url = sceneFileUrl(a);
            return (
              <div key={a.id} className={`pl-sprite pl-scene bg${a.enabled ? '' : ' off'}`}>
                <button
                  className="pl-thumb pl-thumb-wide"
                  title={url ? '点击换图' : '点击上传图片'}
                  disabled={!!busy}
                  onClick={() => {
                    replaceTarget.current = a.id;
                    replaceRef.current?.click();
                  }}
                >
                  {url ? <img src={url} alt={a.label} /> : <span>上传</span>}
                </button>
                <LabelFields
                  noun="场景名"
                  item={a}
                  isDefault={a.id === ops.defaultId}
                  descPlaceholder="给 AI 看的:这是什么地方"
                  onCommit={(patch) => ops.update(a.id, patch)}
                >
                  <label className="pl-field">
                    <span className="conn-label">默认音乐</span>
                    <select
                      className="text-input"
                      value={a.bgm_id ?? ''}
                      disabled={!!busy}
                      onChange={(e) => void ops.update(a.id, { bgm_id: e.target.value || null })}
                    >
                      <option value="">不换(沿用之前的音乐)</option>
                      {bgms.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.enabled ? m.label : `${m.label}(已禁用,游戏里不放)`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {url && (
                    <FocusSlider
                      url={url}
                      value={a.focus_x}
                      onCommit={(v) => void ops.update(a.id, { focus_x: v })}
                    />
                  )}
                </LabelFields>
                <div className="pl-actions">
                  <EnableButton
                    enabled={a.enabled}
                    disabled={!!busy}
                    onChange={(on) => void ops.setEnabled(a.id, on)}
                  />
                  <button
                    className="btn small"
                    disabled={a.id === ops.defaultId || !a.enabled || !!busy}
                    onClick={() => void ops.makeDefault(a.id)}
                    title="挪到第一个 —— 对话里还没写场景标签时用它"
                  >
                    设为默认
                  </button>
                  <DeleteButton disabled={!!busy} onConfirm={() => void ops.remove(a.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CgTable({
  packId,
  scene,
  emotions,
  notify,
}: {
  packId: string;
  scene: ScenePluginState;
  /** 立绘包里的表情名:差分用它们起名 */
  emotions: string[];
  notify: Props['notify'];
}) {
  const ops = useAssetOps(packId, 'cg', scene, notify);
  const { busy } = ops;
  // 形态(plugins/forms.ts):装了形态卡带,而且立绘包看起来用得上、或者已经有 CG 标过,才出「在哪些形态出」
  const forms = cgForms();
  const FormsEditor = forms?.Editor ?? null;
  const showForms =
    forms !== null && (forms.relevant(emotions) || ops.mine.some((a) => (a.forms ?? []).length > 0));
  const batchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  return (
    <div className="pl-sprites">
      <div className="pl-row">
        <button className="btn small" disabled={!!busy} onClick={() => void ops.addEmpty()}>
          + 添加 CG
        </button>
        <button className="btn small" disabled={!!busy} onClick={() => batchRef.current?.click()}>
          批量上传图片
        </button>
        {busy && (
          <span className="sp-group-note">
            <span className="spinner tiny" /> {busy}…
          </span>
        )}
      </div>
      <input
        ref={batchRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void ops.batchUpload(files);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && replaceTarget.current) void ops.replaceFile(replaceTarget.current, f);
        }}
      />

      {ops.mine.length === 0 ? (
        <div className="sp-empty">
          还没有 CG。批量上传时文件名就是 CG 名;横图(16:9)效果最好。上传后把名字和说明改成 AI 看得懂的:先写{defaultText('cg.describeFirst', '场面')}和在做什么,地点、衣着放最后当参考。
        </div>
      ) : (
        <div className="pl-sprite-list">
          {cgsOf(ops.mine).map((a) => {
            const url = sceneThumbUrl(a, 480);
            return (
              <div key={a.id} className={`pl-sprite pl-scene bg${a.enabled ? '' : ' off'}`}>
                <button
                  className="pl-thumb pl-thumb-wide"
                  title={url ? '点击换图' : '点击上传图片'}
                  disabled={!!busy}
                  onClick={() => {
                    replaceTarget.current = a.id;
                    replaceRef.current?.click();
                  }}
                >
                  {url ? <img src={url} alt={a.label} /> : <span>上传</span>}
                </button>
                <LabelFields
                  noun="CG 名"
                  item={a}
                  isDefault={false}
                  descPlaceholder={defaultText('cg.descPlaceholder', '给 AI / Jev 看的:场面|在做什么|不算|场景参考')}
                  onCommit={(patch) => ops.update(a.id, patch)}
                >
                  {showForms && FormsEditor && (
                    <FormsEditor
                      forms={a.forms ?? []}
                      disabled={!!busy}
                      onChange={(forms) => void ops.update(a.id, { forms })}
                    />
                  )}
                  {url && (
                    <FocusSlider
                      url={url}
                      value={a.focus_x}
                      onCommit={(v) => void ops.update(a.id, { focus_x: v })}
                    />
                  )}
                  <CgVariants
                    packId={packId}
                    cg={a}
                    scene={scene}
                    emotions={emotions}
                    busy={busy}
                    run={ops.run}
                  />
                </LabelFields>
                <div className="pl-actions">
                  <EnableButton
                    enabled={a.enabled}
                    disabled={!!busy}
                    onChange={(on) => void ops.setEnabled(a.id, on)}
                  />
                  <DeleteButton disabled={!!busy} onConfirm={() => void ops.remove(a.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 一张 CG 的差分:每张一个表情名,游戏里这句的表情是它就显示它 */
function CgVariants({
  packId,
  cg,
  scene,
  emotions,
  busy,
  run,
}: {
  packId: string;
  cg: { id: string; label: string };
  scene: ScenePluginState;
  emotions: string[];
  busy: string | null;
  run: (label: string, fn: () => Promise<void>) => Promise<boolean>;
}) {
  const variants = cgVariantsOf(scene.assets, cg.id);
  const used = new Set(variants.map((v) => v.label));
  const free = emotions.filter((e) => !used.has(e));
  const [pick, setPick] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const label = pick && free.includes(pick) ? pick : (free[0] ?? '');

  return (
    <div className="pl-field">
      <span className="conn-label">差分</span>
      <div className="pl-cg-variants">
        {variants.map((v) => {
          const url = sceneThumbUrl(v, 240);
          return (
            <div key={v.id} className="pl-cg-variant">
              <button
                className="pl-thumb pl-thumb-wide"
                title="点击换图"
                disabled={!!busy}
                onClick={() => {
                  replaceTarget.current = v.id;
                  replaceRef.current?.click();
                }}
              >
                {url ? <img src={url} alt={v.label} /> : <span>上传</span>}
              </button>
              <span className="pl-cg-variant-name" title={emotions.includes(v.label) ? v.label : '立绘包里没有这个表情名'}>
                {emotions.includes(v.label) ? v.label : `${v.label}(?)`}
              </span>
              <DeleteButton
                disabled={!!busy}
                onConfirm={() =>
                  void run('删除差分', async () => {
                    await CG_ASSET_API.remove(packId, v.id);
                  })
                }
              />
            </div>
          );
        })}
      </div>
      <div className="pl-row">
        <select
          className="text-input"
          value={label}
          disabled={!!busy || free.length === 0}
          onChange={(e) => setPick(e.target.value)}
          aria-label="差分对应的表情"
        >
          {free.length === 0 && <option value="">立绘包里的表情都有差分了</option>}
          {free.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          disabled={!!busy || !label}
          onClick={() => fileRef.current?.click()}
          title="选一张图,作为这个表情时显示的差分"
        >
          + 上传这个表情的差分
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !label) return;
          void run('上传差分', async () => {
            const created = await CG_ASSET_API.create(packId, { kind: 'cg', label, parent_id: cg.id });
            await CG_ASSET_API.upload(packId, created.id, f);
          });
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          const target = replaceTarget.current;
          if (f && target)
            void run('换图', async () => {
              await CG_ASSET_API.upload(packId, target, f);
            });
        }}
      />
    </div>
  );
}

/** 竖屏焦点:手机竖着玩时只看得到横图的一窄条,拖滑条决定对准哪儿,旁边是竖屏裁切的预览 */
function FocusSlider({
  url,
  value,
  onCommit,
}: {
  url: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const timer = useRef<number | undefined>(undefined);
  // 还没存的那一下:拖完半秒内就关了抽屉,卸载时补存,不能丢
  const pending = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );

  return (
    <div className="pl-field">
      <span className="conn-label">竖屏焦点</span>
      <div className="pl-focus">
        <div className="pl-focus-preview" title="竖屏时看到的部分">
          <img src={url} alt="" style={{ objectPosition: `${draft}% 50%` }} />
        </div>
        <input
          className="sp-slider"
          type="range"
          min={0}
          max={100}
          value={draft}
          aria-label="竖屏焦点"
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft(v);
            // 拖动时只改预览,停手半秒再存
            window.clearTimeout(timer.current);
            pending.current = () => {
              pending.current = null;
              onCommit(v);
            };
            timer.current = window.setTimeout(() => pending.current?.(), 500);
          }}
        />
        <span className="sp-slider-value">{draft < 34 ? '偏左' : draft > 66 ? '偏右' : '居中'}</span>
      </div>
    </div>
  );
}

function BgmTable({
  packId,
  scene,
  notify,
}: {
  packId: string;
  scene: ScenePluginState;
  notify: Props['notify'];
}) {
  const ops = useAssetOps(packId, 'bgm', scene, notify);
  const { busy } = ops;
  const bgm = useBgm();
  const batchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  // 关抽屉(或者离开菜单的插件页)时把试听停掉,还原成之前在放的
  useEffect(() => () => bgmPlayer.stopPreview(), []);

  const toggle = (url: string) => {
    if (bgm.preview === url) bgmPlayer.stopPreview();
    else bgmPlayer.startPreview(url);
  };

  // 哪些场景把这首当默认曲 —— 删之前心里有数
  const usedBy = (id: string) =>
    backgroundsOf(scene.assets)
      .filter((b) => b.bgm_id === id)
      .map((b) => b.label);

  return (
    <div className="pl-sprites">
      <div className="pl-row">
        <button className="btn small" disabled={!!busy} onClick={() => void ops.addEmpty()}>
          + 添加音乐
        </button>
        <button className="btn small" disabled={!!busy} onClick={() => batchRef.current?.click()}>
          批量上传音频
        </button>
        {busy && (
          <span className="sp-group-note">
            <span className="spinner tiny" /> {busy}…
          </span>
        )}
      </div>
      <input
        ref={batchRef}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void ops.batchUpload(files);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && replaceTarget.current) void ops.replaceFile(replaceTarget.current, f);
        }}
      />

      {ops.mine.length === 0 ? (
        <div className="sp-empty">
          还没有音乐。批量上传时文件名就是音乐名(比如 日常.mp3);建议用 MP3,iPhone 放不了 OGG。
        </div>
      ) : (
        <div className="pl-sprite-list">
          {ops.mine.map((a) => {
            const url = sceneFileUrl(a);
            const on = url !== null && bgm.preview === url;
            const used = usedBy(a.id);
            return (
              <div key={a.id} className={`pl-sprite pl-scene${a.enabled ? '' : ' off'}`}>
                <button
                  className={`pl-thumb pl-play${on ? ' on' : ''}`}
                  title={url ? (on ? '停止试听' : '试听') : '还没传文件'}
                  disabled={!url}
                  onClick={() => url && toggle(url)}
                  aria-label={on ? '停止试听' : '试听'}
                >
                  <span>{on ? '■' : '▶'}</span>
                </button>
                <LabelFields
                  noun="音乐名"
                  item={a}
                  isDefault={false}
                  descPlaceholder="给 AI 看的:什么气氛用它(曲名也可以写这里)"
                  onCommit={(patch) => ops.update(a.id, patch)}
                >
                  <div className="sp-group-note">
                    {a.has_file
                      ? `${a.mime ?? ''} · ${formatSize(a.size)}${a.mime === 'audio/ogg' ? ' · iPhone 可能放不了 OGG' : ''}`
                      : '还没传文件'}
                    {used.length > 0 && ` · 默认曲:${used.join('、')}`}
                    {on && bgm.error && <span className="pl-error"> · {bgm.error}</span>}
                  </div>
                </LabelFields>
                <div className="pl-actions">
                  <EnableButton
                    enabled={a.enabled}
                    disabled={!!busy}
                    onChange={(on) => void ops.setEnabled(a.id, on)}
                  />
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() => {
                      replaceTarget.current = a.id;
                      replaceRef.current?.click();
                    }}
                  >
                    {a.has_file ? '换文件' : '上传文件'}
                  </button>
                  <DeleteButton disabled={!!busy} onConfirm={() => void ops.remove(a.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
