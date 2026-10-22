/**
 * 卡编辑器「素材」页的立绘栏:顶上一排这张卡挂的服装(立绘包)页签 +「＋」从素材库挑 / 上传新建 +「⋯」,
 * 下面是选中那套的编辑器(SpritePackEditor)。看哪套就编辑哪套;「设为当前服装」才改游戏里用哪套。
 *
 * 绑定走 useSpritePacks(setPacks / switchPack);包里的内容由编辑器自己读写、经 PackSync 同步进游戏。
 * 预览:背景 = 这张卡的第一张背景(右上角能换,只是看看);台词 = 开场白第一句,说话人 = 卡名。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { debugApi, sceneImageUrl, type PackSprite, type SceneAsset } from '../../lib/api';
import type { TavernCard } from '../../lib/cardParser';
import { facesByCanvas, type FaceBox, type SpriteStage } from '../../plugins/spriteLayout';
import type { SpritePackState } from '../../plugins/useSpritePacks';
import { greetingLine } from '../cardInfo';
import { FaceThumb } from '../FaceThumb';
import { Icon } from '../icons';
import { PackPicker } from '../PackPicker';
import { BackgroundChip } from '../preview/BackgroundChip';
import { SPRITE_ACCEPT, SpritePackEditor } from '../editors/SpritePackEditor';
import type { Notify, PackSync } from '../types';
import { Btn, ConfirmDialog, Inspector, MoreMenu, PackTabs, PromptDialog, TypeLabel } from '../ui';
import { packExportItem } from '../../components/export/packExport';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 还没挂立绘时右栏的说明 */
const INTRO =
  '立绘是角色说话时站在画面上的那张图,一套(一身服装)里有好几张表情差分,AI 按台词的情绪换。' +
  '一张卡可以挂几套,在游戏菜单的「角色」页随时换。';

/** 包页签、「从素材库选」里的小头像:这套的第一张(没停用、有图的)差分 */
interface Cover {
  sprite: PackSprite;
  face: FaceBox | null;
}

function coverOf(list: readonly PackSprite[]): Cover | null {
  const s = list.find((x) => x.enabled && x.has_image) ?? list.find((x) => x.has_image);
  return s ? { sprite: s, face: facesByCanvas(list).get(s.id) ?? null } : null;
}

const coverThumb = (cover: Cover | null | undefined) => <FaceThumb sprite={cover?.sprite ?? null} face={cover?.face ?? null} />;

type Dialog =
  | { kind: 'picker' }
  | { kind: 'create'; files: File[] }
  | { kind: 'rename'; id: string }
  | { kind: 'unbind'; id: string }
  | null;

export interface SpriteSlotProps {
  card: Pick<TavernCard, 'name' | 'first_mes'>;
  /** 台词里的 {{user}} */
  userName: string;
  /** 立绘包的状态(useSpritePacks):全部包、这张卡挂的、当前那套,和改绑定的两个操作 */
  sprite: Pick<SpritePackState, 'packs' | 'packIds' | 'packId' | 'setPacks' | 'switchPack' | 'ready'>;
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

  // 看的是哪套:点过的页签;它被解除了就回到当前服装
  const [pick, setPick] = useState<string | null>(null);
  const shown = pick && packIds.includes(pick) ? pick : (currentId ?? packIds[0] ?? null);

  // 预览背景:点过的那张,没点过 / 不在了就第一张
  const usable = backgrounds.filter((b) => b.has_file);
  const [bgId, setBgId] = useState<string | null>(null);
  const bg = usable.find((b) => b.id === bgId) ?? usable[0] ?? null;
  const bgSrc = bg ? sceneImageUrl(bg) : null;

  // ---- 每套的小头像和张数(页签、素材库列表用;编辑器改完会报上来) ----
  const [covers, setCovers] = useState<Record<string, Cover | null>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const asked = useRef(new Set<string>());
  const loadCovers = useCallback((ids: readonly string[]) => {
    for (const id of ids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      debugApi
        .listSprites(id)
        .then((list) => setCovers((c) => ({ ...c, [id]: coverOf(list) })))
        .catch(() => setCovers((c) => ({ ...c, [id]: null })));
    }
  }, []);
  const boundKey = packIds.join(',');
  useEffect(() => {
    loadCovers(boundKey ? boundKey.split(',') : []);
  }, [boundKey, loadCovers]);
  const onSprites = useCallback((pid: string, list: PackSprite[]) => {
    setCovers((c) => ({ ...c, [pid]: coverOf(list) }));
    setCounts((n) => ({ ...n, [pid]: list.length }));
  }, []);

  // ---- 绑定 ----
  const [dialog, setDialog] = useState<Dialog>(null);
  const createInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<{ packId: string; nonce: number; files: File[] } | null>(null);

  const openPicker = () => {
    // 张数、在用的卡数在别处也会变
    sync.packs('sprite');
    loadCovers(packs.map((p) => p.id));
    setDialog({ kind: 'picker' });
  };
  const pickNewFiles = () => createInput.current?.click();

  /** 挂上一套(接在后面,不换当前服装),页签切过去 */
  const bind = async (id: string) => {
    setDialog(null);
    await sprite.setPacks([...packIds, id]);
    setPick(id);
  };

  const create = async (name: string, files: File[]) => {
    setDialog(null);
    try {
      const pack = await debugApi.createSpritePack(name);
      await sprite.setPacks([...packIds, pack.id]);
      setPick(pack.id);
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

  const unbind = async (id: string) => {
    setDialog(null);
    // 拿掉的是当前服装时,后端换成它后面的下一套
    await sprite.setPacks(packIds.filter((x) => x !== id));
    setPick(null);
  };

  /** 解除当前服装以后游戏里换成哪套(和后端 _next_current 一样:后面的下一个,到头绕回前面) */
  const nextAfter = (id: string) => {
    const i = packIds.indexOf(id);
    const order = [...packIds.slice(i + 1), ...packIds.slice(0, i)];
    return order[0] ?? null;
  };

  const createInputEl = (
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
  );

  const dialogs = (
    <>
      {createInputEl}
      {dialog?.kind === 'picker' && (
        <PackPicker
          title="添加服装"
          packs={packs.map((p) => ({
            id: p.id,
            name: p.name,
            count: `${p.sprite_count} 张`,
            cardCount: p.card_count,
            media: coverThumb(covers[p.id]),
          }))}
          cardName={cardName}
          boundIds={packIds}
          icon="person"
          onPick={(id) => void bind(id)}
          createLabel="上传图片新建一套"
          onCreate={() => {
            setDialog(null);
            pickNewFiles();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
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
      {dialog?.kind === 'unbind' &&
        (() => {
          const name = byId.get(dialog.id)?.name ?? '这套立绘';
          const next = dialog.id === currentId ? nextAfter(dialog.id) : null;
          return (
            <ConfirmDialog
              title={`解除绑定「${name}」?`}
              body={
                <>
                  <p className="st-dialog-p">只是这张卡不再用它,这套立绘和里面的差分都留着,素材库里还能找到。</p>
                  {dialog.id === currentId && (
                    <p className="st-dialog-p">
                      {next
                        ? `它是当前服装,解除后游戏里换成「${byId.get(next)?.name ?? '下一套'}」。`
                        : '解除后这张卡就没有立绘了。'}
                    </p>
                  )}
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

  // ---- 还没挂立绘 ----
  if (!shown) {
    return (
      <>
        <main className="st-main">
          <div className="st-slot-bar">
            <TypeLabel slot="sprite" />
          </div>
          {sprite.ready ? (
            <div className="st-empty">
              <span className="st-empty-icon">
                <Icon name="person" size={26} />
              </span>
              <span className="st-empty-title">还没有立绘</span>
              <span className="st-empty-note">从素材库选,或者上传图片新建一套</span>
              <div className="st-empty-actions">
                <Btn icon="search" onClick={openPicker}>
                  从素材库选
                </Btn>
                <Btn icon="upload" onClick={pickNewFiles}>
                  上传图片新建一套
                </Btn>
              </div>
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
  const tabs = packIds.map((id) => {
    const p = byId.get(id);
    const n = counts[id] ?? p?.sprite_count ?? 0;
    return {
      id,
      name: p?.name ?? '…',
      sub: `${n} 张差分${id === currentId ? ' · 当前服装' : ''}`,
      selected: id === shown,
      media: coverThumb(covers[id]),
    };
  });

  const header = (
    <div className="st-slot-bar">
      <TypeLabel slot="sprite" />
      <PackTabs
        items={tabs}
        onSelect={setPick}
        onAdd={openPicker}
        addLabel="添加服装(从素材库选,或上传图片新建一套)"
        label="这张卡挂的立绘"
      />
      <span className="st-flex" />
      <MoreMenu
        label="更多:设为当前服装、重命名、导出这个包、解除绑定"
        items={[
          {
            label: shown === currentId ? '已是当前服装' : '设为当前服装',
            disabled: shown === currentId,
            onClick: () => void sprite.switchPack(shown),
          },
          { label: '重命名', onClick: () => setDialog({ kind: 'rename', id: shown }) },
          packExportItem('sprite', shown, notify),
          { label: '解除绑定', onClick: () => setDialog({ kind: 'unbind', id: shown }) },
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
