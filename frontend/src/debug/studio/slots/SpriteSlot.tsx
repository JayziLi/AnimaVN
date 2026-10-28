/**
 * 卡编辑器「素材」页的立绘栏:顶上一行是「用哪套」的下拉框(库里全部的立绘包列在一起,选了整个替换掉原来的)
 * + 「上传新建」+「⋯」,下面是这一套的编辑器(SpritePackEditor)。
 *
 * 10-27 用户定「不做绑定了」:一张卡只用一套立绘,不挂几套、不分「设为当前服装」。选的时候写
 * setPacks([id], id)(插件页「立绘包」下拉用的是同一个写法);卡里原来存着的别的包随这次替换拿掉。
 * 包里的内容由编辑器自己读写、经 PackSync 同步进游戏。
 * 预览:背景 = 这张卡的第一张背景(右上角能换,只是看看);台词 = 开场白第一句,说话人 = 卡名。
 */

import { useCallback, useRef, useState } from 'react';
import { debugApi, sceneImageUrl, type PackSprite, type SceneAsset } from '../../lib/api';
import type { TavernCard } from '../../lib/cardParser';
import type { SpriteStage } from '../../plugins/spriteLayout';
import type { SpritePackState } from '../../plugins/useSpritePacks';
import { greetingLine } from '../cardInfo';
import { Icon } from '../icons';
import { BackgroundChip } from '../preview/BackgroundChip';
import { SPRITE_ACCEPT, SpritePackEditor } from '../editors/SpritePackEditor';
import type { Notify, PackSync } from '../types';
import { Btn, Inspector, MoreMenu, PackSwap, PromptDialog, TypeLabel } from '../ui';
import { packExportItem } from '../../components/export/packExport';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 还没选立绘时右栏的说明 */
const INTRO =
  '立绘是角色说话时站在画面上的那张图,一套(一身服装)里有好几张表情差分,AI 按台词的情绪换。' +
  '一张卡只用一套,在顶上的下拉框里选;选了就整个换掉原来的。';

type Dialog = { kind: 'create'; files: File[] } | { kind: 'rename'; id: string } | null;

export interface SpriteSlotProps {
  card: Pick<TavernCard, 'name' | 'first_mes'>;
  /** 台词里的 {{user}} */
  userName: string;
  /** 立绘包的状态(useSpritePacks):全部包、这张卡用的、当前那套,和整组改的操作 */
  sprite: Pick<SpritePackState, 'packs' | 'packIds' | 'packId' | 'setPacks' | 'ready'>;
  /** 所有角色共用的构图(useSpriteLayout 的 stage) */
  stage: SpriteStage;
  /** 这张卡的背景(按游戏里的顺序,第一张是默认);预览从里面挑 */
  backgrounds: readonly SceneAsset[];
  sync: PackSync;
  notify: Notify;
}

export function SpriteSlot({ card, userName, sprite, stage, backgrounds, sync, notify }: SpriteSlotProps) {
  const { packs, packIds, packId: currentId } = sprite;
  const byId = new Map(packs.map((p) => [p.id, p]));
  const cardName = card.name.trim() || '(无名)';

  // 用的是哪套:游戏里当前那套(以前存着几套的卡,多出来的在下次换的时候拿掉)
  const shown = currentId ?? packIds[0] ?? null;

  // 预览背景:点过的那张,没点过 / 不在了就第一张
  const usable = backgrounds.filter((b) => b.has_file);
  const [bgId, setBgId] = useState<string | null>(null);
  const bg = usable.find((b) => b.id === bgId) ?? usable[0] ?? null;
  const bgSrc = bg ? sceneImageUrl(bg) : null;

  // 编辑器改完会报上来每套现在几张(下拉框右边的灰字);没报过的用包列表里的数
  const [counts, setCounts] = useState<Record<string, number>>({});
  const onSprites = useCallback((pid: string, list: PackSprite[]) => {
    setCounts((n) => ({ ...n, [pid]: list.length }));
  }, []);

  // ---- 换一套 / 新建 ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<{ packId: string; nonce: number; files: File[] } | null>(null);

  /** 选了一套:整个替换(同时就是当前服装) */
  const replace = async (id: string | null) => {
    if (!id) return;
    await sprite.setPacks([id], id);
  };

  const create = async (name: string, files: File[]) => {
    setDialog(null);
    try {
      const pack = await debugApi.createSpritePack(name);
      await sprite.setPacks([pack.id], pack.id);
      // 编辑器开起来以后自己传(网格里一张张出进度)
      setIncoming({ packId: pack.id, nonce: Date.now(), files });
    } catch (e) {
      notify('error', `新建立绘失败: ${errText(e)}`);
    }
  };

  const rename = async (id: string, name: string) => {
    setDialog(null);
    try {
      await debugApi.updateSpritePack(id, { name });
      sync.packs('sprite');
    } catch (e) {
      notify('error', `改名失败: ${errText(e)}`);
    }
  };

  const swap = (
    <PackSwap
      ariaLabel={`「${cardName}」的立绘`}
      options={packs.map((p) => ({ id: p.id, name: p.name, sub: `${counts[p.id] ?? p.sprite_count} 张` }))}
      value={shown}
      onPick={(id) => void replace(id)}
    >
      <Btn icon="upload" small onClick={() => createInput.current?.click()}>
        上传新建
      </Btn>
    </PackSwap>
  );

  const dialogs = (
    <>
      <input
        ref={createInput}
        type="file"
        accept={SPRITE_ACCEPT}
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
          title="新建一套立绘"
          label={`名字(${dialog.files.length} 张图,文件名就是差分名)`}
          initial={`${cardName} · 新服装`}
          confirmLabel="新建并上传"
          onSubmit={(name) => void create(name, dialog.files)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="重命名服装"
          label="名字"
          initial={byId.get(dialog.id)?.name ?? ''}
          confirmLabel="改名"
          onSubmit={(name) => void rename(dialog.id, name)}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );

  // ---- 还没选立绘 ----
  if (!shown) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot="sprite" />
            {swap}
          </div>
          {sprite.ready ? (
            <div className="st-empty">
              <span className="st-empty-icon">
                <Icon name="person" size={26} />
              </span>
              <span className="st-empty-title">还没有立绘</span>
              <span className="st-empty-note">从上面的下拉框选一套,或者上传图片新建一套</span>
            </div>
          ) : (
            <div className="st-empty">
              <span className="st-empty-note">读取中…</span>
            </div>
          )}
        </main>
        <Inspector label="立绘">
          <p className="st-inspector-hint">{INTRO}</p>
        </Inspector>
        {dialogs}
      </>
    );
  }

  const current = byId.get(shown);

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot="sprite" />
      {swap}
      <span className="st-flex" />
      <MoreMenu
        label="更多:重命名、导出这个包"
        items={[
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', id: shown }) },
          packExportItem('sprite', shown, notify),
        ]}
      />
    </div>
  );

  return (
    <>
      <SpritePackEditor
        key={shown}
        packId={shown}
        header={header}
        stage={stage}
        previewBackground={bg && bgSrc ? { src: bgSrc, focus: bg.focus_x } : null}
        previewBadges={bg ? <BackgroundChip backgrounds={usable} value={bg} onChange={setBgId} /> : null}
        previewLine={{ speaker: cardName, text: greetingLine(card, userName) }}
        cardCount={current?.card_count}
        sync={sync}
        notify={notify}
        incoming={incoming?.packId === shown ? incoming : null}
        onIncomingTaken={() => setIncoming(null)}
        onSprites={onSprites}
      />
      {dialogs}
    </>
  );
}
