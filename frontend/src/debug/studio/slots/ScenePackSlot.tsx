/**
 * 背景栏、BGM 栏共用的外壳:顶上一排这张卡这一边绑的场景包页签 +「＋」从素材库挑 / 上传新建 +「⋯」(重命名、解除绑定),
 * 下面是选中那个包的编辑器(外面给:BackgroundPackEditor / BgmPackEditor)。没绑包时主区是空状态。
 *
 * 场景包不拆:背景和 BGM 分开绑靠绑定行上的 parts(useScenePlugin 的 binding.bg / binding.bgm)。
 * 一个包可能两栏都有;在这一栏「＋」只绑这一边,「解除绑定」也只拿掉这一边(bindScene 读回来的为准)。
 */

import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';
import { debugApi, sceneThumbUrl, type SceneAsset } from '../../lib/api';
import type { ScenePluginState } from '../../plugins/useScenePlugin';
import { bindSide, sideCount, unbindSide, type SceneSide } from '../editors/sceneEdit';
import { SCENE_ACCEPT } from '../editors/useSceneAssets';
import { Icon, type IconName } from '../icons';
import { PackPicker } from '../PackPicker';
import type { Notify, PackSync } from '../types';
import { Btn, ConfirmDialog, Inspector, MoreMenu, PackTabs, PromptDialog, TypeLabel } from '../ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 两栏要用的那几样(useScenePlugin) */
export type SceneSlotState = Pick<
  ScenePluginState,
  'packs' | 'binding' | 'bindScene' | 'sceneLists' | 'ready' | 'setTitleBgmOf'
>;

/** 交给编辑器的:哪个包、顶上那一行、几张卡在用、刚建好要传的文件 */
export interface SceneEditorContext {
  packId: string;
  packName: string;
  header: ReactNode;
  cardCount: number | undefined;
  incoming: { nonce: number; files: File[] } | null;
  onIncomingTaken: () => void;
}

interface SideText {
  icon: IconName;
  /** 「张背景」「首曲子」 */
  unit: string;
  pickerTitle: string;
  addLabel: string;
  tabsLabel: string;
  createLabel: string;
  /** 新建对话框的标题 */
  newTitle: string;
  emptyTitle: string;
  emptyNote: string;
  /** 新建一套时名字的默认值 */
  newName: (card: string) => string;
  /** 新建对话框里「名字」下面的说明 */
  newNote: (n: number) => string;
  /** 解除绑定的说明 */
  unbindNote: string;
  /** 另一边的名字 */
  other: string;
  intro: string;
}

const TEXT: Record<SceneSide, SideText> = {
  bg: {
    icon: 'scene',
    unit: '张背景',
    pickerTitle: '添加背景',
    addLabel: '添加背景(从素材库选,或上传图片新建一套)',
    tabsLabel: '这张卡绑定的背景',
    createLabel: '上传图片新建一套',
    newTitle: '新建一套背景',
    emptyTitle: '还没有背景',
    emptyNote: '从素材库选,或者上传图片新建一套',
    newName: (card) => `${card} · 背景`,
    newNote: (n) => `名字(${n} 张图,文件名就是背景名)`,
    unbindNote: '只是这张卡不再用它的背景,包和里面的图都留着,素材库里还能找到。',
    other: 'BGM',
    intro:
      '背景是对话时角色身后的场景,AI 按剧情换。一张卡可以挂几套背景(场景包),排在最前面那套的第一张是开场背景。' +
      '每张背景可以设一首默认 BGM,切过来时自动换上。',
  },
  bgm: {
    icon: 'music',
    unit: '首曲子',
    pickerTitle: '添加 BGM',
    addLabel: '添加 BGM(从素材库选,或上传曲子新建一套)',
    tabsLabel: '这张卡绑定的 BGM',
    createLabel: '上传曲子新建一套',
    newTitle: '新建一套 BGM',
    emptyTitle: '还没有 BGM',
    emptyNote: '从素材库选,或者上传曲子新建一套',
    newName: (card) => `${card} · BGM`,
    newNote: (n) => `名字(${n} 首,文件名就是曲名)`,
    unbindNote: '只是这张卡不再用它的曲子,包和里面的曲子都留着,素材库里还能找到。',
    other: '背景',
    intro:
      'BGM 是对话时放的背景音乐,AI 按气氛换,切背景时也会换成那张背景的默认 BGM。一张卡可以挂几套曲子(场景包);' +
      '排在最前面那套的封面曲在标题画面放。',
  },
};

/** 背景包的小缩略图:第一张(没停用、有图的)背景 */
function coverOf(list: readonly SceneAsset[] | undefined): string | null {
  const bgs = (list ?? []).filter((a) => a.kind === 'bg' && a.has_file);
  const a = bgs.find((x) => x.enabled) ?? bgs[0];
  return a ? sceneThumbUrl(a, 96) : null;
}

type Dialog =
  | { kind: 'picker' }
  | { kind: 'create'; files: File[] }
  | { kind: 'rename'; id: string }
  | { kind: 'unbind'; id: string }
  | null;

export interface ScenePackSlotProps {
  side: SceneSide;
  cardName: string;
  scene: SceneSlotState;
  sync: PackSync;
  notify: Notify;
  /** 选中那个包的编辑器(主区 + 右栏) */
  renderEditor: (ctx: SceneEditorContext) => ReactNode;
}

export function ScenePackSlot({ side, cardName, scene, sync, notify, renderEditor }: ScenePackSlotProps) {
  const t = TEXT[side];
  const { packs, binding, sceneLists } = scene;
  const ids = binding[side];
  const other = side === 'bg' ? binding.bgm : binding.bg;
  const byId = new Map(packs.map((p) => [p.id, p]));

  // 看的是哪个包:点过的页签;它被解除了就回到第一个
  const [pick, setPick] = useState<string | null>(null);
  const shown = pick && ids.includes(pick) ? pick : (ids[0] ?? null);

  // ---- 「从素材库选」里背景包的小缩略图:绑着的用手上的列表,别的打开时读一次 ----
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  const loadCovers = useCallback((pids: readonly string[]) => {
    for (const id of pids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      debugApi
        .listSceneAssets(id)
        .then((list) => setCovers((c) => ({ ...c, [id]: coverOf(list) })))
        .catch(() => setCovers((c) => ({ ...c, [id]: null })));
    }
  }, []);
  const thumbOf = (id: string) => (sceneLists[id] ? coverOf(sceneLists[id]) : (covers[id] ?? null));
  const media = (id: string) => {
    if (side !== 'bg') return undefined;
    const src = thumbOf(id);
    return src ? <img className="st-picker-thumb" src={src} alt="" draggable={false} /> : undefined;
  };

  // ---- 绑定 ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<{ packId: string; nonce: number; files: File[] } | null>(null);

  const openPicker = () => {
    // 张数、在用的卡数在别处也会变
    sync.packs('scene');
    if (side === 'bg') loadCovers(packs.filter((p) => !sceneLists[p.id] && p.bg_count > 0).map((p) => p.id));
    setDialog({ kind: 'picker' });
  };
  const pickNewFiles = () => createInput.current?.click();

  /** 只绑这一边(接在后面),页签切过去 */
  const bind = async (id: string) => {
    setDialog(null);
    await scene.bindScene(bindSide(binding, side, id));
    setPick(id);
  };

  const create = async (name: string, files: File[]) => {
    setDialog(null);
    try {
      const pack = await debugApi.createScenePack(name);
      await scene.bindScene(bindSide(binding, side, pack.id));
      setPick(pack.id);
      // 编辑器开起来以后自己传(一个个出进度)
      setIncoming({ packId: pack.id, nonce: Date.now(), files });
    } catch (e) {
      notify('error', `新建失败: ${errText(e)}`);
    }
  };

  const rename = async (id: string, name: string) => {
    setDialog(null);
    try {
      await debugApi.updateScenePack(id, { name });
      sync.packs('scene');
    } catch (e) {
      notify('error', `改名失败: ${errText(e)}`);
    }
  };

  const unbind = async (id: string) => {
    setDialog(null);
    await scene.bindScene(unbindSide(binding, side, id));
    setPick(null);
  };

  const dialogs = (
    <>
      <input
        ref={createInput}
        type="file"
        accept={SCENE_ACCEPT[side]}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) setDialog({ kind: 'create', files });
        }}
      />
      {dialog?.kind === 'picker' && (
        <PackPicker
          title={t.pickerTitle}
          packs={packs.map((p) => ({
            id: p.id,
            name: p.name,
            count: `${side === 'bg' ? p.bg_count : p.bgm_count} ${t.unit}`,
            cardCount: p.card_count,
            media: media(p.id),
          }))}
          cardName={cardName}
          boundIds={ids}
          icon={t.icon}
          onPick={(id) => void bind(id)}
          createLabel={t.createLabel}
          onCreate={() => {
            setDialog(null);
            pickNewFiles();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'create' && (
        <PromptDialog
          title={t.newTitle}
          label={t.newNote(dialog.files.length)}
          initial={t.newName(cardName)}
          confirmLabel="新建并上传"
          onSubmit={(name) => void create(name, dialog.files)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="重命名"
          label={other.includes(dialog.id) ? '名字(「背景」「BGM」两栏用的是同一个包,两边一起改)' : '名字'}
          initial={byId.get(dialog.id)?.name ?? ''}
          confirmLabel="改名"
          onSubmit={(name) => void rename(dialog.id, name)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'unbind' &&
        (() => {
          const name = byId.get(dialog.id)?.name ?? '这个包';
          const rest = ids.filter((x) => x !== dialog.id);
          const first = ids[0] === dialog.id;
          const nextName = rest[0] ? (byId.get(rest[0])?.name ?? '下一个包') : null;
          const effect =
            rest.length === 0
              ? `解除后这张卡就没有${side === 'bg' ? '背景' : ' BGM '}了。`
              : first
                ? side === 'bg'
                  ? `它排在最前面,解除后开场背景换成「${nextName}」里排第一的那张。`
                  : `它排在最前面,解除后标题画面的封面曲换成「${nextName}」的。`
                : null;
          return (
            <ConfirmDialog
              title={`从${side === 'bg' ? '背景' : ' BGM '}栏拿掉「${name}」?`}
              body={
                <>
                  <p className="st-dialog-p">{t.unbindNote}</p>
                  {other.includes(dialog.id) && (
                    <p className="st-dialog-p">「{t.other}」那一栏还用着这个包,不受影响。</p>
                  )}
                  {effect && <p className="st-dialog-p">{effect}</p>}
                </>
              }
              confirmLabel="解除绑定"
              onConfirm={() => void unbind(dialog.id)}
              onCancel={() => setDialog(null)}
            />
          );
        })()}
    </>
  );

  // ---- 还没绑 ----
  if (!shown) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot={side} />
          </div>
          {scene.ready ? (
            <div className="st-empty">
              <span className="st-empty-icon">
                <Icon name={t.icon} size={26} />
              </span>
              <span className="st-empty-title">{t.emptyTitle}</span>
              <span className="st-empty-note">{t.emptyNote}</span>
              <div className="st-empty-actions">
                <Btn icon="search" onClick={openPicker}>
                  从素材库选
                </Btn>
                <Btn icon="upload" onClick={pickNewFiles}>
                  {t.createLabel}
                </Btn>
              </div>
            </div>
          ) : (
            <div className="st-empty">
              <span className="st-empty-note">读取中…</span>
            </div>
          )}
        </main>
        <Inspector label={side === 'bg' ? '背景' : 'BGM'}>
          <p className="st-inspector-hint">{t.intro}</p>
        </Inspector>
        {dialogs}
      </>
    );
  }

  const tabs = ids.map((id) => {
    const p = byId.get(id);
    return {
      id,
      name: p?.name ?? '…',
      sub: `${sideCount(side, sceneLists[id], p)} ${t.unit}`,
      selected: id === shown,
      thumb: side === 'bg' ? thumbOf(id) : null,
      icon: t.icon,
    };
  });
  const alsoOther = other.includes(shown);

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot={side} />
      <PackTabs items={tabs} onSelect={setPick} onAdd={openPicker} addLabel={t.addLabel} label={t.tabsLabel} />
      <span className="st-flex" />
      <MoreMenu
        label="更多:重命名、解除绑定"
        items={[
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', id: shown }) },
          {
            label: alsoOther ? `解除绑定(只从${side === 'bg' ? '背景' : ' BGM '}拿掉)` : '解除绑定',
            onClick: () => setDialog({ kind: 'unbind', id: shown }),
          },
        ]}
      />
    </div>
  );

  return (
    <>
      <Fragment key={shown}>
        {renderEditor({
          packId: shown,
          packName: byId.get(shown)?.name ?? '…',
          header,
          cardCount: byId.get(shown)?.card_count,
          incoming: incoming?.packId === shown ? incoming : null,
          onIncomingTaken: () => setIncoming(null),
        })}
      </Fragment>
      {dialogs}
    </>
  );
}
