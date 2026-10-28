/**
 * 背景栏、BGM 栏共用的外壳:顶上一行是这一边「用哪个场景包」的下拉框(库里全部的包列在一起,选了整个替换掉原来的)
 * + 「上传新建」+「⋯」(重命名、导出),下面是这个包的编辑器(外面给:BackgroundPackEditor / BgmPackEditor)。没选包时主区是空状态。
 *
 * 10-27 用户定「不做绑定了」:背景、BGM 各只用一个包,不挂几个。场景包不拆:背景和 BGM 分开选靠绑定行上的
 * parts(useScenePlugin 的 binding.bg / binding.bgm),在这一栏选只换这一边,另一边不动(插件页的下拉也是这个写法)。
 * 卡里原来存着的这一边别的包随这次替换拿掉。
 */

import { Fragment, useRef, useState, type ReactNode } from 'react';
import { debugApi } from '../../lib/api';
import type { ScenePluginState } from '../../plugins/useScenePlugin';
import { replaceSide, sideCount, type SceneSide } from '../editors/sceneEdit';
import { SCENE_ACCEPT } from '../editors/useSceneAssets';
import { Icon, type IconName } from '../icons';
import type { Notify, PackSync } from '../types';
import { Btn, Inspector, MoreMenu, PackSwap, PromptDialog, TypeLabel } from '../ui';
import { packExportItem } from '../../components/export/packExport';

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
  ariaLabel: string;
  createLabel: string;
  /** 新建对话框的标题 */
  newTitle: string;
  emptyTitle: string;
  emptyNote: string;
  /** 新建一套时名字的默认值 */
  newName: (card: string) => string;
  /** 新建对话框里「名字」下面的说明 */
  newNote: (n: number) => string;
  intro: string;
}

const TEXT: Record<SceneSide, SideText> = {
  bg: {
    icon: 'scene',
    unit: '张背景',
    ariaLabel: '背景',
    createLabel: '上传新建',
    newTitle: '新建一套背景',
    emptyTitle: '还没有背景',
    emptyNote: '从上面的下拉框选一套,或者上传图片新建一套',
    newName: (card) => `${card} · 背景`,
    newNote: (n) => `名字(${n} 张图,文件名就是背景名)`,
    intro:
      '背景是对话时角色身后的场景,AI 按剧情换。一张卡只用一套背景(场景包),在顶上的下拉框里选;选了就整个换掉原来的,包里第一张是开场背景。' +
      '每张背景可以设一首默认 BGM,切过来时自动换上。',
  },
  bgm: {
    icon: 'music',
    unit: '首曲子',
    ariaLabel: 'BGM',
    createLabel: '上传新建',
    newTitle: '新建一套 BGM',
    emptyTitle: '还没有 BGM',
    emptyNote: '从上面的下拉框选一套,或者上传曲子新建一套',
    newName: (card) => `${card} · BGM`,
    newNote: (n) => `名字(${n} 首,文件名就是曲名)`,
    intro:
      'BGM 是对话时放的背景音乐,AI 按气氛换,切背景时也会换成那张背景的默认 BGM。一张卡只用一套曲子(场景包),在顶上的下拉框里选;选了就整个换掉原来的,' +
      '它的封面曲在标题画面放。',
  },
};

type Dialog = { kind: 'create'; files: File[] } | { kind: 'rename'; id: string } | null;

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
  const name = cardName.trim() || '(无名)';

  // 用的是哪个包:这一边排第一的(以前存着几个的卡,多出来的在下次换的时候拿掉)
  const shown = ids[0] ?? null;

  // ---- 换一个 / 新建 ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<{ packId: string; nonce: number; files: File[] } | null>(null);

  /** 选了一个包:只换这一边,整个替换 */
  const replace = async (id: string | null) => {
    if (!id) return;
    await scene.bindScene(replaceSide(binding, side, id));
  };

  const create = async (packName: string, files: File[]) => {
    setDialog(null);
    try {
      const pack = await debugApi.createScenePack(packName);
      await scene.bindScene(replaceSide(binding, side, pack.id));
      // 编辑器开起来以后自己传(一个个出进度)
      setIncoming({ packId: pack.id, nonce: Date.now(), files });
    } catch (e) {
      notify('error', `新建失败: ${errText(e)}`);
    }
  };

  const rename = async (id: string, next: string) => {
    setDialog(null);
    try {
      await debugApi.updateScenePack(id, { name: next });
      sync.packs('scene');
    } catch (e) {
      notify('error', `改名失败: ${errText(e)}`);
    }
  };

  const swap = (
    <PackSwap
      ariaLabel={`「${name}」的${t.ariaLabel}`}
      options={packs.map((p) => ({
        id: p.id,
        name: p.name,
        sub: `${sideCount(side, sceneLists[p.id], p)} ${t.unit}`,
      }))}
      value={shown}
      onPick={(id) => void replace(id)}
    >
      <Btn icon="upload" small onClick={() => createInput.current?.click()}>
        {t.createLabel}
      </Btn>
    </PackSwap>
  );

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
      {dialog?.kind === 'create' && (
        <PromptDialog
          title={t.newTitle}
          label={t.newNote(dialog.files.length)}
          initial={t.newName(name)}
          confirmLabel="新建并上传"
          onSubmit={(v) => void create(v, dialog.files)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="重命名"
          label={other.includes(dialog.id) ? '名字(「背景」「BGM」两栏用的是同一个包,两边一起改)' : '名字'}
          initial={byId.get(dialog.id)?.name ?? ''}
          confirmLabel="改名"
          onSubmit={(v) => void rename(dialog.id, v)}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );

  // ---- 还没选 ----
  if (!shown) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot={side} />
            {swap}
          </div>
          {scene.ready ? (
            <div className="st-empty">
              <span className="st-empty-icon">
                <Icon name={t.icon} size={26} />
              </span>
              <span className="st-empty-title">{t.emptyTitle}</span>
              <span className="st-empty-note">{t.emptyNote}</span>
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

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot={side} />
      {swap}
      <span className="st-flex" />
      <MoreMenu
        label="更多:重命名、导出这个包"
        items={[
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', id: shown }) },
          packExportItem(side, shown, notify),
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
