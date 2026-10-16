/**
 * 素材管理页中间 + 右栏:选中的那个包交给卡编辑器里同一套包编辑器(studio/editors),只是不带卡 ——
 * 卡相关的东西在这里换成不依赖卡的:
 *   立绘   预览背景 = 绑着这套的第一张卡的第一张背景(能换成那张卡别的背景);都没有用立绘位置编辑器那张兜底背景。
 *          台词空着,对话框写选中差分的描述;说话人是那张卡的名字,没有卡就是包名
 *   背景   默认 BGM 只能选这个包自己的曲子(外加说明:游戏里只放卡的「BGM」那一栏绑了的)
 *   BGM    封面曲记在场景包上,改完通知 DebugApp 刷新场景包列表(标题画面跟着换)
 *   CG     不对照差分(没有卡)
 *   声音   不对照差分
 * 编辑器按包换 key:换一个包就是新的编辑器。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { debugApi, sceneImageUrl, type SceneAsset } from '../lib/api';
import type { SpriteStage } from '../plugins/spriteLayout';
import { BackgroundChip } from '../studio/preview/BackgroundChip';
import { BackgroundPackEditor } from '../studio/editors/BackgroundPackEditor';
import { BgmPackEditor } from '../studio/editors/BgmPackEditor';
import { CgPackEditor } from '../studio/editors/CgPackEditor';
import { SpritePackEditor } from '../studio/editors/SpritePackEditor';
import { VoiceEditor } from '../studio/editors/VoiceEditor';
import type { BgmChoice } from '../studio/editors/sceneEdit';
import type { Notify, PackSync } from '../studio/types';
import { POSITION_EDITOR_BACKGROUND } from '../vn/fallbacks';
import { backgroundsOfCard, forgetScenePacks, scenePacksOnce } from './libraryApi';
import type { LibraryItem, LibraryKind } from './libraryModel';
import '../studio/editors/voiceEditor.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface LibraryEditorProps {
  kind: LibraryKind;
  item: LibraryItem;
  /** 主区顶上那一行(LibraryHeader) */
  header: ReactNode;
  /** 绑着它的第一张卡的名字(立绘预览的说话人);没有是 null */
  firstCardName: string | null;
  stage: SpriteStage;
  sync: PackSync;
  notify: Notify;
  /** 包里的东西改过了(张数、大小、封面可能变了):外面过一会儿重读列表 */
  onEdited: () => void;
}

export function LibraryEditor(props: LibraryEditorProps) {
  const { kind, item, header, sync, notify, onEdited } = props;
  const cardCount = item.card_ids.length;
  if (kind === 'sprite') {
    return <SpriteEditor key={item.id} {...props} />;
  }
  if (kind === 'bg') {
    return <BackgroundEditor key={item.id} {...props} />;
  }
  if (kind === 'bgm') {
    return <BgmEditor key={item.id} {...props} />;
  }
  if (kind === 'cg') {
    return (
      <CgPackEditor
        key={item.id}
        packId={item.id}
        header={header}
        cardCount={cardCount}
        sync={sync}
        notify={notify}
        onAssets={onEdited}
      />
    );
  }
  return (
    <VoiceEditor
      voiceId={item.id}
      header={header}
      spriteLabels={null}
      onChanged={() => {
        // 游戏里这个声音已经合成好的句子作废重念(useVoicePlugin 比较前后的设置)
        sync.packs('voice');
        onEdited();
      }}
      notify={notify}
    />
  );
}

// ---------------------------------------------------------------- 立绘

function SpriteEditor({ item, header, firstCardName, stage, sync, notify, onEdited }: LibraryEditorProps) {
  const firstCard = item.card_ids[0] ?? null;
  const [backgrounds, setBackgrounds] = useState<{ cardId: string; list: SceneAsset[] } | null>(null);
  useEffect(() => {
    if (!firstCard) return;
    let alive = true;
    backgroundsOfCard(firstCard)
      .then((list) => alive && setBackgrounds({ cardId: firstCard, list }))
      .catch(() => alive && setBackgrounds({ cardId: firstCard, list: [] }));
    return () => {
      alive = false;
    };
  }, [firstCard]);
  const usable = backgrounds?.cardId === firstCard ? backgrounds.list : [];
  const [bgId, setBgId] = useState<string | null>(null);
  const bg = usable.find((b) => b.id === bgId) ?? usable[0] ?? null;
  const src = bg ? sceneImageUrl(bg) : null;

  return (
    <SpritePackEditor
      packId={item.id}
      header={header}
      stage={stage}
      previewBackground={bg && src ? { src, focus: bg.focus_x } : { src: POSITION_EDITOR_BACKGROUND, focus: 50 }}
      previewBadges={bg ? <BackgroundChip backgrounds={usable} value={bg} onChange={setBgId} /> : null}
      previewLine={{ speaker: firstCardName ?? item.name, text: '' }}
      cardCount={item.card_ids.length}
      sync={sync}
      notify={notify}
      onSprites={onEdited}
    />
  );
}

// ---------------------------------------------------------------- 背景

const BG_NOTE = '能选这个包自己的曲子。游戏里只放卡「BGM」那一栏绑了的曲子:那张卡没绑这首,切到这张背景时不换曲子';
const BG_NOTE_EMPTY = '这个包里没有曲子,只能选「不换」;要用别的包里的曲子,到卡编辑器的背景栏里选';

function BackgroundEditor({ item, header, sync, notify, onEdited }: LibraryEditorProps) {
  // 默认 BGM 能选的 = 这个包自己的曲子:编辑器自己也读一遍包,但一开始不报出来,这里另读一次,之后跟着它报的改
  const [list, setList] = useState<SceneAsset[] | null>(null);
  useEffect(() => {
    let alive = true;
    debugApi
      .listSceneAssets(item.id)
      .then((all) => alive && setList(all))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [item.id]);
  const choices = useMemo<BgmChoice[]>(
    () => (list ?? []).filter((a) => a.kind === 'bgm').map((asset) => ({ asset, packName: item.name })),
    [list, item.name],
  );
  return (
    <BackgroundPackEditor
      packId={item.id}
      header={header}
      bgmChoices={choices}
      bgmNote={choices.length === 0 ? BG_NOTE_EMPTY : BG_NOTE}
      cardCount={item.card_ids.length}
      sync={sync}
      notify={notify}
      onAssets={(_pid, next) => {
        setList(next);
        onEdited();
      }}
    />
  );
}

// ---------------------------------------------------------------- BGM

function BgmEditor({ item, header, sync, notify, onEdited }: LibraryEditorProps) {
  const [titleBgmId, setTitleBgmId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    scenePacksOnce()
      .then((ps) => alive && setTitleBgmId(ps.find((p) => p.id === item.id)?.title_bgm_id ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item.id]);

  const changeTitle = async (id: string | null) => {
    const before = titleBgmId;
    setTitleBgmId(id);
    try {
      const saved = await debugApi.updateScenePack(item.id, { title_bgm_id: id });
      setTitleBgmId(saved.title_bgm_id);
      forgetScenePacks();
      // 是哪张卡 BGM 栏排第一的包,标题画面跟着换
      sync.packs('scene');
    } catch (e) {
      setTitleBgmId(before);
      notify('error', `封面曲保存失败: ${errText(e)}`);
    }
  };

  return (
    <BgmPackEditor
      packId={item.id}
      packName={item.name}
      header={header}
      titleBgmId={titleBgmId}
      onTitleBgm={(id) => void changeTitle(id)}
      cardCount={item.card_ids.length}
      sync={sync}
      notify={notify}
      onAssets={onEdited}
    />
  );
}
